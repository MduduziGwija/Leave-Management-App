-- © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE.
-- Update: acting appointments. Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Acting appointments: while a supervisor / head of component / chief director is away, the admin
-- appoints someone at an appropriate level to act for them and decide their team's leave.
create table if not exists public.acting_appointments (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references public.profiles (id) on delete cascade,
  acting_id uuid not null references public.profiles (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text not null default '',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (end_date >= start_date),
  check (principal_id <> acting_id)
);

-- True if the signed-in person is acting for p_principal today.
create or replace function public.acts_for(p_principal uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_principal is not null and exists (select 1 from acting_appointments a
    where a.principal_id = p_principal and a.acting_id = auth.uid() and a.cancelled_at is null
      and current_date between a.start_date and a.end_date)
$$;

-- The number in a salary level / pay grade such as '12' or 'Level 12'; null if none.
create or replace function public.level_num(p text) returns int
language sql immutable as $$ select nullif(substring(coalesce(p, '') from '[0-9]+'), '')::int $$;

-- Acting appointments (added later; safe on existing databases).
alter table public.settings add column if not exists acting_levels_below int not null default 1;
alter table public.leave_requests add column if not exists supervisor_acting_for uuid references public.profiles (id);
alter table public.leave_requests add column if not exists manager_acting_for uuid references public.profiles (id);

alter table public.acting_appointments enable row level security;
drop policy if exists acting_read on public.acting_appointments;
create policy acting_read on public.acting_appointments for select to authenticated using (true);

drop policy if exists requests_read on public.leave_requests;
create policy requests_read on public.leave_requests for select to authenticated
  using (employee_id = auth.uid() or supervisor_id = auth.uid() or manager_id = auth.uid() or is_hr()
         or acts_for(supervisor_id) or acts_for(manager_id));

-- Admin: appoint someone to act for an approver. The acting person must be at most
-- settings.acting_levels_below salary levels (pay grades) below the person they act for.
create or replace function public.create_acting(p_principal uuid, p_acting uuid, p_start date, p_end date, p_reason text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_below int; pl int; al int; pn text; an text;
begin
  if not is_admin() then raise exception 'Only an admin can appoint someone to act'; end if;
  if p_principal = p_acting then raise exception 'Choose someone else to act'; end if;
  if p_end < p_start then raise exception 'The end date is before the start date'; end if;
  select full_name into pn from profiles where id = p_principal;
  select full_name into an from profiles where id = p_acting and active;
  if an is null then raise exception 'The acting person must have an active account'; end if;
  select acting_levels_below into v_below from settings where id = 1;
  pl := level_num((select salary_level from employee_private where id = p_principal));
  al := level_num((select salary_level from employee_private where id = p_acting));
  if pl is null or al is null then
    raise exception 'Record the salary level of both % and % first (Employees), so the level can be checked', pn, an;
  end if;
  if al < pl - v_below then
    raise exception '% is on level %. To act for % (level %), the acting person must be on level % or higher', an, al, pn, pl, pl - v_below;
  end if;
  if exists (select 1 from acting_appointments where principal_id = p_principal and cancelled_at is null
             and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'Someone is already acting for % during these dates', pn;
  end if;
  insert into acting_appointments (principal_id, acting_id, start_date, end_date, reason, created_by)
  values (p_principal, p_acting, p_start, p_end, coalesce(p_reason, ''), auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Admin: end an acting appointment early (or withdraw one that has not started).
create or replace function public.end_acting(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only an admin can change acting appointments'; end if;
  update acting_appointments set cancelled_at = now() where id = p_id and cancelled_at is null;
end $$;

create or replace function public.decide_leave(p_id uuid, p_decision text, p_comment text default '') returns text
language plpgsql security definer set search_path = public as $$
declare r leave_requests; v_hr boolean := is_hr(); v_new text; v_acting uuid;
begin
  select * into r from leave_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.employee_id = auth.uid() then raise exception 'You cannot decide on your own leave'; end if;

  if r.status = 'pending_supervisor' then
    if not (r.supervisor_id = auth.uid() or acts_for(r.supervisor_id) or v_hr) then raise exception 'Not your request to decide'; end if;
    if p_decision not in ('recommended', 'not_recommended', 'rescheduled') then raise exception 'Invalid decision'; end if;
    v_new := case when p_decision = 'rescheduled' then 'rejected' else 'pending_manager' end;
    v_acting := case when r.supervisor_id <> auth.uid() and acts_for(r.supervisor_id) then r.supervisor_id end;
    update leave_requests set status = v_new, supervisor_decision = p_decision, supervisor_comment = coalesce(p_comment, ''),
      supervisor_by = auth.uid(), supervisor_at = now(), supervisor_acting_for = v_acting where id = p_id;
  elsif r.status in ('pending_manager', 'pending_hr') then
    if not ((r.status = 'pending_manager' and (r.manager_id = auth.uid() or acts_for(r.manager_id))) or v_hr) then
      raise exception 'Not your request to decide';
    end if;
    -- Two different people must sign: whoever recommended cannot also give the final decision
    -- (unless they are the manager / HOD themself, or HR).
    if r.supervisor_by = auth.uid() and r.manager_id <> auth.uid() and not v_hr then
      raise exception 'You recommended this application, so someone else must approve it';
    end if;
    v_acting := case when r.manager_id <> auth.uid() and acts_for(r.manager_id) then r.manager_id end;
    if p_decision not in ('approved_full_pay', 'approved_without_pay', 'not_approved', 'approved', 'rejected') then
      raise exception 'Invalid decision';
    end if;
    v_new := case when p_decision in ('not_approved', 'rejected') then 'rejected' else 'approved' end;
    update leave_requests set status = v_new, manager_decision = p_decision, manager_comment = coalesce(p_comment, ''),
      manager_by = auth.uid(), manager_at = now(), manager_acting_for = v_acting where id = p_id;
  else
    raise exception 'This request is not waiting for a decision';
  end if;
  perform log_event(p_id, p_decision, concat_ws(' ', case when v_acting is not null then
    '(acting for ' || (select full_name from profiles where id = v_acting) || ')' end, nullif(p_comment, '')));
  return v_new;
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
    if not (r.supervisor_id = auth.uid() or r.manager_id = auth.uid() or acts_for(r.supervisor_id) or acts_for(r.manager_id) or v_hr) then
      raise exception 'Only the supervisor, manager / HOD (or someone acting for them) or HR can recall';
    end if;
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

create or replace function public.who_is_out(p_from date, p_to date)
returns table (request_id uuid, employee_id uuid, full_name text, department text, start_date date, end_date date,
               part_day boolean, status text, leave_type text)
language sql stable security definer set search_path = public as $$
  select r.id, r.employee_id, p.full_name, p.department, r.start_date, r.end_date, r.part_day, r.status,
         case when is_hr() or r.employee_id = auth.uid() or r.supervisor_id = auth.uid() or r.manager_id = auth.uid()
                   or acts_for(r.supervisor_id) or acts_for(r.manager_id)
              then r.leave_type end
  from leave_requests r join profiles p on p.id = r.employee_id
  where auth.uid() is not null
    and r.status in ('pending_supervisor', 'pending_manager', 'pending_hr', 'approved', 'transmitted', 'captured')
    and r.start_date <= p_to and r.end_date >= p_from
  order by r.start_date, p.full_name
$$;
