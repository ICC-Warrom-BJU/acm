import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { pastikanSuperAdmin, PANJANG_SANDI_MIN } from '@/lib/users';

/**
 * POST /api/users/:id/password — ubah kata sandi.
 *
 * Dua jalur dengan syarat berbeda:
 *
 *   Super Admin mengubah sandi ORANG LAIN  -> tidak perlu sandi lama
 *   Siapa pun mengubah sandinya SENDIRI    -> wajib menyertakan sandi lama
 *
 * Syarat sandi lama untuk diri sendiri bukan formalitas: tanpa itu, perangkat
 * yang tertinggal dalam keadaan login bisa dipakai siapa saja untuk mengambil
 * alih akun secara permanen.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const pemanggil = await getCurrentUser();
  if (!pemanggil) return NextResponse.json({ error: 'Belum login' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 });

  const baru = String(body.password ?? '');
  const lama = String(body.password_lama ?? '');
  const sendiri = params.id === pemanggil.id;

  if (baru.length < PANJANG_SANDI_MIN) {
    return NextResponse.json(
      { error: `Kata sandi minimal ${PANJANG_SANDI_MIN} karakter.` },
      { status: 400 },
    );
  }

  if (sendiri) {
    if (!lama) {
      return NextResponse.json(
        { error: 'Masukkan kata sandi lama untuk mengubah sandi Anda sendiri.' },
        { status: 400 },
      );
    }
    if (lama === baru) {
      return NextResponse.json(
        { error: 'Kata sandi baru harus berbeda dari yang lama.' },
        { status: 400 },
      );
    }

    /*
      Sandi lama diverifikasi dengan benar-benar mencoba login memakainya, di
      klien terpisah tanpa sesi. Supabase tidak menyediakan cara memeriksa
      sandi tanpa masuk, dan memakai klien sesi akan menimpa sesi yang sedang
      berjalan.
    */
    const uji = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await uji.auth.signInWithPassword({
      email: pemanggil.email ?? '',
      password: lama,
    });
    if (error) {
      return NextResponse.json({ error: 'Kata sandi lama salah.' }, { status: 400 });
    }
    await uji.auth.signOut();
  } else {
    // Mengubah sandi orang lain adalah wewenang Super Admin.
    const { galat } = await pastikanSuperAdmin();
    if (galat) return galat;
  }

  const { error } = await createAdminClient().auth.admin.updateUserById(params.id, {
    password: baru,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
