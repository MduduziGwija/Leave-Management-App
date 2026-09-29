-- © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE.
-- Update: HR (not only the admin) appoints acting persons. Run after 006. Safe to run again.
-- HR: appoint someone to act for an approver. The acting person must be at most
-- settings.acting_levels_below salary levels (pay grades) below the person they act for.
create or replace function public.create_acting(p_principal uuid, p_acting uuid, p_start date, p_end date, p_reason text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_below int; pl int; al int; pn text; an text;
begin
  if not is_hr() then raise exception 'Only HR can appoint someone to act'; end if;
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

-- HR: end an acting appointment early (or withdraw one that has not started).
create or replace function public.end_acting(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_hr() then raise exception 'Only HR can change acting appointments'; end if;
  update acting_appointments set cancelled_at = now() where id = p_id and cancelled_at is null;
end $$;

