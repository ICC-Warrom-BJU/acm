import { NextRequest, NextResponse } from 'next/server';
import { pollSource } from '@/lib/poller';
import { verifyInternalSecret } from '@/lib/crypto';

/**
 * POST /api/internal/poll/:sourceId  (PRD §8 — Internal)
 *
 * Dipanggil oleh pg_cron lewat pg_net, bukan oleh frontend. Karena itu
 * autentikasinya rahasia bersama, bukan sesi Supabase Auth.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 60 detik, bukan lebih: itu batas fungsi serverless pada paket Vercel Hobby,
// dan nilai yang melebihi batas paket akan menggagalkan deploy.
//
// Ini aman untuk polling normal. Siklus nyata terukur 8-11 detik (window 15
// menit), jadi masih jauh di bawah batas. Yang TIDAK boleh lewat sini adalah
// rentang panjang — query satu hari penuh di speed_flag terukur 139 detik saat
// investigasi Milestone 0. Backfill semacam itu perlu jalur terpisah yang
// memecah rentang jadi potongan kecil.
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: { sourceId: string } },
) {
  if (!verifyInternalSecret(req.headers.get('x-acm-internal'))) {
    return NextResponse.json({ error: 'Tidak diizinkan' }, { status: 401 });
  }

  try {
    const result = await pollSource(params.sourceId);

    // Selalu balas 200 selama siklusnya sendiri berjalan. Kegagalan memanggil
    // API eksternal adalah kondisi yang sudah tercatat di polling_logs dan
    // alert_sources — bukan kesalahan endpoint ini, dan tidak perlu membuat
    // pg_net menandai jobnya error.
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
