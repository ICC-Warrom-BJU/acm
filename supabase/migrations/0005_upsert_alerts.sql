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
