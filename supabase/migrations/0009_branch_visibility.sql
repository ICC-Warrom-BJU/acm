-- ACM — Konfigurasi jenis alert yang tampil per cabang
--
-- Kebutuhan: sebagian cabang hanya perlu memantau sebagian jenis alert.
-- Contoh: MKS1 dan JKT1 cukup speed_flag, jenis lain tidak perlu tampil.
--
-- Ini filter TAMPILAN, bukan filter pengambilan data. Alert tetap dipolling,
-- disimpan, diagregasi ke ringkasan harian, dan ikut terekspor. Yang berubah
-- hanya apa yang muncul di dashboard.
--
-- Perbedaan itu disengaja dan penting: kalau penyaringan dilakukan saat
-- polling, data yang hari ini dianggap tidak perlu akan hilang permanen, dan
-- saat kelak dibutuhkan untuk investigasi atau laporan, ia sudah tidak ada.
-- Menyaring di tampilan bisa dibatalkan kapan saja; membuang data tidak.

create table if not exists public.branch_alert_config (
  cabang      text primary key,

  -- Daftar putih jenis alert yang boleh tampil untuk cabang ini.
  --
  -- NULL  = tidak ada pembatasan, seluruh jenis tampil. Ini yang berlaku untuk
  --         cabang yang belum pernah dikonfigurasi, sehingga menambah cabang
  --         baru di master data tidak diam-diam menyembunyikan alertnya.
  -- '{}'  = tidak ada jenis yang tampil (cabang sengaja dibisukan).
  alert_types text[],

  catatan     text,
  updated_by  uuid references public.user_profiles (user_id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.branch_alert_config.alert_types is
  'Daftar putih jenis alert yang tampil di dashboard untuk cabang ini. NULL berarti semua tampil. Tidak memengaruhi penyimpanan, ringkasan, maupun ekspor.';

drop trigger if exists trg_touch_branch_alert_config on public.branch_alert_config;
create trigger trg_touch_branch_alert_config
  before update on public.branch_alert_config
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------
-- RLS
--
-- SELECT terbuka untuk semua role yang login — dashboard setiap pengguna perlu
-- membacanya untuk tahu apa yang harus ditampilkan, termasuk Management.
-- Yang dibatasi hanya siapa yang boleh mengubahnya (PRD §4).
-- ---------------------------------------------------------------
alter table public.branch_alert_config enable row level security;

drop policy if exists bac_select on public.branch_alert_config;
create policy bac_select on public.branch_alert_config for select to authenticated
  using (true);

drop policy if exists bac_write on public.branch_alert_config;
create policy bac_write on public.branch_alert_config for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
