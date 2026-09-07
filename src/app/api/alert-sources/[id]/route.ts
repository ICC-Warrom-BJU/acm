import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isStaff } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { encryptToken } from '@/lib/crypto';

/**
 * PUT /api/alert-sources/:id — ubah konfigurasi sumber (PRD §8).
 *
 * Harus lewat route server, bukan langsung dari klien ke PostgREST, karena
 * token perlu dienkripsi dengan ACM_ENCRYPTION_KEY yang hanya ada di server.
 * Token juga tidak pernah dikirim balik ke klien (PRD §10).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Hanya kolom ini yang boleh diubah lewat UI. Daftar putih, bukan daftar hitam:
// dengan daftar hitam, kolom baru yang ditambahkan kelak akan otomatis ikut
// bisa diubah tanpa ada yang memutuskannya.
const BOLEH_DIUBAH = [
  'name',
  'endpoint_url',
  'method',
  'auth_type',
  'auth_header_name',
  'polling_interval_seconds',
  'is_active',
  'data_path',
  'discriminator_path',
  'time_window_enabled',
  'time_window_start_field',
  'time_window_stop_field',
  'time_window_lookback_seconds',
  'time_window_offset_hours',
  'field_mapping',
  'headers_template',
  'body_template',
] as const;

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Belum login' }, { status: 401 });
  if (!isStaff(user.role)) {
    return NextResponse.json({ error: 'Hanya Staff IT & Super Admin' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  for (const k of BOLEH_DIUBAH) {
    if (body[k] !== undefined) patch[k] = body[k];
  }

  // Token hanya disentuh kalau benar-benar diisi. Field kosong berarti
  // "biarkan apa adanya" — kalau tidak, sekali simpan form akan menghapus
  // token hanya karena kolomnya tampil kosong (memang selalu masked).
  if (typeof body.token === 'string' && body.token.trim() !== '') {
    patch.token_encrypted = encryptToken(body.token.trim());
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Tidak ada yang diubah' }, { status: 400 });
  }

  if (
    patch.polling_interval_seconds !== undefined &&
    Number(patch.polling_interval_seconds) < 60
  ) {
    return NextResponse.json(
      { error: 'Interval minimal 60 detik (batas granularitas pg_cron)' },
      { status: 400 },
    );
  }

  const { error } = await createAdminClient()
    .from('alert_sources')
    .update(patch)
    .eq('id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Trigger reschedule_alert_source di database menjadwal ulang pg_cron sendiri
  // kalau interval atau status aktifnya berubah — tidak ada langkah manual.
  return NextResponse.json({ ok: true });
}
