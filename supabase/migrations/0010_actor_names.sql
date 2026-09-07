-- ACM — Simpan nama penangan langsung di baris alert
--
-- Sebelumnya nama diambil lewat embed foreign key ke `user_profiles`. Dua
-- masalah, keduanya terbukti pada 2026-09-07:
--
-- 1. RLS memblokirnya. Policy `up_select` hanya mengizinkan seseorang membaca
--    profilnya SENDIRI (atau semua, bila Super Admin). Akibatnya Staff IT —
--    justru pengguna utama layar antrian — selalu mendapat NULL saat mencoba
--    membaca nama rekannya. Diuji langsung dengan akun staff_it.
--
--    Melonggarkan RLS bukan jawabannya: profil memuat `cabang_scope` dan role,
--    yang tidak perlu dibaca semua orang hanya demi menampilkan sebuah nama.
--
-- 2. Baris yang tiba lewat Realtime tidak membawa hasil embed. Postgres hanya
--    mengirim kolom mentah, sehingga nama baru muncul setelah halaman dimuat
--    ulang.
--
-- Menyimpan namanya sebagai kolom biasa menyelesaikan keduanya sekaligus.
--
-- Ini denormalisasi yang disengaja. Kolom uuid (`acknowledged_by`,
-- `closed_by`) tetap ada dan tetap menjadi rujukan audit yang sah; kolom nama
-- hanya salinan untuk ditampilkan. Kalau seseorang berganti nama, baris lama
-- tetap menyimpan nama saat tindakan itu dilakukan — untuk jejak audit, itu
-- justru perilaku yang benar.

alter table public.alerts
  add column if not exists acknowledged_by_name text,
  add column if not exists closed_by_name       text;

comment on column public.alerts.acknowledged_by_name is
  'Salinan nama penangan untuk ditampilkan. Rujukan audit tetap acknowledged_by. Sengaja tidak ikut berubah bila nama penggunanya diganti.';

comment on column public.alerts.closed_by_name is
  'Salinan nama penutup untuk ditampilkan. Rujukan audit tetap closed_by.';

-- Isi baris yang sudah ada.
update public.alerts a
   set acknowledged_by_name = p.full_name
  from public.user_profiles p
 where a.acknowledged_by = p.user_id
   and a.acknowledged_by_name is null;

update public.alerts a
   set closed_by_name = p.full_name
  from public.user_profiles p
 where a.closed_by = p.user_id
   and a.closed_by_name is null;
