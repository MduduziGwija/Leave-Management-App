-- © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE.
-- Update: work patterns (weekend / shift workers). Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Work pattern (added later; safe on existing databases): which weekdays each employee works.
alter table public.profiles add column if not exists work_days text not null default '12345';

-- Number of leave days in a period: the days the employee normally works (p_work_days, ISO weekday
-- digits, default '12345' = Monday to Friday) minus public holidays, or calendar days for leave such
-- as maternity. Weekend and shift workers have e.g. '123456' or '1234567'.
drop function if exists public.count_leave_days(date, date, boolean);
create or replace function public.count_leave_days(p_start date, p_end date, p_calendar boolean, p_work_days text default '12345') returns numeric
language sql stable set search_path = public as $$
  select case when p_calendar then (p_end - p_start + 1)::numeric
  else (select count(*) from generate_series(p_start, p_end, interval '1 day') s (d)
        where position(extract(isodow from s.d)::int::text in coalesce(nullif(p_work_days, ''), '12345')) > 0
          and not exists (select 1 from public_holidays h where h.date = s.d::date))::numeric
  end
$$;

create or replace function public.apply_leave(
  p_type text, p_start date, p_end date, p_part_day boolean default false,
  p_start_time time default null, p_end_time time default null, p_reason text default '',
  p_leave_address text default '', p_special_type text default '', p_union_affiliation text default '',
  p_attachment_path text default null, p_attachment_name text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_prof profiles; v_type leave_types; v_set settings; v_days numeric; v_id uuid;
  v_sup uuid; v_mgr uuid; v_status text;
begin
  select * into v_prof from profiles where id = auth.uid() and active;
  if not found then raise exception 'Your account is not active'; end if;
  select * into v_type from leave_types where code = p_type and active;
  if not found then raise exception 'Unknown leave type'; end if;
  select * into v_set from settings where id = 1;
  if v_type.available_in not in ('both', v_set.mode) then raise exception '% is not offered in % mode', v_type.name, v_set.mode; end if;
  if (v_type.eligible = 'female' and (select gender from employee_private where id = auth.uid()) = 'male')
     or (v_type.eligible = 'male' and (select gender from employee_private where id = auth.uid()) = 'female') then
    raise exception '% does not apply to you. Please choose another leave type, or ask HR to check your details.', v_type.name;
  end if;
  if p_end < p_start then raise exception 'The end date is before the start date'; end if;
  if p_attachment_path is not null and split_part(p_attachment_path, '/', 1) <> auth.uid()::text then
    raise exception 'Invalid attachment';
  end if;
  if exists (select 1 from leave_requests where employee_id = auth.uid()
             and status not in ('rejected', 'cancelled')
             and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')
             and not (part_day and p_part_day)) then
    raise exception 'You already have leave booked in this period';
  end if;

  if p_part_day then
    if not v_type.part_day then raise exception 'This leave type cannot be taken for part of a day'; end if;
    if p_start <> p_end or p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
      raise exception 'Part-day leave needs one date and a start time before the end time';
    end if;
    v_days := round((extract(epoch from p_end_time - p_start_time) / 3600 / v_set.hours_per_day)::numeric, 2);
  else
    v_days := count_leave_days(p_start, p_end, v_type.calendar_days, v_prof.work_days);
  end if;
  if v_days <= 0 then raise exception 'The selected period has no working days'; end if;

  -- Same routing as initialRouting() in js/logic.js.
  v_sup := nullif(v_prof.supervisor_id, auth.uid());
  v_mgr := nullif(v_prof.manager_id, auth.uid());
  if v_sup = v_mgr then v_sup := null; end if;
  if v_set.mode = 'enterprise' then v_mgr := coalesce(v_sup, v_mgr); v_sup := null; end if;
  if v_mgr is null then v_mgr := v_sup; v_sup := null; end if;
  v_status := case when v_sup is not null then 'pending_supervisor'
                   when v_mgr is not null then 'pending_manager' else 'pending_hr' end;

  insert into leave_requests (employee_id, leave_type, start_date, end_date, part_day, start_time, end_time,
    days, reason, leave_address, special_type, union_affiliation, attachment_path, attachment_name,
    status, mode, supervisor_id, manager_id, persal_number)
  values (auth.uid(), p_type, p_start, p_end, p_part_day,
    case when p_part_day then p_start_time end, case when p_part_day then p_end_time end,
    v_days, coalesce(p_reason, ''), coalesce(p_leave_address, ''), coalesce(p_special_type, ''),
    coalesce(p_union_affiliation, ''), p_attachment_path, p_attachment_name,
    v_status, v_set.mode, v_sup, v_mgr,
    coalesce((select persal_number from employee_private where id = auth.uid()), ''))
  returning id into v_id;
  perform log_event(v_id, 'submitted', format('%s day(s)', v_days));
  return v_id;
end $$;

create or replace function public.shorten_leave(p_id uuid, p_new_end date, p_kind text, p_reason text default '', p_costs text default '')
returns text
language plpgsql security definer set search_path = public as $$
declare r leave_requests; v_hr boolean := is_hr(); v_type leave_types; v_days numeric; v_back numeric;
begin
  select * into r from leave_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status not in ('approved', 'transmitted', 'captured') then raise exception 'Only approved leave can be shortened'; end if;
  if r.part_day then raise exception 'Part-day leave cannot be shortened; cancel it instead'; end if;
  if p_new_end is null or p_new_end < r.start_date or p_new_end >= r.end_date then
    raise exception 'The new last day must be on or after % and before %', r.start_date, r.end_date;
  end if;
  if p_kind = 'returned_early' then
    if not (r.employee_id = auth.uid() or v_hr) then raise exception 'Only the employee or HR can record a return'; end if;
    if not v_hr and p_new_end < current_date - 1 then raise exception 'The new last day cannot be in the past. Ask HR to correct older leave.'; end if;
  elsif p_kind = 'recalled' then
    if r.employee_id = auth.uid() then raise exception 'Use "Return early" for your own leave'; end if;
    if not (r.supervisor_id = auth.uid() or r.manager_id = auth.uid() or v_hr) then raise exception 'Only the supervisor, manager / HOD or HR can recall'; end if;
    if coalesce(trim(p_reason), '') = '' then raise exception 'Please give the reason for the recall'; end if;
    if r.mode = 'enterprise' then
      update leave_requests set recall_request_end = p_new_end, recall_request_by = auth.uid(), recall_request_at = now(),
        recall_request_reason = p_reason where id = p_id;
      perform log_event(p_id, 'recall_requested', format('Asked to return after %s: %s', p_new_end, p_reason));
      return 'requested';
    end if;
  else
    raise exception 'Unknown change';
  end if;
  select * into v_type from leave_types where code = r.leave_type;
  v_days := count_leave_days(r.start_date, p_new_end, coalesce(v_type.calendar_days, false), (select work_days from profiles where id = r.employee_id));
  v_back := r.days - v_days;
  update leave_requests set original_end_date = coalesce(original_end_date, end_date), original_days = coalesce(original_days, days),
    end_date = p_new_end, days = v_days, shortened_kind = p_kind,
    status = case when v_days <= 0 then 'cancelled' else status end, shortened_by = auth.uid(), shortened_at = now(),
    recall_reason = coalesce(p_reason, ''), recall_costs = coalesce(p_costs, ''),
    recall_request_end = null, recall_request_by = null, recall_request_at = null, recall_request_reason = ''
    where id = p_id;
  perform log_event(p_id, p_kind, format('%s; %s day(s) credited back.%s%s',
    case when v_days <= 0 then 'No leave days were left, so the leave is cancelled' else 'Last day of leave now ' || p_new_end end, v_back,
    case when coalesce(p_reason, '') <> '' then ' Reason: ' || p_reason else '' end,
    case when coalesce(p_costs, '') <> '' then ' Costs to claim: ' || p_costs else '' end));
  return case when v_days <= 0 then 'cancelled' else 'shortened' end;
end $$;

create or replace function public.respond_recall(p_id uuid, p_accept boolean, p_comment text default '') returns text
language plpgsql security definer set search_path = public as $$
declare r leave_requests; v_type leave_types; v_days numeric; v_back numeric;
begin
  select * into r from leave_requests where id = p_id for update;
  if not found or r.employee_id <> auth.uid() then raise exception 'Request not found'; end if;
  if r.recall_request_end is null then raise exception 'There is no recall to answer'; end if;
  if not p_accept then
    update leave_requests set recall_request_end = null, recall_request_by = null, recall_request_at = null, recall_request_reason = '' where id = p_id;
    perform log_event(p_id, 'recall_declined', p_comment);
    return 'declined';
  end if;
  if r.recall_request_end < r.start_date or r.recall_request_end >= r.end_date then raise exception 'This recall no longer fits the leave dates'; end if;
  select * into v_type from leave_types where code = r.leave_type;
  v_days := count_leave_days(r.start_date, r.recall_request_end, coalesce(v_type.calendar_days, false), (select work_days from profiles where id = r.employee_id));
  v_back := r.days - v_days;
  update leave_requests set original_end_date = coalesce(original_end_date, end_date), original_days = coalesce(original_days, days),
    end_date = r.recall_request_end, days = v_days, shortened_kind = 'recalled',
    status = case when v_days <= 0 then 'cancelled' else status end, shortened_by = r.recall_request_by, shortened_at = now(),
    recall_reason = r.recall_request_reason,
    recall_request_end = null, recall_request_by = null, recall_request_at = null, recall_request_reason = ''
    where id = p_id;
  perform log_event(p_id, 'recall_accepted', format('%s; %s day(s) credited back.%s',
    case when v_days <= 0 then 'No leave days were left, so the leave is cancelled' else 'Last day of leave now ' || r.recall_request_end end, v_back,
    case when coalesce(p_comment, '') <> '' then ' ' || p_comment else '' end));
  return 'accepted';
end $$;
