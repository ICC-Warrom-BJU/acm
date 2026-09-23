import { NextResponse } from 'next/server';
import { getCurrentUser } from './supabase/server';

/**
 * Helper bersama untuk route manajemen pengguna.
 *
 * Diletakkan di lib, bukan di berkas route: Next.js hanya mengizinkan route
 * mengekspor handler HTTP dan beberapa konstanta konfigurasi, sehingga
 * mengekspor helper dari sana menggagalkan build.
 */

export const ROLE_VALID = ['super_admin', 'staff_it', 'management'] as const;
export type Role = (typeof ROLE_VALID)[number];

/**
 * Panjang minimum kata sandi.
 *
 * Supabase sendiri hanya mewajibkan 6. Dinaikkan ke 10 karena akun di sini
 * dibuatkan oleh admin dan sandinya disampaikan lewat pesan — sandi pendek
 * yang beredar di percakapan adalah gabungan risiko yang buruk.
 */
export const PANJANG_SANDI_MIN = 10;

/**
 * Penjaga bersama seluruh route pengguna.
 *
 * Identitas diperiksa lewat sesi (getCurrentUser memvalidasi token ke server),
 * bukan dari apa pun yang dikirim klien.
 */
export async function pastikanSuperAdmin() {
  const user = await getCurrentUser();
  if (!user) {
    return { galat: NextResponse.json({ error: 'Belum login' }, { status: 401 }) };
  }
  if (user.role !== 'super_admin') {
    return {
      galat: NextResponse.json(
        { error: 'Hanya Super Admin yang dapat mengelola pengguna' },
        { status: 403 },
      ),
    };
  }
  return { user };
}

/** Array cabang yang bersih, atau null bila kosong (null = tanpa batasan). */
export function bersihkanScope(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const bersih = [...new Set(v.map((x) => String(x).trim()).filter(Boolean))];
  return bersih.length ? bersih : null;
}
