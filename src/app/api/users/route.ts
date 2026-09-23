import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { pastikanSuperAdmin, bersihkanScope, ROLE_VALID, PANJANG_SANDI_MIN } from '@/lib/users';

/**
 * Manajemen pengguna (PRD §4 — hanya Super Admin).
 *
 * Seluruh operasi akun menuntut service role, yang hanya ada di server. Klien
 * tidak pernah menyentuh Supabase Auth Admin secara langsung.
 *
 * GET  /api/users  -> daftar pengguna
 * POST /api/users  -> buat pengguna baru
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { galat } = await pastikanSuperAdmin();
  if (galat) return galat;

  // Daftar diambil lewat fungsi database, bukan service role, supaya hak
  // aksesnya ditegakkan dua lapis: di route ini dan di dalam list_users().
  const { data, error } = await createServerSupabase().rpc('list_users');
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  /*
    Status penonaktifan hanya tersedia lewat Auth Admin API, bukan sebagai
    kolom yang bisa dibaca SQL di semua versi skema Supabase. Digabungkan di
    sini supaya halaman tetap melihat satu bentuk data.
  */
  let banned = new Map<string, string | null>();
  try {
    const { data: auth } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
    banned = new Map(auth.users.map((u) => [u.id, (u as { banned_until?: string }).banned_until ?? null]));
  } catch {
    // Gagal membaca status ban tidak boleh menggagalkan seluruh halaman —
    // daftar penggunanya jauh lebih penting daripada satu kolom status.
  }

  const rows = (data ?? []).map((u: Record<string, unknown>) => ({
    ...u,
    nonaktif: Boolean(banned.get(u.user_id as string)),
  }));

  return NextResponse.json({ users: rows });
}

export async function POST(req: NextRequest) {
  const { galat } = await pastikanSuperAdmin();
  if (galat) return galat;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 });

  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const full_name = String(body.full_name ?? '').trim();
  const role = String(body.role ?? '');
  const cabang_scope = bersihkanScope(body.cabang_scope);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Alamat email tidak valid.' }, { status: 400 });
  }
  if (password.length < PANJANG_SANDI_MIN) {
    return NextResponse.json(
      { error: `Kata sandi minimal ${PANJANG_SANDI_MIN} karakter.` },
      { status: 400 },
    );
  }
  if (!ROLE_VALID.includes(role as never)) {
    return NextResponse.json({ error: 'Role tidak dikenal.' }, { status: 400 });
  }
  if (!full_name) {
    return NextResponse.json({ error: 'Nama lengkap wajib diisi.' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: dibuat, error: eBuat } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (eBuat) {
    return NextResponse.json(
      {
        error: /already|registered|exists/i.test(eBuat.message)
          ? 'Email itu sudah terdaftar. Gunakan alamat lain, atau ubah akun yang sudah ada.'
          : eBuat.message,
      },
      { status: 400 },
    );
  }

  // Trigger handle_new_user sudah membuat baris profilnya dengan role terendah.
  // Di sini role dan scope-nya ditetapkan sesuai yang diminta.
  const { error: eProfil } = await admin
    .from('user_profiles')
    .update({ full_name, role, cabang_scope })
    .eq('user_id', dibuat.user.id);

  if (eProfil) {
    /*
      Akun auth sudah terlanjur dibuat tapi profilnya gagal ditetapkan.
      Dibiarkan begitu, akun itu akan hidup dengan role terendah dan tanpa
      jejak kenapa — jadi lebih baik dibatalkan sekalian.
    */
    await admin.auth.admin.deleteUser(dibuat.user.id);
    return NextResponse.json(
      { error: `Gagal menetapkan role, akun dibatalkan: ${eProfil.message}` },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, user_id: dibuat.user.id });
}
