import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { pastikanSuperAdmin, bersihkanScope, ROLE_VALID } from '@/lib/users';

/**
 * PATCH  /api/users/:id  -> ubah nama, role, scope cabang, aktif/nonaktif
 * DELETE /api/users/:id  -> hapus akun permanen
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, galat } = await pastikanSuperAdmin();
  if (galat) return galat;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 });

  const admin = createAdminClient();
  const sendiri = params.id === user!.id;

  // --- aktif / nonaktif ----------------------------------------------------
  if (typeof body.nonaktif === 'boolean') {
    /*
      Menonaktifkan diri sendiri akan langsung mengunci Super Admin keluar dari
      sistemnya sendiri, dan memulihkannya menuntut akses langsung ke database.
      Ditolak di sini, bukan sekadar disembunyikan di UI.
    */
    if (sendiri) {
      return NextResponse.json(
        { error: 'Anda tidak bisa menonaktifkan akun Anda sendiri.' },
        { status: 400 },
      );
    }

    // ban_duration 'none' mencabut penonaktifan; angka besar menahannya
    // tanpa batas praktis. Supabase tidak menyediakan "selamanya".
    const { error } = await admin.auth.admin.updateUserById(params.id, {
      ban_duration: body.nonaktif ? '876000h' : 'none',
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // --- profil --------------------------------------------------------------
  const patch: Record<string, unknown> = {};

  if (typeof body.full_name === 'string') {
    const nama = body.full_name.trim();
    if (!nama) return NextResponse.json({ error: 'Nama lengkap wajib diisi.' }, { status: 400 });
    patch.full_name = nama;
  }

  if (typeof body.role === 'string') {
    if (!ROLE_VALID.includes(body.role as never)) {
      return NextResponse.json({ error: 'Role tidak dikenal.' }, { status: 400 });
    }
    // Menurunkan role sendiri mencabut wewenang yang sedang dipakai untuk
    // melakukannya. Penjaga super admin terakhir di database menangkap kasus
    // yang lebih luas; ini menangkap kasus paling umum lebih awal, dengan
    // pesan yang jauh lebih jelas.
    if (sendiri && body.role !== 'super_admin') {
      return NextResponse.json(
        { error: 'Anda tidak bisa menurunkan role akun Anda sendiri. Minta Super Admin lain melakukannya.' },
        { status: 400 },
      );
    }
    patch.role = body.role;
  }

  if ('cabang_scope' in body) patch.cabang_scope = bersihkanScope(body.cabang_scope);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Tidak ada yang diubah.' }, { status: 400 });
  }

  const { error } = await admin.from('user_profiles').update(patch).eq('user_id', params.id);

  if (error) {
    // Penjaga Super Admin terakhir di database melempar galat berbahasa
    // manusia — diteruskan apa adanya, bukan dibungkus pesan teknis.
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Nama yang sudah tersalin ke baris alert (migrasi 0010) tidak ikut berubah.
  // Itu disengaja: jejak audit menyimpan nama saat tindakan dilakukan.
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, galat } = await pastikanSuperAdmin();
  if (galat) return galat;

  if (params.id === user!.id) {
    return NextResponse.json(
      { error: 'Anda tidak bisa menghapus akun Anda sendiri.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  /*
    Profil dihapus lebih dulu, baru akun auth-nya.

    Urutannya penting: trigger jaga_super_admin_terakhir hanya memantau
    user_profiles. Kalau akun auth dihapus duluan, cascade akan menghapus
    profilnya tanpa melewati pemeriksaan itu — dan Super Admin terakhir bisa
    lenyap tanpa ada yang mencegah.
  */
  const { error: eProfil } = await admin.from('user_profiles').delete().eq('user_id', params.id);
  if (eProfil) return NextResponse.json({ error: eProfil.message }, { status: 400 });

  const { error } = await admin.auth.admin.deleteUser(params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
