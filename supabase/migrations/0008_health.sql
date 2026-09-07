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
