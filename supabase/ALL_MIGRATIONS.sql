-- ACM — seluruh migrasi digabung untuk dijalankan sekali di Supabase SQL Editor.
-- Dihasilkan otomatis dari supabase/migrations/. Jangan disunting langsung.


-- ============================================================
-- 0001_schema.sql
-- ============================================================
-- ACM — Skema inti (PRD §6)
-- Dijalankan sekali di project Supabase. Idempoten sejauh mungkin.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------
-- user_profiles (PRD §6.6)
-- ---------------------------------------------------------------
create table if not exists public.user_profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  full_name    text not null default '',
  role         text not null default 'management'
                 check (role in ('super_admin', 'staff_it', 'management')),
  cabang_scope text[],                       -- null = seluruh cabang
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.user_profiles.cabang_scope is
  'Null berarti akses seluruh cabang. Jika diisi, membatasi baris yang terlihat (dipakai RLS).';

-- ---------------------------------------------------------------
-- master_vehicles (PRD §6.1)
-- ---------------------------------------------------------------
create table if not exists public.master_vehicles (
  vhcid         text primary key,
  no_plat       text,
  no_rangka     text,
  group_project text,
  cabang        text,
  vendor        text,
  jenis_gps     text,
  fitur         jsonb not null default '[]'::jsonb,
  updated_by    uuid references public.user_profiles (user_id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_master_vehicles_cabang  on public.master_vehicles (cabang);
create index if not exists idx_master_vehicles_project on public.master_vehicles (group_project);
create index if not exists idx_master_vehicles_no_plat on public.master_vehicles (no_plat);

-- ---------------------------------------------------------------
-- alert_sources (PRD §6.2)
-- ---------------------------------------------------------------
create table if not exists public.alert_sources (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  alert_type               text not null unique,
  endpoint_url             text not null,
  method                   text not null default 'POST' check (method in ('GET', 'POST')),

  -- 'custom_header' ditambahkan setelah investigasi Milestone 0: EASYGO memakai
  -- header bernama `token` dengan nilai mentah, bukan skema Bearer.
  auth_type                text not null default 'custom_header'
                             check (auth_type in ('bearer', 'api_key', 'basic', 'custom_header', 'none')),
  auth_header_name         text not null default 'token',
  -- base64 dari iv|authTag|ciphertext (AES-256-GCM). Disimpan sebagai text,
  -- bukan bytea, karena bytea harus lewat pengkodean hex saat melintasi PostgREST
  -- dan itu jadi sumber bug diam-diam. Nilainya tidak pernah dikirim ke frontend.
  token_encrypted          text,
  headers_template         jsonb not null default '{}'::jsonb,
  body_template            jsonb not null default '{}'::jsonb,

  polling_interval_seconds integer not null default 300 check (polling_interval_seconds >= 60),
  field_mapping            jsonb not null default '{}'::jsonb,

  -- Field pembeda untuk sumber yang satu responsnya memuat banyak jenis
  -- kejadian (mis. `tipe_notif` di Notifikasi/Operation).
  -- Null = sumber menghasilkan satu alert_type saja.
  --
  -- Pemetaan nilainya TIDAK disimpan di sini, melainkan sebagai master data di
  -- `alert_type_master` (0006) supaya bisa dikelola lewat UI oleh staf
  -- non-developer, bukan dengan menyunting JSON.
  discriminator_path       text,

  -- Di mana array record berada dalam envelope response, mis. 'Data'.
  data_path                text not null default 'Data',

  -- Window waktu bergulir: field body yang diisi otomatis tiap polling.
  time_window_enabled      boolean not null default true,
  time_window_start_field  text not null default 'start_time',
  time_window_stop_field   text not null default 'stop_time',
  time_window_format       text not null default 'YYYY/MM/DD HH24:MI:SS',
  time_window_lookback_seconds integer not null default 900,

  -- Zona waktu yang dipakai API untuk MEMBACA start_time/stop_time. Wajib
  -- per-sumber, bukan konstanta: /api/report/speed_flag membaca window dalam
  -- UTC, sedangkan /api/Notifikasi/Operation membacanya dalam WIB (+7).
  -- Terverifikasi 2026-09-07, lihat FINDINGS §3.1. Offset yang salah tidak
  -- menghasilkan error — API tetap menjawab "success", hanya saja untuk
  -- rentang waktu yang keliru, sehingga alert hilang tanpa jejak.
  time_window_offset_hours integer not null default 0,

  is_active                boolean not null default true,
  deleted_at               timestamptz,                  -- soft delete
  last_success_at          timestamptz,
  last_error               text,
  consecutive_failures     integer not null default 0,

  created_by               uuid references public.user_profiles (user_id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on column public.alert_sources.time_window_lookback_seconds is
  'Seberapa jauh ke belakang window polling dibuka. Sengaja lebih besar dari interval agar ada tumpang tindih dan tidak ada kejadian yang lolos di antara dua polling; duplikatnya diserap oleh dedup harian (PRD §7.1).';

comment on column public.alert_sources.discriminator_path is
  'Jalur field pembeda di dalam record, mis. tipe_notif. Pemetaan nilainya ada di alert_type_master.';

-- ---------------------------------------------------------------
-- alerts (PRD §6.3)
-- ---------------------------------------------------------------
create table if not exists public.alerts (
  id               uuid primary key default gen_random_uuid(),
  source_id        uuid not null references public.alert_sources (id) on delete cascade,

  -- Sengaja TANPA foreign key ke master_vehicles: unit yang belum terdaftar
  -- tetap harus bisa masuk (PRD §7.3), operasional tidak boleh terhambat
  -- oleh kelengkapan master data.
  vhcid            text,

  alert_type       text not null,
  severity         text not null default 'info'
                     check (severity in ('critical', 'warning', 'info')),
  lat              numeric(10, 7),
  long             numeric(10, 7),

  -- Denormalisasi dari master_vehicles saat insert, supaya filter cabang di
  -- dashboard dan RLS Management tidak perlu join per baris.
  cabang           text,
  group_project    text,
  no_plat          text,

  raw_payload      jsonb not null default '{}'::jsonb,
  status           text not null default 'active'
                     check (status in ('active', 'acknowledged', 'closed')),
  occurrence_count integer not null default 1,

  -- Kunci dedup harian, dihitung di zona waktu Asia/Makassar (WITA) — bukan UTC,
  -- supaya "hari yang sama" berarti hari kerja operasional, bukan hari UTC.
  occurrence_date  date not null
                     generated always as (((first_seen_at at time zone 'Asia/Makassar')::date)) stored,

  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),

  acknowledged_at  timestamptz,
  acknowledged_by  uuid references public.user_profiles (user_id) on delete set null,
  closed_at        timestamptz,
  closed_by        uuid references public.user_profiles (user_id) on delete set null,
  close_note       text,

  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- alert_daily_summary (PRD §6.4) — permanen, dasar laporan jangka panjang
-- ---------------------------------------------------------------
create table if not exists public.alert_daily_summary (
  id                  uuid primary key default gen_random_uuid(),
  summary_date        date not null,
  vhcid               text,
  alert_type          text not null,
  cabang              text,
  group_project       text,
  occurrence_count    integer not null default 0,
  alert_count         integer not null default 0,
  critical_count      integer not null default 0,
  warning_count       integer not null default 0,
  first_occurrence_at timestamptz,
  last_occurrence_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Kunci unik supaya rollup harian bisa dijalankan ulang tanpa menggandakan baris.
create unique index if not exists uq_daily_summary
  on public.alert_daily_summary (summary_date, coalesce(vhcid, ''), alert_type);

-- ---------------------------------------------------------------
-- polling_logs (PRD §6.5) — diagnostik, retensi pendek
-- ---------------------------------------------------------------
create table if not exists public.polling_logs (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references public.alert_sources (id) on delete cascade,
  executed_at    timestamptz not null default now(),
  http_status    integer,
  response_code  integer,       -- ResponseCode dari envelope EASYGO (1 = sukses)
  duration_ms    integer,
  success        boolean not null default false,
  records_fetched integer not null default 0,
  records_new    integer not null default 0,
  records_deduped integer not null default 0,
  error_message  text
);

-- ---------------------------------------------------------------
-- archive_manifest (PRD §7.4) — struktur disiapkan di Fase 1
-- ---------------------------------------------------------------
create table if not exists public.archive_manifest (
  id         uuid primary key default gen_random_uuid(),
  period     text not null unique,       -- 'YYYY-MM'
  file_url   text,
  row_count  integer not null default 0,
  archived_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- updated_at otomatis
-- ---------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['user_profiles', 'master_vehicles', 'alert_sources', 'alert_daily_summary']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;


-- ============================================================
-- 0002_indexes.sql
-- ============================================================
-- ACM — Index (PRD §6.3) + kunci dedup harian

-- Index yang disebut PRD §6.3, untuk filter dashboard pada skala 1000+ unit.
create index if not exists idx_alerts_status_created  on public.alerts (status, created_at desc);
create index if not exists idx_alerts_source          on public.alerts (source_id);
create index if not exists idx_alerts_vhcid_type      on public.alerts (vhcid, alert_type, status);

-- Feed wall display selalu "alert terbaru lebih dulu".
create index if not exists idx_alerts_last_seen       on public.alerts (last_seen_at desc);

-- Filter cabang / project dari topbar, dan penegakan cabang_scope di RLS.
create index if not exists idx_alerts_cabang          on public.alerts (cabang, last_seen_at desc);
create index if not exists idx_alerts_project         on public.alerts (group_project, last_seen_at desc);

-- Heatmap: hanya baris yang punya koordinat.
create index if not exists idx_alerts_geo             on public.alerts (occurrence_date, alert_type)
  where lat is not null and long is not null;

-- Rollup harian & job pembersihan 90 hari.
create index if not exists idx_alerts_occurrence_date on public.alerts (occurrence_date);

create index if not exists idx_polling_logs_source    on public.polling_logs (source_id, executed_at desc);
create index if not exists idx_daily_summary_date     on public.alert_daily_summary (summary_date desc, alert_type);


-- ---------------------------------------------------------------
-- Kunci dedup harian (PRD §7.1)
-- ---------------------------------------------------------------
-- Aturannya: satu baris per (vhcid, alert_type) per hari SELAMA masih terbuka.
-- Kalau kejadian sebelumnya sudah closed, kejadian berikutnya membuat baris baru
-- meski di hari yang sama — karena itu predikatnya `status <> 'closed'`.
--
-- Dibuat sebagai UNIQUE INDEX, bukan sekadar index bantu, supaya endpoint polling
-- bisa memakai INSERT ... ON CONFLICT DO UPDATE. Ini penting: pola
-- "SELECT dulu, lalu INSERT kalau tidak ada" punya lubang balapan — dua polling
-- yang tumpang tindih (dan window kita memang sengaja tumpang tindih) bisa
-- sama-sama tidak menemukan baris lalu sama-sama menyisipkan. Dengan unique index,
-- database yang menjamin keunikannya, bukan urutan eksekusi aplikasi.
--
-- coalesce(vhcid, '') dipakai karena di Postgres dua NULL dianggap berbeda,
-- sehingga alert dari unit tak dikenal tidak akan pernah ter-dedup tanpa ini.
create unique index if not exists uq_alerts_dedup
  on public.alerts (coalesce(vhcid, ''), alert_type, occurrence_date)
  where status <> 'closed';


-- ============================================================
-- 0003_rls.sql
-- ============================================================
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


-- ============================================================
-- 0004_scheduler.sql
-- ============================================================
-- ACM — Scheduler (PRD §5.2, §5.3)
-- pg_cron menjadwalkan, pg_net memanggil, Node.js yang berpikir.

-- ---------------------------------------------------------------
-- Pengaturan runtime. pg_net butuh tahu ke mana harus memanggil, dan
-- endpoint internal butuh rahasia bersama supaya tidak bisa dipicu publik.
-- Disimpan di tabel (bukan ALTER DATABASE SET) supaya bisa diubah tanpa
-- hak superuser, yang tidak tersedia di Supabase terkelola.
-- ---------------------------------------------------------------
create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);

alter table public.app_settings enable row level security;
-- Tidak ada policy sama sekali: hanya service role (yang melewati RLS) yang boleh
-- membacanya. Isinya rahasia internal, tidak pernah untuk frontend.

insert into public.app_settings (key, value) values
  ('app_base_url',   'https://acm.example.vercel.app'),
  ('internal_secret', 'GANTI-SAYA-dengan-nilai-acak-panjang')
on conflict (key) do nothing;

create or replace function public.get_setting(p_key text)
returns text language sql stable security definer set search_path = public
as $$ select value from public.app_settings where key = p_key $$;

-- ---------------------------------------------------------------
-- Pemanggil HTTP generik lewat pg_net
-- ---------------------------------------------------------------
create or replace function public.call_internal(p_path text)
returns bigint
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_base   text := public.get_setting('app_base_url');
  v_secret text := public.get_setting('internal_secret');
begin
  if v_base is null or v_secret is null then
    raise warning 'ACM: app_base_url / internal_secret belum diisi di app_settings';
    return null;
  end if;

  return net.http_post(
    url     := v_base || p_path,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-acm-internal', v_secret),
    body    := '{}'::jsonb,
    -- Lebih longgar dari interval polling: kalau API EASYGO sedang lambat,
    -- lebih baik menunggu daripada menandai sumber gagal secara keliru.
    timeout_milliseconds := 120000
  );
end;
$$;

-- ---------------------------------------------------------------
-- reschedule_alert_source (PRD §5.3)
-- Dipanggil trigger, sehingga admin cukup mengubah data lewat UI.
-- ---------------------------------------------------------------
create or replace function public.reschedule_alert_source(p_source_id uuid)
returns void
language plpgsql security definer set search_path = public, cron
as $$
declare
  v_job_name text := 'poll_source_' || replace(p_source_id::text, '-', '');
  v_src      public.alert_sources%rowtype;
  v_schedule text;
  v_minutes  integer;
  v_hours    integer;
begin
  -- Selalu hapus jadwal lama dulu, apa pun kondisinya. Kalau tidak, mengubah
  -- interval akan meninggalkan job lama sehingga sumber ter-polling dua kali.
  perform cron.unschedule(jobid)
    from cron.job where jobname = v_job_name;

  select * into v_src from public.alert_sources where id = p_source_id;

  if not found or v_src.is_active is not true or v_src.deleted_at is not null then
    return;
  end if;

  -- Penjadwalan pg_cron bergranularitas MENIT di sini.
  --
  -- pg_cron memang punya sintaks berbasis detik, tapi hanya menerima rentang
  -- '[1-59] seconds' — sementara kolom ini justru dibatasi minimal 60 detik.
  -- Artinya sintaks detik tidak pernah bisa dipakai, dan interval seperti 90
  -- detik akan ditolak dengan 'invalid schedule' yang menggagalkan seluruh
  -- transaksi penyimpanan konfigurasi.
  --
  -- Karena itu interval dibulatkan KE ATAS ke menit terdekat. Membulatkan ke
  -- atas, bukan ke bawah, supaya polling tidak pernah jadi lebih sering dari
  -- yang diminta — dan selisihnya toh diserap oleh window lookback yang memang
  -- sengaja dibuat tumpang tindih.
  v_minutes := greatest(1, ceil(v_src.polling_interval_seconds / 60.0)::integer);

  if v_minutes < 60 then
    v_schedule := '*/' || v_minutes::text || ' * * * *';
  elsif v_minutes = 60 then
    v_schedule := '0 * * * *';
  else
    v_hours := least(23, greatest(1, ceil(v_minutes / 60.0)::integer));
    v_schedule := '0 */' || v_hours::text || ' * * *';
  end if;

  perform cron.schedule(
    v_job_name,
    v_schedule,
    format('select public.call_internal(%L)', '/api/internal/poll/' || p_source_id::text)
  );
end;
$$;

-- ---------------------------------------------------------------
-- Trigger: hanya bereaksi pada perubahan yang benar-benar memengaruhi jadwal.
-- Tanpa penyaringan ini, setiap update last_success_at (tiap 5 menit, per sumber)
-- akan ikut menjadwal ulang cron — kerja sia-sia yang berisiko melewatkan satu siklus.
-- ---------------------------------------------------------------
create or replace function public.trg_reschedule_alert_source()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.reschedule_alert_source(old.id);
    return old;
  end if;

  if tg_op = 'INSERT'
     or new.polling_interval_seconds is distinct from old.polling_interval_seconds
     or new.is_active                is distinct from old.is_active
     or new.deleted_at               is distinct from old.deleted_at then
    perform public.reschedule_alert_source(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_alert_sources_reschedule on public.alert_sources;
create trigger trg_alert_sources_reschedule
  after insert or update or delete on public.alert_sources
  for each row execute function public.trg_reschedule_alert_source();

-- ---------------------------------------------------------------
-- Job harian & pemeliharaan
-- ---------------------------------------------------------------

-- Rollup harian (PRD §7.1). Dijalankan tiap jam, bukan sekali tengah malam:
-- Summary Dashboard jadi ikut hidup di hari berjalan, dan satu job yang gagal
-- tidak lagi berarti kehilangan data seharian penuh. Idempoten berkat
-- ON CONFLICT pada uq_daily_summary.
create or replace function public.rollup_daily(p_date date default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Makassar')::date);
  v_rows integer;
begin
  insert into public.alert_daily_summary as s (
    summary_date, vhcid, alert_type, cabang, group_project,
    occurrence_count, alert_count, critical_count, warning_count,
    first_occurrence_at, last_occurrence_at)
  select
    a.occurrence_date,
    a.vhcid,
    a.alert_type,
    max(a.cabang),
    max(a.group_project),
    sum(a.occurrence_count),
    count(*),
    count(*) filter (where a.severity = 'critical'),
    count(*) filter (where a.severity = 'warning'),
    min(a.first_seen_at),
    max(a.last_seen_at)
  from public.alerts a
  where a.occurrence_date = v_date
  group by a.occurrence_date, a.vhcid, a.alert_type
  on conflict (summary_date, coalesce(vhcid, ''), alert_type) do update set
    cabang              = excluded.cabang,
    group_project       = excluded.group_project,
    occurrence_count    = excluded.occurrence_count,
    alert_count         = excluded.alert_count,
    critical_count      = excluded.critical_count,
    warning_count       = excluded.warning_count,
    first_occurrence_at = excluded.first_occurrence_at,
    last_occurrence_at  = excluded.last_occurrence_at,
    updated_at          = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- Pembersihan raw > 90 hari (PRD §7.4). alert_daily_summary sengaja TIDAK ikut
-- terhapus — itulah yang menopang laporan jangka panjang di Fase 1.
create or replace function public.purge_old_data()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  -- Rollup dulu, baru hapus. Kalau urutannya terbalik, data hari-hari lama yang
  -- belum sempat teragregasi akan hilang tanpa jejak.
  -- generate_series dengan langkah interval menghasilkan timestamp, bukan date,
  -- jadi hasilnya wajib di-cast. Tanpa cast, seluruh fungsi ini gagal dan job
  -- retensi tidak pernah berjalan sama sekali.
  perform public.rollup_daily(d::date)
  from generate_series(
    ((now() at time zone 'Asia/Makassar')::date - 92)::timestamp,
    ((now() at time zone 'Asia/Makassar')::date - 89)::timestamp,
    interval '1 day') as d;

  delete from public.alerts
   where occurrence_date < (now() at time zone 'Asia/Makassar')::date - 90;

  delete from public.polling_logs
   where executed_at < now() - interval '30 days';
end;
$$;

do $$
begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('acm_rollup_daily', 'acm_purge_old', 'acm_keepalive');

  perform cron.schedule('acm_rollup_daily', '7 * * * *',
    'select public.rollup_daily()');

  perform cron.schedule('acm_purge_old', '30 2 * * *',
    'select public.purge_old_data()');

  -- Menjaga proyek Supabase gratis tidak auto-pause saat idle (PRD §10).
  perform cron.schedule('acm_keepalive', '*/5 * * * *',
    'select count(*) from public.alert_sources');
end $$;


-- ============================================================
-- 0005_upsert_alerts.sql
-- ============================================================
-- ACM — Dedup harian sebagai satu operasi atomik (PRD §7.1)

/*
  Kenapa ini fungsi database, bukan logika di Node.js:

  PostgREST tidak bisa memakai ON CONFLICT dengan target berupa *ekspresi*
  (`coalesce(vhcid,'')`) pada index parsial. Padahal justru bentuk itu yang
  dibutuhkan agar dedup aman dari balapan. Menuliskannya sebagai satu perintah
  SQL membuat seluruh batch masuk dalam satu perjalanan ke database sekaligus.

  Perilaku sesuai PRD §7.1:
    - Ada baris (vhcid, alert_type) yang masih terbuka di hari yang sama
      -> occurrence_count bertambah, last_seen_at maju. Tidak ada baris baru.
    - Tidak ada (belum pernah terjadi hari itu, atau yang sebelumnya sudah
      closed) -> baris baru dengan occurrence_count dari batch.
*/

create or replace function public.upsert_alerts(p_rows jsonb)
returns table (inserted integer, updated integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_updated  integer := 0;
begin
  with incoming as (
    select
      (r ->> 'source_id')::uuid                      as source_id,
      nullif(r ->> 'vhcid', '')                      as vhcid,
      r ->> 'alert_type'                             as alert_type,
      coalesce(r ->> 'severity', 'info')             as severity,
      (r ->> 'lat')::numeric                         as lat,
      (r ->> 'long')::numeric                        as long,
      nullif(r ->> 'cabang', '')                     as cabang,
      nullif(r ->> 'group_project', '')              as group_project,
      nullif(r ->> 'no_plat', '')                    as no_plat,
      coalesce(r -> 'raw_payload', '{}'::jsonb)      as raw_payload,
      (r ->> 'first_seen_at')::timestamptz           as first_seen_at,
      (r ->> 'last_seen_at')::timestamptz            as last_seen_at,
      greatest(coalesce((r ->> 'occurrence_count')::integer, 1), 1) as occurrence_count
    from jsonb_array_elements(p_rows) as r
  ),
  ins as (
    insert into public.alerts as a (
      source_id, vhcid, alert_type, severity, lat, long,
      cabang, group_project, no_plat, raw_payload,
      first_seen_at, last_seen_at, occurrence_count, status)
    select
      source_id, vhcid, alert_type, severity, lat, long,
      cabang, group_project, no_plat, raw_payload,
      first_seen_at, last_seen_at, occurrence_count, 'active'
    from incoming
    where alert_type is not null and first_seen_at is not null

    on conflict (coalesce(vhcid, ''), alert_type, occurrence_date)
      where status <> 'closed'
    do update set
      occurrence_count = a.occurrence_count + excluded.occurrence_count,

      -- Hanya maju, tidak pernah mundur. Window polling sengaja tumpang tindih,
      -- jadi satu batch bisa membawa kejadian yang lebih lama dari yang sudah
      -- tersimpan; tanpa penjagaan ini, "terakhir terlihat" bisa berjalan mundur.
      last_seen_at = greatest(a.last_seen_at, excluded.last_seen_at),

      -- Ambil severity dan payload dari kejadian yang benar-benar lebih baru.
      severity = case when excluded.last_seen_at > a.last_seen_at
                      then excluded.severity else a.severity end,
      raw_payload = case when excluded.last_seen_at > a.last_seen_at
                         then excluded.raw_payload else a.raw_payload end,
      lat  = coalesce(case when excluded.last_seen_at > a.last_seen_at
                           then excluded.lat else a.lat end, a.lat),
      long = coalesce(case when excluded.last_seen_at > a.last_seen_at
                           then excluded.long else a.long end, a.long),

      -- Enrichment bisa datang belakangan (unit baru didaftarkan di master
      -- data setelah alert pertamanya masuk), jadi jangan menimpa nilai yang
      -- sudah terisi dengan null.
      cabang        = coalesce(excluded.cabang, a.cabang),
      group_project = coalesce(excluded.group_project, a.group_project),
      no_plat       = coalesce(excluded.no_plat, a.no_plat)

    returning (xmax = 0) as was_insert
  )
  select
    count(*) filter (where was_insert),
    count(*) filter (where not was_insert)
  into v_inserted, v_updated
  from ins;

  return query select v_inserted, v_updated;
end;
$$;

/*
  Penghitung kegagalan berurutan (modul Kesehatan API).
  Dinaikkan di dalam database supaya dua polling yang gagal bersamaan tidak
  saling menimpa hasil hitungannya.
*/
create or replace function public.bump_source_failure(p_source_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  update public.alert_sources
     set consecutive_failures = consecutive_failures + 1
   where id = p_source_id
  returning consecutive_failures into v_count;
  return v_count;
end;
$$;

revoke all on function public.upsert_alerts(jsonb) from public, anon, authenticated;
revoke all on function public.bump_source_failure(uuid) from public, anon, authenticated;


-- ============================================================
-- 0006_alert_type_master.sql
-- ============================================================
-- ACM — Master Data Jenis Notifikasi
--
-- Memindahkan pemetaan `tipe_notif` -> alert_type dari JSON di dalam
-- alert_sources ke master data yang bisa dikelola lewat UI.
--
-- Alasannya bukan kerapian: jenis notifikasi di TMS EASYGO bisa bertambah atau
-- berganti nama tanpa pemberitahuan. Selama pemetaannya berupa JSON di kolom
-- konfigurasi, setiap perubahan menuntut orang yang paham struktur JSON. Sebagai
-- master data, staf non-developer cukup mengubah satu baris — sejalan dengan
-- tujuan PRD §2.2 bahwa sumber alert dikelola lewat UI, bukan lewat kode.

create table if not exists public.alert_type_master (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.alert_sources (id) on delete cascade,

  -- Nilai mentah persis seperti yang dikirim API, mis. 'Forbidden Driving'.
  -- Disimpan apa adanya supaya yang tampil di UI sama dengan yang dikirim API.
  notif_value   text not null,

  -- Bentuk huruf kecil sebagai kunci pencocokan. Dibuat sebagai kolom generated,
  -- bukan unique index berbasis ekspresi lower(notif_value): ON CONFLICT lewat
  -- PostgREST hanya bisa menargetkan nama kolom, tidak bisa menargetkan
  -- ekspresi. Dengan bentuk ini, upsert dari skrip seed maupun dari UI nanti
  -- sama-sama bekerja.
  notif_value_key text generated always as (lower(trim(notif_value))) stored,

  -- Kode alert_type ACM. NULL berarti jenis ini terdeteksi tapi belum dipetakan
  -- — inilah keadaan awal setiap jenis yang baru ditemukan.
  alert_type    text,

  label         text,
  severity      text check (severity in ('critical', 'warning', 'info')),

  -- Flag utama. Hanya jenis yang aktif DAN sudah punya alert_type yang diproses
  -- jadi alert. Default false: jenis baru tidak boleh diam-diam masuk ke
  -- dashboard sebelum ada yang meninjaunya.
  is_active     boolean not null default false,

  -- true jika baris ini lahir dari penemuan otomatis saat polling,
  -- bukan diketik manusia.
  auto_discovered boolean not null default false,

  -- Jejak penemuan, supaya admin bisa menilai apakah suatu jenis layak
  -- diaktifkan: seberapa sering muncul, kapan terakhir, dan contoh datanya.
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  seen_count     bigint not null default 0,
  sample_payload jsonb,

  notes         text,
  updated_by    uuid references public.user_profiles (user_id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Pencocokan case-insensitive: penulisan tipe_notif di API tidak konsisten
-- (UPPERCASE untuk IDLE, Title Case untuk Forbidden Parking). Keunikan
-- ditegakkan pada bentuk huruf kecilnya supaya 'IDLE' dan 'Idle' tidak pernah
-- jadi dua baris master yang saling bertentangan.
alter table public.alert_type_master
  drop constraint if exists uq_alert_type_master;
alter table public.alert_type_master
  add constraint uq_alert_type_master unique (source_id, notif_value_key);

create index if not exists idx_alert_type_master_active
  on public.alert_type_master (source_id, is_active);

-- Jenis yang terdeteksi tapi belum ditangani — ini yang perlu dilihat admin.
create or replace view public.unmapped_notif_types as
  select m.*, s.name as source_name
    from public.alert_type_master m
    join public.alert_sources s on s.id = m.source_id
   where m.alert_type is null or m.is_active = false;

drop trigger if exists trg_touch_alert_type_master on public.alert_type_master;
create trigger trg_touch_alert_type_master
  before update on public.alert_type_master
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------
-- RLS: Staff IT & Super Admin mengelola, Management tidak berkepentingan
-- (konsisten dengan akses alert_sources di PRD §4).
-- ---------------------------------------------------------------
alter table public.alert_type_master enable row level security;

drop policy if exists atm_select on public.alert_type_master;
create policy atm_select on public.alert_type_master for select to authenticated
  using (public.is_staff());

drop policy if exists atm_write on public.alert_type_master;
create policy atm_write on public.alert_type_master for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------
-- Penemuan otomatis jenis baru.
--
-- Dipanggil poller tiap siklus dengan seluruh nilai tipe_notif yang muncul.
-- Jenis yang belum dikenal dicatat sebagai baris nonaktif tanpa alert_type,
-- jenis yang sudah ada hanya diperbarui statistik kemunculannya.
--
-- Inilah yang menjawab kebutuhan "kalau nanti API punya fatigue driving":
-- begitu EASYGO mulai mengirim jenis itu, ia muncul sendiri di master data
-- sebagai jenis belum terpetakan — tidak perlu ada yang menebak namanya
-- lebih dulu, dan tidak ada perubahan kode.
--
-- ON CONFLICT sengaja TIDAK menyentuh alert_type, is_active, label, severity,
-- dan notes: itu kolom yang diisi manusia. Polling tidak boleh menimpanya.
-- ---------------------------------------------------------------
create or replace function public.record_discovered_types(
  p_source_id uuid,
  p_types     jsonb   -- [{ "value": "...", "count": 3, "sample": {...} }, ...]
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_new integer;
begin
  with incoming as (
    select
      t ->> 'value'                              as notif_value,
      coalesce((t ->> 'count')::bigint, 1)       as cnt,
      t -> 'sample'                              as sample
    from jsonb_array_elements(p_types) as t
    where nullif(t ->> 'value', '') is not null
  ),
  ins as (
    insert into public.alert_type_master as m
      (source_id, notif_value, auto_discovered, seen_count, sample_payload, is_active)
    select p_source_id, notif_value, true, cnt, sample, false
      from incoming
    on conflict (source_id, notif_value_key) do update set
      seen_count   = m.seen_count + excluded.seen_count,
      last_seen_at = now(),
      -- Contoh payload hanya diisi kalau belum ada, supaya contoh pertama
      -- (yang biasanya sudah cukup untuk menilai) tidak terus tertimpa.
      sample_payload = coalesce(m.sample_payload, excluded.sample_payload)
    returning (xmax = 0) as was_insert
  )
  select count(*) filter (where was_insert) into v_new from ins;

  return v_new;
end;
$$;

revoke all on function public.record_discovered_types(uuid, jsonb) from public, anon;


-- ============================================================
-- 0007_realtime.sql
-- ============================================================
-- ACM — Aktifkan Realtime untuk tabel alerts (PRD §5.2 langkah 4-5)
--
-- Dilakukan lewat SQL, bukan lewat dashboard, karena letak menunya di Supabase
-- sudah beberapa kali berpindah (halaman Database → Replication kini hanya
-- berisi read replica). Sebagai migrasi, hasilnya juga ikut ter-versi bersama
-- skema dan otomatis ikut terpasang di lingkungan mana pun.

do $$
begin
  -- Publikasi ini dibuat otomatis oleh Supabase. Kalau belum ada (mis. di
  -- Postgres polos saat pengujian lokal), buat supaya migrasi tetap jalan.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'alerts'
  ) then
    alter publication supabase_realtime add table public.alerts;
  end if;
end $$;

-- Kenapa REPLICA IDENTITY dibiarkan default (primary key), bukan FULL:
--
-- Dashboard hanya memakai baris BARU dari tiap event, dan payload `new` sudah
-- lengkap dengan identitas default. FULL akan menyalin seluruh baris lama ke
-- WAL pada setiap UPDATE — padahal tabel ini menerima update dedup terus-menerus
-- sepanjang hari, dan `raw_payload` (jsonb payload asli dari EASYGO) ikut
-- tersalin setiap kali. Itu beban WAL yang besar tanpa manfaat yang dipakai.

-- Catatan penting soal keamanan:
-- Realtime tetap tunduk pada RLS. Klien yang belum login tidak akan menerima
-- event apa pun, dan Management hanya menerima event untuk cabang dalam
-- cabang_scope-nya. Jadi dashboard wall display WAJIB memakai sesi terautentikasi
-- — kalau feed diam padahal polling jelas menghasilkan baris, hal pertama yang
-- perlu dicek adalah sesi loginnya, bukan konfigurasi Realtime.


-- ============================================================
-- 0008_health.sql
-- ============================================================
-- ACM — Modul Kesehatan API (PRD §9)
--
-- Dibentuk oleh kejadian nyata pada 2026-09-07: empat siklus polling berturut
-- gagal total dengan 'SSL connect error' di lapis pg_net, dan ACM tidak mencatat
-- apa pun. `polling_logs` kosong, `consecutive_failures` tetap 0, `last_error`
-- tetap null — modul kesehatan versi awal akan menampilkannya hijau sempurna.
--
-- Sebabnya struktural: `polling_logs` ditulis OLEH aplikasi, sehingga kegagalan
-- yang terjadi SEBELUM aplikasi berjalan mustahil tercatat di sana.
--
-- Karena itu kesehatan sumber dinilai dari tiga sudut yang saling menutupi:
--   1. Kegagalan yang dilaporkan aplikasi  -> consecutive_failures / last_error
--   2. Polling yang tidak pernah terjadi   -> kebasian last_success_at
--   3. Kegagalan di lapis transport        -> net._http_response

-- ---------------------------------------------------------------
-- Ringkasan kesehatan per sumber
-- ---------------------------------------------------------------
create or replace function public.source_health()
returns table (
  id                       uuid,
  name                     text,
  alert_type               text,
  is_active                boolean,
  polling_interval_seconds integer,
  last_success_at          timestamptz,
  seconds_since_success    integer,
  staleness_limit_seconds  integer,
  consecutive_failures     integer,
  last_error               text,
  status                   text,
  alasan                   text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  -- SECURITY DEFINER melewati RLS, jadi hak aksesnya ditegakkan di sini.
  -- Management tidak punya akses ke modul ini sama sekali (PRD §4).
  if not public.is_staff() then
    raise exception 'Tidak diizinkan' using errcode = '42501';
  end if;

  return query
  with s as (
    select
      a.id, a.name, a.alert_type, a.is_active, a.polling_interval_seconds,
      a.last_success_at, a.consecutive_failures, a.last_error,
      extract(epoch from (now() - a.last_success_at))::integer as age,
      -- Ambang 2,5x interval, BUKAN 3x.
      -- Dengan 3x (900 detik pada interval 300 detik), gangguan dua siklus
      -- seperti 04:00-04:05 yang benar-benar terjadi justru lolos tanpa
      -- terdeteksi. 2,5x menangkapnya sambil tetap memberi kelonggaran untuk
      -- satu siklus yang telat.
      (a.polling_interval_seconds * 2.5)::integer as limit_s
    from public.alert_sources a
    where a.deleted_at is null
  )
  select
    s.id, s.name, s.alert_type, s.is_active, s.polling_interval_seconds,
    s.last_success_at, s.age, s.limit_s, s.consecutive_failures, s.last_error,
    case
      when not s.is_active                      then 'nonaktif'
      when s.last_success_at is null            then 'belum pernah'
      when s.age > s.limit_s                    then 'basi'
      when s.consecutive_failures > 0           then 'gagal'
      else                                           'sehat'
    end,
    case
      when not s.is_active           then 'Sumber dinonaktifkan lewat konfigurasi'
      when s.last_success_at is null then 'Belum pernah berhasil satu kali pun'
      when s.age > s.limit_s         then format(
        'Tidak ada polling sukses selama %s detik, melewati ambang %s detik. '
        || 'Polling mungkin tidak pernah dijalankan — periksa net._http_response.',
        s.age, s.limit_s)
      when s.consecutive_failures > 0 then format(
        '%s kegagalan berturut-turut. Terakhir: %s',
        s.consecutive_failures, coalesce(s.last_error, 'tanpa pesan'))
      else 'Polling berjalan sesuai jadwal'
    end
  from s
  order by
    case
      when not s.is_active then 3
      when s.last_success_at is null or s.age > s.limit_s or s.consecutive_failures > 0 then 0
      else 2
    end,
    s.name;
end;
$$;

-- ---------------------------------------------------------------
-- Kegagalan di lapis transport (pg_net)
--
-- Ini satu-satunya tempat yang tahu kalau permintaan tidak pernah sampai ke
-- aplikasi: galat TLS, DNS, timeout koneksi, atau HTTP non-200 seperti halaman
-- login Vercel yang muncul saat Deployment Protection masih menyala.
-- ---------------------------------------------------------------
create or replace function public.transport_failures(p_minutes integer default 60)
returns table (
  id          bigint,
  status_code integer,
  error_msg   text,
  content     text,
  created     timestamptz
)
language plpgsql stable security definer set search_path = public, net
as $$
begin
  if not public.is_staff() then
    raise exception 'Tidak diizinkan' using errcode = '42501';
  end if;

  return query
  select r.id, r.status_code, r.error_msg, left(r.content, 200), r.created
    from net._http_response r
   where r.created > now() - make_interval(mins => greatest(p_minutes, 1))
     -- Hanya yang bermasalah. Panggilan sukses sudah terwakili di polling_logs
     -- dengan informasi yang jauh lebih berguna.
     and (r.status_code is null or r.status_code <> 200 or r.error_msg is not null)
   order by r.created desc
   limit 50;
end;
$$;

revoke all on function public.source_health() from public, anon;
revoke all on function public.transport_failures(integer) from public, anon;
grant execute on function public.source_health() to authenticated;
grant execute on function public.transport_failures(integer) to authenticated;

