-- © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE.
-- Update for databases created before the Appearance settings were added.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
alter table public.settings add column if not exists theme jsonb not null default '{}'::jsonb;

insert into storage.buckets (id, name, public) values ('branding', 'branding', true) on conflict do nothing;
drop policy if exists branding_write on storage.objects;
create policy branding_write on storage.objects for insert to authenticated with check (bucket_id = 'branding' and public.is_admin());
drop policy if exists branding_delete on storage.objects;
create policy branding_delete on storage.objects for delete to authenticated using (bucket_id = 'branding' and public.is_admin());
