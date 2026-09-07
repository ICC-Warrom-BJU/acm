import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isStaff } from '@/lib/supabase/server';
import { pollSource } from '@/lib/poller';

/**
 * POST /api/alert-sources/:id/test — tombol "Test Sekarang" (PRD §8, §9).
 *
 * Menjalankan satu siklus polling sungguhan di luar jadwal. Berbeda dari
 * /api/internal/poll/:id yang diautentikasi dengan rahasia bersama untuk
 * pg_cron, endpoint ini diautentikasi dengan sesi pengguna dan role.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  // Lapis pertama: pengecekan role di API layer (PRD §4). RLS adalah lapis kedua.
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Belum login' }, { status: 401 });
  if (!isStaff(user.role)) {
    return NextResponse.json({ error: 'Hanya Staff IT & Super Admin' }, { status: 403 });
  }

  try {
    const result = await pollSource(params.id);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
