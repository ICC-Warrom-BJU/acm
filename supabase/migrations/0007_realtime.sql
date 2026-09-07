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
