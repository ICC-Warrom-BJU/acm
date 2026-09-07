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
