import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Klien Supabase untuk Server Component & Route Handler.
 *
 * Tunduk pada RLS — identitas pengguna dibaca dari cookie sesi. Ini yang dipakai
 * untuk pengecekan role di lapis API (PRD §4), bukan klien service-role.
 */
export function createServerSupabase() {
  const store = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(list: { name: string; value: string; options: CookieOptions }[]) {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Server Component tidak boleh menulis cookie. Aman diabaikan:
            // middleware yang bertugas menyegarkan sesi.
          }
        },
      },
    },
  );
}

export type Role = 'super_admin' | 'staff_it' | 'management';

export interface CurrentUser {
  id: string;
  email: string | null;
  fullName: string;
  role: Role;
  cabangScope: string[] | null;
}

/** Pengguna aktif beserta rolenya, atau null kalau belum login. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = createServerSupabase();

  // getUser(), bukan getSession(): getSession hanya membaca cookie apa adanya,
  // sedangkan getUser memvalidasi token ke server Supabase. Untuk keputusan
  // otorisasi, cookie yang belum divalidasi tidak cukup.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('full_name, role, cabang_scope')
    .eq('user_id', user.id)
    .single();

  return {
    id: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name || (user.email ?? ''),
    // Tanpa profil, jatuh ke role paling rendah. Gagal ke arah yang aman:
    // lebih baik akses kurang daripada terlanjur terlalu luas.
    role: (profile?.role as Role) ?? 'management',
    cabangScope: profile?.cabang_scope ?? null,
  };
}

/** Penjaga role untuk halaman & route yang hanya boleh diakses staf. */
export function isStaff(role: Role) {
  return role === 'super_admin' || role === 'staff_it';
}
