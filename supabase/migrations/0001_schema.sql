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
