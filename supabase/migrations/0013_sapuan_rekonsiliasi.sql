-- ACM — Sapuan rekonsiliasi harian
--
-- Kenapa polling biasa tidak cukup (diukur 2026-09-23, FINDINGS 6.5):
--
--   EASYGO menerbitkan record TERLAMBAT. Window 15 menit yang ditanyakan saat
--   itu juga hanya memuat ~80% isinya; sisanya menyusul dan baru lengkap pada
--   umur sekitar 63 menit. Dengan lookback 900 detik, 41% record tidak pernah
--   terambil — dan pada Forbidden Driving, yang kejadiannya menumpuk di satu
--   burst pagi, yang hilang mencapai ~95%.
--
--   Memperpanjang lookback menutup sebagian besar celah, tapi tidak seluruhnya:
--   keterlambatannya menetes dan tidak punya batas pasti. Berapa pun angkanya,
--   selalu ada ekor yang lolos.
--
-- Sapuan ini yang menutup ekornya: sekali sehari, seluruh hari kemarin ditarik
-- ulang saat datanya sudah pasti lengkap. Aman diulang karena hitungan kejadian
-- kini berbasis sidik jari record (migrasi 0012) — record yang sudah pernah
-- masuk tidak terhitung dua kali.
--
-- WAJIB dijalankan SETELAH 0012. Tanpa sidik jari, sapuan ini justru akan
-- menggelembungkan occurrence_count setiap kali ia berjalan.

-- ---------------------------------------------------------------
-- Sapuan dipecah jadi potongan 6 jam.
--
-- Bukan satu panggilan sehari penuh: fungsi serverless Vercel berhenti di 60
-- detik, dan satu hari penuh speed_flag terukur ~21 detik di sisi API saja,
-- belum termasuk penulisan ~6.600 record. Gagal di tengah penulisan jauh lebih
-- buruk daripada empat panggilan kecil yang masing-masing pasti selesai.
--
-- `offset` menggeser ujung window ke belakang, jadi keempat potongan bersama-
-- sama menutup 24 jam terakhir.
-- ---------------------------------------------------------------
create or replace function public.sapu_rekonsiliasi()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_src  record;
  v_geser integer;
  v_n    integer := 0;
begin
  for v_src in
    select id, name from public.alert_sources
     where is_active and deleted_at is null and time_window_enabled
  loop
    -- 6, 12, 18, 24 jam ke belakang; tiap potongan menarik 6 jam sebelumnya.
    foreach v_geser in array array[0, 21600, 43200, 64800]
    loop
      perform public.call_internal(
        '/api/internal/poll/' || v_src.id::text ||
        '?lookback=21600&offset=' || v_geser::text
      );
      v_n := v_n + 1;
    end loop;
  end loop;

  return v_n;
end;
$$;

comment on function public.sapu_rekonsiliasi() is
  'Menarik ulang 24 jam terakhir dalam 4 potongan 6 jam, untuk menambal record EASYGO yang terbit terlambat. Aman diulang karena dedup berbasis sidik jari (migrasi 0012).';

-- ---------------------------------------------------------------
-- Jadwal: 03:10 WITA = 19:10 UTC hari sebelumnya.
--
-- Dipilih karena dua alasan. Forbidden Driving terbit pukul 07:00–11:00 WIB,
-- jadi pada jam itu data kemarin sudah lama lengkap. Dan trafik operasional
-- sedang paling sepi, sehingga empat panggilan beruntun tidak bersaing dengan
-- polling normal.
--
-- Menit 10, bukan 00: pada menit bulat pg_cron menjalankan banyak job sekaligus
-- dan panggilan pg_net bisa saling menunggu.
-- ---------------------------------------------------------------
select cron.unschedule('acm_sapu_rekonsiliasi')
 where exists (select 1 from cron.job where jobname = 'acm_sapu_rekonsiliasi');

select cron.schedule(
  'acm_sapu_rekonsiliasi',
  '10 19 * * *',
  'select public.sapu_rekonsiliasi()'
);

revoke all on function public.sapu_rekonsiliasi() from public, anon, authenticated;
