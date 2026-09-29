-- © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE.
-- Update: when the supervisor is also the approver (e.g. a chief director and their own staff),
-- they recommend and approve in one step. Run after 007. Safe to run again.

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
  -- Government: if the supervisor is also the approver (or there is no separate manager / HOD), that one
  -- person recommends and approves in a single step.
  if v_set.mode = 'enterprise' then v_mgr := coalesce(v_sup, v_mgr); v_sup := null;
  elsif v_mgr is null then v_mgr := v_sup; end if;
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

create or replace function public.decide_leave(p_id uuid, p_decision text, p_comment text default '') returns text
language plpgsql security definer set search_path = public as $$
declare r leave_requests; v_hr boolean := is_hr(); v_new text; v_acting uuid;
begin
  select * into r from leave_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.employee_id = auth.uid() then raise exception 'You cannot decide on your own leave'; end if;

  if r.status = 'pending_supervisor' then
    if not (r.supervisor_id = auth.uid() or acts_for(r.supervisor_id) or v_hr) then raise exception 'Not your request to decide'; end if;
    v_acting := case when r.supervisor_id <> auth.uid() and acts_for(r.supervisor_id) then r.supervisor_id end;
    if r.supervisor_id = r.manager_id and p_decision in ('approved_full_pay', 'approved_without_pay', 'not_approved') then
      -- One person recommends and approves: both parts of the Z1 are signed in one go.
      v_new := case when p_decision = 'not_approved' then 'rejected' else 'approved' end;
      update leave_requests set status = v_new,
        supervisor_decision = case when p_decision = 'not_approved' then 'not_recommended' else 'recommended' end,
        supervisor_comment = '', supervisor_by = auth.uid(), supervisor_at = now(), supervisor_acting_for = v_acting,
        manager_decision = p_decision, manager_comment = coalesce(p_comment, ''), manager_by = auth.uid(), manager_at = now(),
        manager_acting_for = v_acting where id = p_id;
      perform log_event(p_id, case when p_decision = 'not_approved' then 'not_recommended' else 'recommended' end,
        case when v_acting is not null then '(acting for ' || (select full_name from profiles where id = v_acting) || ')' else '' end);
    else
      if p_decision not in ('recommended', 'not_recommended', 'rescheduled') then raise exception 'Invalid decision'; end if;
      v_new := case when p_decision = 'rescheduled' then 'rejected' else 'pending_manager' end;
      update leave_requests set status = v_new, supervisor_decision = p_decision, supervisor_comment = coalesce(p_comment, ''),
        supervisor_by = auth.uid(), supervisor_at = now(), supervisor_acting_for = v_acting where id = p_id;
    end if;
  elsif r.status in ('pending_manager', 'pending_hr') then
    if not ((r.status = 'pending_manager' and (r.manager_id = auth.uid() or acts_for(r.manager_id))) or v_hr) then
      raise exception 'Not your request to decide';
    end if;
    -- Two different people must sign: whoever recommended cannot also give the final decision
    -- (unless they are the manager / HOD themself, or HR).
    if r.supervisor_by = auth.uid() and r.manager_id <> auth.uid() and r.supervisor_id is distinct from r.manager_id and not v_hr then
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
