-- Leave Management / HR app: Supabase database schema.
-- Run this whole file once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is safe to re-run: every object is created with "if not exists" / "or replace".
--
-- Security model (enforced by the database, not just the screen):
--   * Everyone signed in can see names, departments and who is out when (not the leave type or reason).
--   * Staff see their own personal details, balances, requests and leave log.
--   * Supervisors / managers see the requests they must decide on.
--   * HR and admin see and manage everything. Only admin can change settings and roles.
--   * Leave requests can only be created or changed through the functions at the bottom,
--     so nobody can approve their own leave or skip an approval step.

create extension if not exists pgcrypto;

-- ============================================================ tables

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  mode text not null default 'government' check (mode in ('government', 'enterprise')),
  org_name text not null default 'My Organisation',
  department_name text not null default '',
  hours_per_day numeric not null default 8,
  transmittal_to text not null default '',
  transmittal_from text not null default '',
  contact_person text not null default '',
  contact_tel text not null default '',
  theme jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict do nothing;
-- Added later (colour palette and background pictures); safe to run on an existing database.
alter table public.settings add column if not exists theme jsonb not null default '{}'::jsonb;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  surname text not null default '',
  initials text not null default '',
  role text not null default 'staff' check (role in ('staff', 'approver', 'hr', 'admin')),
  department text not null default '',
  component text not null default '',
  job_title text not null default '',
  supervisor_id uuid references public.profiles (id) on delete set null,
  manager_id uuid references public.profiles (id) on delete set null,
  employment_start date,
  shift_worker boolean not null default false,
  casual_employee boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Sensitive details: only the employee themself and HR can read these.
create table if not exists public.employee_private (
  id uuid primary key references public.profiles (id) on delete cascade,
  persal_number text not null default '',
  id_number text not null default '',
  phone text not null default '',
  address text not null default '',
  salary_level text not null default '',
  date_of_birth date,
  emergency_contact text not null default '',
  notes text not null default ''
);

create table if not exists public.leave_types (
  code text primary key,
  name text not null,
  gov_days numeric,
  ent_days numeric,
  senior_days numeric,
  senior_years int,
  cycle_months int not null default 12,
  cycle_anchor date not null default '2025-01-01',
  calendar_days boolean not null default false,
  part_day boolean not null default false,
  transmittal text not null default 'other' check (transmittal in ('vacation', 'sick', 'other')),
  evidence boolean not null default false,
  active boolean not null default true,
  sort int not null default 0
);

create table if not exists public.public_holidays (
  date date primary key,
  name text not null
);

-- Per-employee entitlement for one leave cycle, set by HR (overrides the leave type default).
create table if not exists public.leave_balances (
  employee_id uuid not null references public.profiles (id) on delete cascade,
  leave_type text not null references public.leave_types (code) on delete cascade,
  period_start date not null,
  entitled numeric,
  carried_over numeric not null default 0,
  primary key (employee_id, leave_type, period_start)
);

create table if not exists public.transmittal_batches (
  id uuid primary key default gen_random_uuid(),
  slip_no bigint generated always as identity,
  sent_to text not null default '',
  note text not null default '',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  ref_no bigint generated always as identity,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  leave_type text not null references public.leave_types (code),
  start_date date not null,
  end_date date not null,
  part_day boolean not null default false,
  start_time time,
  end_time time,
  days numeric not null,
  reason text not null default '',
  leave_address text not null default '',
  special_type text not null default '',
  union_affiliation text not null default '',
  attachment_path text,
  attachment_name text,
  persal_number text not null default '',
  status text not null check (status in ('pending_supervisor', 'pending_manager', 'pending_hr',
    'approved', 'transmitted', 'captured', 'rejected', 'cancelled')),
  mode text not null,
  supervisor_id uuid references public.profiles (id),
  manager_id uuid references public.profiles (id),
  supervisor_decision text, supervisor_comment text, supervisor_by uuid references public.profiles (id), supervisor_at timestamptz,
  manager_decision text, manager_comment text, manager_by uuid references public.profiles (id), manager_at timestamptz,
  batch_id uuid references public.transmittal_batches (id) on delete set null,
  captured_by uuid references public.profiles (id), captured_at timestamptz,
  checked_by uuid references public.profiles (id), checked_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
-- Added later: copy of the applicant's PERSAL / employee number, so approvers can print the full form.
alter table public.leave_requests add column if not exists persal_number text not null default '';
create index if not exists leave_requests_dates on public.leave_requests (start_date, end_date);
create index if not exists leave_requests_employee on public.leave_requests (employee_id);

-- The leave log: every action taken on a request.
create table if not exists public.leave_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.leave_requests (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  action text not null,
  comment text not null default '',
  at timestamptz not null default now()
);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('leave_form', 'transmittal')),
  name text not null,
  storage_path text not null,
  active boolean not null default true,
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ============================================================ helpers

create or replace function public.is_hr() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('hr', 'admin') and active from profiles where id = auth.uid()), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' and active from profiles where id = auth.uid()), false)
$$;

-- New sign-ups get a profile automatically. The very first user becomes admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, role)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
          case when exists (select 1 from profiles) then 'staff' else 'admin' end);
  insert into employee_private (id) values (new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admin may change someone's role; HR may edit everything else.
-- (auth.uid() is null when you run SQL yourself in the Supabase SQL editor, which is allowed.)
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not is_admin() then
    raise exception 'Only an admin can change roles';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- South African public holidays (Sunday holidays move to Monday). HR can add extra days in the app.
create or replace function public.seed_sa_holidays(from_year int, to_year int) returns void
language plpgsql security definer set search_path = public as $$
declare
  y int; a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
  easter date; fixed record;
begin
  for y in from_year .. to_year loop
    a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4; f := (b + 8) / 25;
    g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
    l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
    easter := make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
    insert into public_holidays values (easter - 2, 'Good Friday'), (easter + 1, 'Family Day')
      on conflict do nothing;
    for fixed in select * from (values
      (1, 1, 'New Year''s Day'), (3, 21, 'Human Rights Day'), (4, 27, 'Freedom Day'),
      (5, 1, 'Workers'' Day'), (6, 16, 'Youth Day'), (8, 9, 'National Women''s Day'),
      (9, 24, 'Heritage Day'), (12, 16, 'Day of Reconciliation'), (12, 25, 'Christmas Day'),
      (12, 26, 'Day of Goodwill')) as t (mo, dy, nm)
    loop
      insert into public_holidays values (make_date(y, fixed.mo, fixed.dy), fixed.nm) on conflict do nothing;
      if extract(isodow from make_date(y, fixed.mo, fixed.dy)) = 7 then
        insert into public_holidays values (make_date(y, fixed.mo, fixed.dy) + 1, fixed.nm || ' (observed)')
          on conflict do nothing;
      end if;
    end loop;
  end loop;
end $$;

select public.seed_sa_holidays(2025, 2035);

-- Number of leave days in a period: working days (weekends and public holidays skipped),
-- or calendar days for leave such as maternity.
create or replace function public.count_leave_days(p_start date, p_end date, p_calendar boolean) returns numeric
language sql stable set search_path = public as $$
  select case when p_calendar then (p_end - p_start + 1)::numeric
  else (select count(*) from generate_series(p_start, p_end, interval '1 day') s (d)
        where extract(isodow from s.d) < 6
          and not exists (select 1 from public_holidays h where h.date = s.d::date))::numeric
  end
$$;

-- ============================================================ default leave types
-- South African defaults matching the Z1(a) form. Change them in the app (Settings -> Leave types).

insert into public.leave_types
  (code, name, gov_days, ent_days, senior_days, senior_years, cycle_months, calendar_days, part_day, transmittal, evidence, sort)
values
  ('annual', 'Annual leave', 22, 15, 30, 10, 12, false, true, 'vacation', false, 1),
  ('sick', 'Normal sick leave', 36, 30, null, null, 36, false, true, 'sick', false, 2),
  ('til', 'Temporary incapacity leave', null, null, null, null, 36, false, false, 'sick', true, 3),
  ('iod', 'Leave for occupational injuries and disease', null, null, null, null, 12, false, false, 'other', true, 4),
  ('adoption', 'Adoption leave', 45, 50, null, null, 12, false, false, 'other', true, 5),
  ('family', 'Family responsibility leave', 5, 3, null, null, 12, false, true, 'other', true, 6),
  ('prenatal', 'Pre-natal leave', 8, null, null, null, 12, false, true, 'other', true, 7),
  ('paternity', 'Paternity / parental leave', 10, 10, null, null, 12, false, true, 'other', true, 8),
  ('special', 'Special leave', null, null, null, null, 12, false, true, 'other', true, 9),
  ('union_office', 'Leave for union office bearers', null, null, null, null, 12, false, true, 'other', true, 10),
  ('union_steward', 'Leave for union shop stewards', null, null, null, null, 12, false, true, 'other', true, 11),
  ('unpaid', 'Unpaid leave', null, null, null, null, 12, false, false, 'other', true, 12),
  ('maternity', 'Maternity leave', 120, 120, null, null, 12, true, false, 'other', true, 13),
  ('surrogacy_parent', 'Surrogacy leave: commissioning parent', null, 70, null, null, 12, true, false, 'other', true, 14),
  ('surrogacy_mother', 'Surrogacy leave: surrogate mother', null, null, null, null, 12, true, false, 'other', true, 15)
on conflict (code) do nothing;

-- ============================================================ row level security

alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.employee_private enable row level security;
alter table public.leave_types enable row level security;
alter table public.public_holidays enable row level security;
alter table public.leave_balances enable row level security;
alter table public.transmittal_batches enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_events enable row level security;
alter table public.templates enable row level security;

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (true);
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_write on public.profiles;
create policy profiles_write on public.profiles for update to authenticated using (is_hr()) with check (is_hr());

drop policy if exists private_read on public.employee_private;
create policy private_read on public.employee_private for select to authenticated using (id = auth.uid() or is_hr());
drop policy if exists private_write on public.employee_private;
create policy private_write on public.employee_private for update to authenticated using (is_hr()) with check (is_hr());
drop policy if exists private_insert on public.employee_private;
create policy private_insert on public.employee_private for insert to authenticated with check (is_hr());

drop policy if exists types_read on public.leave_types;
create policy types_read on public.leave_types for select to authenticated using (true);
drop policy if exists types_write on public.leave_types;
create policy types_write on public.leave_types for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists holidays_read on public.public_holidays;
create policy holidays_read on public.public_holidays for select to authenticated using (true);
drop policy if exists holidays_write on public.public_holidays;
create policy holidays_write on public.public_holidays for all to authenticated using (is_hr()) with check (is_hr());

drop policy if exists balances_read on public.leave_balances;
create policy balances_read on public.leave_balances for select to authenticated using (employee_id = auth.uid() or is_hr());
drop policy if exists balances_write on public.leave_balances;
create policy balances_write on public.leave_balances for all to authenticated using (is_hr()) with check (is_hr());

drop policy if exists batches_read on public.transmittal_batches;
create policy batches_read on public.transmittal_batches for select to authenticated using (is_hr());

-- No insert/update policies on requests or events: changes go through the functions below.
drop policy if exists requests_read on public.leave_requests;
create policy requests_read on public.leave_requests for select to authenticated
  using (employee_id = auth.uid() or supervisor_id = auth.uid() or manager_id = auth.uid() or is_hr());

drop policy if exists events_read on public.leave_events;
create policy events_read on public.leave_events for select to authenticated
  using (exists (select 1 from leave_requests r where r.id = request_id));

drop policy if exists templates_read on public.templates;
create policy templates_read on public.templates for select to authenticated using (true);
drop policy if exists templates_write on public.templates;
create policy templates_write on public.templates for all to authenticated using (is_hr()) with check (is_hr());

-- ============================================================ file storage
-- "templates": uploaded Word templates (HR uploads, everyone can download to fill in their own form).
-- "attachments": supporting evidence such as medical certificates, stored as <employee id>/<file>.

insert into storage.buckets (id, name, public) values ('templates', 'templates', false) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false) on conflict do nothing;

drop policy if exists templates_files_read on storage.objects;
create policy templates_files_read on storage.objects for select to authenticated using (bucket_id = 'templates');
drop policy if exists templates_files_write on storage.objects;
create policy templates_files_write on storage.objects for insert to authenticated with check (bucket_id = 'templates' and is_hr());
drop policy if exists templates_files_delete on storage.objects;
create policy templates_files_delete on storage.objects for delete to authenticated using (bucket_id = 'templates' and is_hr());

-- "branding": the admin's background pictures. Public, so pictures load without signing in.
insert into storage.buckets (id, name, public) values ('branding', 'branding', true) on conflict do nothing;
drop policy if exists branding_write on storage.objects;
create policy branding_write on storage.objects for insert to authenticated with check (bucket_id = 'branding' and is_admin());
drop policy if exists branding_delete on storage.objects;
create policy branding_delete on storage.objects for delete to authenticated using (bucket_id = 'branding' and is_admin());

drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects for select to authenticated using (
  bucket_id = 'attachments' and (
    (storage.foldername(name))[1] = auth.uid()::text or is_hr()
    or exists (select 1 from leave_requests r where r.attachment_path = name
               and (r.supervisor_id = auth.uid() or r.manager_id = auth.uid()))));
drop policy if exists attachments_write on storage.objects;
create policy attachments_write on storage.objects for insert to authenticated with check (
  bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================ workflow functions

create or replace function public.log_event(p_request uuid, p_action text, p_comment text default '') returns void
language sql security definer set search_path = public as $$
  insert into leave_events (request_id, actor_id, action, comment) values (p_request, auth.uid(), p_action, coalesce(p_comment, ''))
$$;
revoke execute on function public.log_event(uuid, text, text) from public, anon, authenticated;

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

-- Decisions (same wording as the Z1(a) form):
--   supervisor step: recommended | not_recommended | rescheduled
--   final step:      approved_full_pay | approved_without_pay | not_approved   (government)
--                    approved | rejected                                       (enterprise)
create or replace function public.decide_leave(p_id uuid, p_decision text, p_comment text default '') returns text
language plpgsql security definer set search_path = public as $$
declare r leave_requests; v_hr boolean := is_hr(); v_new text;
begin
  select * into r from leave_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.employee_id = auth.uid() then raise exception 'You cannot decide on your own leave'; end if;

  if r.status = 'pending_supervisor' then
    if not (r.supervisor_id = auth.uid() or v_hr) then raise exception 'Not your request to decide'; end if;
    if p_decision not in ('recommended', 'not_recommended', 'rescheduled') then raise exception 'Invalid decision'; end if;
    v_new := case when p_decision = 'rescheduled' then 'rejected' else 'pending_manager' end;
    update leave_requests set status = v_new, supervisor_decision = p_decision, supervisor_comment = coalesce(p_comment, ''),
      supervisor_by = auth.uid(), supervisor_at = now() where id = p_id;
  elsif r.status in ('pending_manager', 'pending_hr') then
    if not ((r.status = 'pending_manager' and r.manager_id = auth.uid()) or v_hr) then
      raise exception 'Not your request to decide';
    end if;
    if p_decision not in ('approved_full_pay', 'approved_without_pay', 'not_approved', 'approved', 'rejected') then
      raise exception 'Invalid decision';
    end if;
    v_new := case when p_decision in ('not_approved', 'rejected') then 'rejected' else 'approved' end;
    update leave_requests set status = v_new, manager_decision = p_decision, manager_comment = coalesce(p_comment, ''),
      manager_by = auth.uid(), manager_at = now() where id = p_id;
  else
    raise exception 'This request is not waiting for a decision';
  end if;
  perform log_event(p_id, p_decision, p_comment);
  return v_new;
end $$;

create or replace function public.cancel_leave(p_id uuid, p_comment text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r leave_requests; v_hr boolean := is_hr();
begin
  select * into r from leave_requests where id = p_id for update;
  if not found or not (r.employee_id = auth.uid() or v_hr) then raise exception 'Request not found'; end if;
  if not (r.status in ('pending_supervisor', 'pending_manager', 'pending_hr')
          or (r.status = 'approved' and (v_hr or r.start_date > current_date))) then
    raise exception 'This request can no longer be cancelled';
  end if;
  update leave_requests set status = 'cancelled' where id = p_id;
  perform log_event(p_id, 'cancelled', p_comment);
end $$;

-- HR: put approved requests on one transmittal slip.
create or replace function public.create_transmittal(p_ids uuid[], p_sent_to text default '', p_note text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_batch uuid; v_count int; v_id uuid;
begin
  if not is_hr() then raise exception 'HR only'; end if;
  select count(*) into v_count from leave_requests where id = any (p_ids) and status = 'approved' and batch_id is null;
  if v_count = 0 or v_count <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'Only approved requests that are not on a slip yet can be added';
  end if;
  insert into transmittal_batches (sent_to, note, created_by) values (coalesce(p_sent_to, ''), coalesce(p_note, ''), auth.uid())
    returning id into v_batch;
  update leave_requests set status = 'transmitted', batch_id = v_batch where id = any (p_ids);
  foreach v_id in array p_ids loop perform log_event(v_id, 'transmitted', ''); end loop;
  return v_batch;
end $$;

-- HR: record data capturing (Z1 "captured by / checked by").
create or replace function public.mark_captured(p_ids uuid[], p_checked boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_hr() then raise exception 'HR only'; end if;
  foreach v_id in array p_ids loop
    if p_checked then
      update leave_requests set checked_by = auth.uid(), checked_at = now()
        where id = v_id and status = 'captured';
      if found then perform log_event(v_id, 'checked', ''); end if;
    else
      update leave_requests set status = 'captured', captured_by = auth.uid(), captured_at = now()
        where id = v_id and status in ('approved', 'transmitted');
      if found then perform log_event(v_id, 'captured', ''); end if;
    end if;
  end loop;
end $$;

-- Who is out: everyone may see names and dates. The leave type is only shown to HR,
-- the employee themself and their approvers.
create or replace function public.who_is_out(p_from date, p_to date)
returns table (request_id uuid, employee_id uuid, full_name text, department text, start_date date, end_date date,
               part_day boolean, status text, leave_type text)
language sql stable security definer set search_path = public as $$
  select r.id, r.employee_id, p.full_name, p.department, r.start_date, r.end_date, r.part_day, r.status,
         case when is_hr() or r.employee_id = auth.uid() or r.supervisor_id = auth.uid() or r.manager_id = auth.uid()
              then r.leave_type end
  from leave_requests r join profiles p on p.id = r.employee_id
  where auth.uid() is not null
    and r.status in ('pending_supervisor', 'pending_manager', 'pending_hr', 'approved', 'transmitted', 'captured')
    and r.start_date <= p_to and r.end_date >= p_from
  order by r.start_date, p.full_name
$$;

revoke execute on function public.seed_sa_holidays(int, int) from public, anon, authenticated;
