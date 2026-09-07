-- ACM — Row Level Security (PRD §4, §10)
-- Ini lapis kedua. Lapis pertama adalah pengecekan role di API layer Node.js.
-- Keduanya sengaja dipasang supaya keamanan tidak bergantung pada satu titik.

-- ---------------------------------------------------------------
-- Helper. SECURITY DEFINER + search_path terkunci: fungsi ini dibaca dari
-- dalam policy user_profiles sendiri, jadi kalau ia tunduk pada RLS akan
-- terjadi rekursi tak berujung.
-- ---------------------------------------------------------------
create or replace function public.current_role_name()
returns text
language sql stable security definer set search_path = public
as $$ select role from public.user_profiles where user_id = auth.uid() $$;

create or replace function public.current_cabang_scope()
returns text[]
language sql stable security definer set search_path = public
as $$ select cabang_scope from public.user_profiles where user_id = auth.uid() $$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.current_role_name() in ('super_admin', 'staff_it') $$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.current_role_name() = 'super_admin' $$;

-- Management boleh dibatasi ke cabang tertentu; role lain selalu lihat semua.
create or replace function public.cabang_visible(target text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when public.is_staff() then true
    when public.current_cabang_scope() is null then true
    else target = any (public.current_cabang_scope())
  end
$$;

alter table public.user_profiles      enable row level security;
alter table public.master_vehicles    enable row level security;
alter table public.alert_sources      enable row level security;
alter table public.alerts             enable row level security;
alter table public.alert_daily_summary enable row level security;
alter table public.polling_logs       enable row level security;
alter table public.archive_manifest   enable row level security;

-- ---------------------------------------------------------------
-- user_profiles — hanya Super Admin yang mengelola pengguna & role (PRD §4)
-- ---------------------------------------------------------------
drop policy if exists up_select on public.user_profiles;
create policy up_select on public.user_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists up_write on public.user_profiles;
create policy up_write on public.user_profiles for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ---------------------------------------------------------------
-- master_vehicles — Staff IT & Super Admin CRUD, Management view only
-- ---------------------------------------------------------------
drop policy if exists mv_select on public.master_vehicles;
create policy mv_select on public.master_vehicles for select to authenticated
  using (public.cabang_visible(cabang));

drop policy if exists mv_write on public.master_vehicles;
create policy mv_write on public.master_vehicles for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------
-- alert_sources — Management tidak punya akses sama sekali (PRD §4)
-- ---------------------------------------------------------------
drop policy if exists as_select on public.alert_sources;
create policy as_select on public.alert_sources for select to authenticated
  using (public.is_staff());

drop policy if exists as_insert on public.alert_sources;
create policy as_insert on public.alert_sources for insert to authenticated
  with check (public.is_staff());

drop policy if exists as_update on public.alert_sources;
create policy as_update on public.alert_sources for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Hanya Super Admin yang boleh benar-benar menghapus baris. Staff IT
-- menonaktifkan lewat soft delete (update deleted_at), sesuai PRD §8.
drop policy if exists as_delete on public.alert_sources;
create policy as_delete on public.alert_sources for delete to authenticated
  using (public.is_super_admin());

-- ---------------------------------------------------------------
-- alerts — semua role boleh lihat (Management terbatas cabang_scope),
-- tapi hanya Staff IT & Super Admin yang boleh acknowledge/close.
-- ---------------------------------------------------------------
drop policy if exists al_select on public.alerts;
create policy al_select on public.alerts for select to authenticated
  using (public.cabang_visible(cabang));

drop policy if exists al_update on public.alerts;
create policy al_update on public.alerts for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Tidak ada policy INSERT untuk `authenticated`: baris alerts hanya boleh lahir
-- dari endpoint polling internal, yang memakai service role dan melewati RLS.

-- ---------------------------------------------------------------
-- alert_daily_summary — dasar Summary Dashboard, view only bagi semua role
-- ---------------------------------------------------------------
drop policy if exists ads_select on public.alert_daily_summary;
create policy ads_select on public.alert_daily_summary for select to authenticated
  using (public.cabang_visible(cabang));

-- ---------------------------------------------------------------
-- polling_logs & archive_manifest — diagnostik, Staff IT & Super Admin saja
-- ---------------------------------------------------------------
drop policy if exists pl_select on public.polling_logs;
create policy pl_select on public.polling_logs for select to authenticated
  using (public.is_staff());

drop policy if exists am_select on public.archive_manifest;
create policy am_select on public.archive_manifest for select to authenticated
  using (public.is_staff());

-- ---------------------------------------------------------------
-- Profil otomatis saat pengguna baru dibuat. Default role paling rendah
-- (management) — hak akses dinaikkan secara sadar oleh Super Admin, bukan
-- diberikan begitu saja saat pendaftaran.
-- ---------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'management')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
