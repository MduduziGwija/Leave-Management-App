-- Update: store the applicant's PERSAL / employee number on each leave application, so the
-- supervisor and HOD can print the complete Z1 form. Run once in Supabase: SQL Editor -> New query -> Run.
alter table public.leave_requests add column if not exists persal_number text not null default '';
update public.leave_requests r set persal_number = p.persal_number
  from public.employee_private p where p.id = r.employee_id and r.persal_number = '';

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
    v_days := count_leave_days(p_start, p_end, v_type.calendar_days);
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
