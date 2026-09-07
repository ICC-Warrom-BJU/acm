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
