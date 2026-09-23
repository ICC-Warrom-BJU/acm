-- ACM — Hitung kejadian berdasarkan sidik jari record, bukan jam terakhir
--
-- Latar belakang, dari pengukuran 2026-09-23 (FINDINGS 6.5):
--
--   EASYGO menerbitkan record TERLAMBAT. Window 15 menit yang ditanyakan saat
--   itu juga hanya memuat ~80% isinya; sisanya menyusul, dan baru lengkap pada
--   umur sekitar 63 menit. Akibatnya lookback 900 detik kehilangan 41% record.
--
-- Perbaikannya menuntut lookback jauh lebih panjang. Tapi lookback panjang
-- membuat satu record dikirim ulang puluhan kali, dan penyaring berbasis jam
-- (`buangKirimanUlang`, 2026-09-23) tidak cukup untuk itu:
--
--   Satu unit bisa punya BEBERAPA record dengan gps_time yang sama persis —
--   segmen berkendara berbeda yang dipancarkan dalam satu batch (terbukti pada
--   VEH0158741: tiga record pukul 07:00:28, koordinat dan durasi berbeda).
--   Kalau segmen kedua dan ketiga terbit belakangan, penyaring jam akan
--   membuangnya karena "tidak lebih baru" — kejadian nyata hilang.
--
-- Jadi yang dibandingkan bukan lagi jamnya, melainkan sidik jari tiap record.
-- Kiriman ulang punya sidik jari yang sama persis dan tidak terhitung; segmen
-- berbeda punya sidik jari berbeda dan tetap terhitung, seberapa pun
-- terlambatnya ia terbit.

alter table public.alerts
  add column if not exists seen_fingerprints text[] not null default '{}';

comment on column public.alerts.seen_fingerprints is
  'Sidik jari setiap record yang sudah pernah dihitung ke occurrence_count. Dipakai agar polling dengan window tumpang tindih tidak menghitung kejadian yang sama dua kali, dan agar record yang terbit terlambat tetap terhitung.';

/*
  Tidak diisi surut untuk baris lama.

  Sidik jari hanya bisa dihitung dari record aslinya, dan ACM cuma menyimpan
  payload kejadian TERAKHIR per baris — bukan setiap kejadiannya. Baris lama
  karena itu mulai dengan array kosong, dan klausa di bawah memperlakukan array
  kosong sebagai "belum ada catatan" sehingga perilaku lamanya tetap berlaku
  untuk baris tersebut. Angka historisnya tidak berubah dan memang tidak bisa
  dipulihkan (FINDINGS 6.4).
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
      greatest(coalesce((r ->> 'occurrence_count')::integer, 1), 1) as occurrence_count,

      -- Boleh kosong: pemanggil lama (mis. skrip impor satu kali) tetap
      -- bekerja dengan perilaku sebelumnya.
      coalesce(
        (select array_agg(distinct f) from jsonb_array_elements_text(
           case when jsonb_typeof(r -> 'fingerprints') = 'array'
                then r -> 'fingerprints' else '[]'::jsonb end) as f),
        '{}'::text[]
      ) as fingerprints
    from jsonb_array_elements(p_rows) as r
  ),
  ins as (
    insert into public.alerts as a (
      source_id, vhcid, alert_type, severity, lat, long,
      cabang, group_project, no_plat, raw_payload,
      first_seen_at, last_seen_at, occurrence_count, status, seen_fingerprints)
    select
      source_id, vhcid, alert_type, severity, lat, long,
      cabang, group_project, no_plat, raw_payload,
      first_seen_at, last_seen_at,
      -- Kalau sidik jari tersedia, jumlahnya yang jadi hitungan kejadian —
      -- sudah unik karena di-distinct di atas.
      case when coalesce(array_length(fingerprints, 1), 0) > 0
           then array_length(fingerprints, 1) else occurrence_count end,
      'active', fingerprints
    from incoming
    where alert_type is not null and first_seen_at is not null

    on conflict (coalesce(vhcid, ''), alert_type, occurrence_date)
      where status <> 'closed'
    do update set
      /*
        Hanya sidik jari yang BELUM pernah tercatat yang menambah hitungan.
        Inilah inti perbaikannya: kiriman ulang menjadi tidak berbiaya, sehingga
        lookback boleh sepanjang apa pun tanpa menggelembungkan angka.
      */
      occurrence_count = a.occurrence_count + (
        case
          when coalesce(array_length(excluded.seen_fingerprints, 1), 0) = 0
            then excluded.occurrence_count
          else (
            select count(*)::integer
              from unnest(excluded.seen_fingerprints) as f
             where not (f = any (a.seen_fingerprints))
          )
        end
      ),

      seen_fingerprints = (
        case
          when coalesce(array_length(excluded.seen_fingerprints, 1), 0) = 0
            then a.seen_fingerprints
          else a.seen_fingerprints || (
            select coalesce(array_agg(f), '{}'::text[])
              from unnest(excluded.seen_fingerprints) as f
             where not (f = any (a.seen_fingerprints))
          )
        end
      ),

      -- Hanya maju, tidak pernah mundur. Window polling sengaja tumpang tindih,
      -- jadi satu batch bisa membawa kejadian yang lebih lama dari yang sudah
      -- tersimpan; tanpa penjagaan ini, "terakhir terlihat" bisa berjalan mundur.
      last_seen_at = greatest(a.last_seen_at, excluded.last_seen_at),

      -- Kejadian yang terbit terlambat bisa lebih TUA dari yang sudah tersimpan.
      -- Karena itu first_seen_at ikut dijaga agar selalu mundur ke yang paling
      -- awal; tanpa ini, "pertama terlihat" akan menunjuk kejadian yang
      -- kebetulan terbit lebih dulu, bukan yang benar-benar terjadi lebih dulu.
      first_seen_at = least(a.first_seen_at, excluded.first_seen_at),

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

revoke all on function public.upsert_alerts(jsonb) from public, anon, authenticated;
