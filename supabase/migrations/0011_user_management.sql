-- ACM — Manajemen pengguna: scope cabang berlaku untuk Staff IT juga
--
-- Sebelumnya `cabang_visible()` memberi jalan bebas ke siapa pun yang
-- `is_staff()`, sehingga `cabang_scope` hanya benar-benar membatasi Management.
-- Akibatnya "akun Staff IT untuk cabang MKS1" tidak mungkin dibuat — ia tetap
-- melihat seluruh armada.
--
-- Aturan baru:
--   super_admin           -> selalu melihat semua, scope diabaikan
--   staff_it & management -> dibatasi cabang_scope bila diisi
--   cabang_scope NULL     -> tanpa batasan (perilaku lama tetap berlaku)
--
-- Karena NULL berarti "tanpa batasan", akun yang sudah ada TIDAK berubah
-- perilakunya. Pembatasan hanya berlaku untuk akun yang scope-nya sengaja diisi.

create or replace function public.cabang_visible(target text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    -- Super Admin tidak pernah dibatasi: ia yang mengelola scope orang lain,
    -- jadi mengurungnya sendiri berisiko mengunci akses pemulihan.
    when public.is_super_admin() then true
    when public.current_cabang_scope() is null then true

    -- Alert dari unit yang belum terdaftar bercabang NULL. Tanpa baris ini,
    -- perbandingan dengan array menghasilkan NULL (bukan false) dan barisnya
    -- hilang diam-diam dari semua pengguna ber-scope — padahal unit tak
    -- terdaftar justru yang paling perlu ketahuan (PRD §7.3).
    when target is null then true

    else target = any (public.current_cabang_scope())
  end
$$;

comment on function public.cabang_visible(text) is
  'Menentukan apakah sebuah baris bercabang `target` boleh dilihat pengguna saat ini. Super Admin selalu boleh; role lain dibatasi cabang_scope bila diisi. Baris tanpa cabang selalu terlihat.';

-- ---------------------------------------------------------------
-- Daftar pengguna untuk halaman manajemen.
--
-- Dibuat sebagai fungsi SECURITY DEFINER karena `auth.users` tidak bisa
-- dibaca lewat PostgREST, sedangkan halaman butuh email dan waktu login
-- terakhir — keduanya hanya ada di sana.
--
-- Hak akses ditegakkan di dalam fungsi: hanya Super Admin (PRD §4, manajemen
-- pengguna & role bukan wewenang Staff IT maupun Management).
--
-- Status penonaktifan (banned_until) sengaja TIDAK diambil di sini: kolom itu
-- tidak ada di semua versi skema auth Supabase, sehingga fungsinya akan gagal
-- di lingkungan pengujian lokal. Statusnya diambil route API lewat admin API,
-- yang menyediakannya secara konsisten.
-- ---------------------------------------------------------------
-- Dihapus dulu: `create or replace` menolak perubahan tipe kembalian, sehingga
-- migrasi yang dijalankan ulang setelah daftar kolomnya berubah akan gagal.
drop function if exists public.list_users();

create function public.list_users()
returns table (
  user_id        uuid,
  email          text,
  full_name      text,
  role           text,
  cabang_scope   text[],
  last_sign_in_at timestamptz,
  created_at     timestamptz
)
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Hanya Super Admin yang dapat mengelola pengguna'
      using errcode = '42501';
  end if;

  return query
  select p.user_id, u.email::text, p.full_name, p.role, p.cabang_scope,
         u.last_sign_in_at, p.created_at
    from public.user_profiles p
    join auth.users u on u.id = p.user_id
   order by
     -- Super Admin lebih dulu, lalu Staff IT, lalu Management — urutan
     -- wewenang, bukan abjad, supaya akun paling berkuasa selalu terlihat.
     case p.role when 'super_admin' then 0 when 'staff_it' then 1 else 2 end,
     p.full_name nulls last;
end;
$$;

revoke all on function public.list_users() from public, anon;
grant execute on function public.list_users() to authenticated;

-- ---------------------------------------------------------------
-- Penjaga: jangan sampai Super Admin terakhir hilang.
--
-- Tanpa ini, satu klik salah bisa membuat sistem tidak punya seorang pun yang
-- berwenang membuat pengguna baru — dan memulihkannya menuntut akses langsung
-- ke database, bukan lewat aplikasi.
-- ---------------------------------------------------------------
create or replace function public.jaga_super_admin_terakhir()
returns trigger language plpgsql as $$
begin
  if old.role = 'super_admin' and (tg_op = 'DELETE' or new.role <> 'super_admin') then
    if (select count(*) from public.user_profiles where role = 'super_admin') <= 1 then
      raise exception 'Tidak bisa menghapus atau menurunkan Super Admin terakhir'
        using errcode = 'P0001';
    end if;
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_jaga_super_admin on public.user_profiles;
create trigger trg_jaga_super_admin
  before update or delete on public.user_profiles
  for each row execute function public.jaga_super_admin_terakhir();
