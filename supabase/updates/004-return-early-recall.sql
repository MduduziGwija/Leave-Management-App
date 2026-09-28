-- © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE.
-- Update: Return early and Recall. Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Return early / recall (added later; safe on existing databases).
-- original_*: what was approved, kept when the leave is shortened. shortened_kind: returned_early | recalled.
-- recall_request_*: an enterprise recall waiting for the employee to accept (BCEA s20(9): only by agreement).
alter table public.leave_requests add column if not exists original_end_date date;
alter table public.leave_requests add column if not exists original_days numeric;
alter table public.leave_requests add column if not exists shortened_kind text;
alter table public.leave_requests add column if not exists shortened_by uuid references public.profiles (id);
alter table public.leave_requests add column if not exists shortened_at timestamptz;
alter table public.leave_requests add column if not exists recall_reason text not null default '';
alter table public.leave_requests add column if not exists recall_costs text not null default '';
alter table public.leave_requests add column if not exists recall_request_end date;
alter table public.leave_requests add column if not exists recall_request_by uuid references public.profiles (id);
alter table public.leave_requests add column if not exists recall_request_at timestamptz;
alter table public.leave_requests add column if not exists recall_request_reason text not null default '';

-- Shortens approved leave: the employee returns early, or the supervisor / HOD / HR recalls them.
-- p_new_end is the new last day of leave. Unused days go back to the balance automatically,
-- because balances are worked out from each application's days.
-- Government: a recall applies at once (reason required). Enterprise: a recall is only a request
-- until the employee accepts it (BCEA s20(9): an employer may not require work during annual leave).
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
  v_days := count_leave_days(r.start_date, p_new_end, coalesce(v_type.calendar_days, false));
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

-- Enterprise: the employee accepts or declines a recall request.
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
  v_days := count_leave_days(r.start_date, r.recall_request_end, coalesce(v_type.calendar_days, false));
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

