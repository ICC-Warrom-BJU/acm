import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isStaff, createServerSupabase } from '@/lib/supabase/server';

/**
 * POST /api/alerts/bulk-close — tutup / acknowledge banyak alert (PRD §7.2, §8).
 *
 * Menerima SALAH SATU dari:
 *   { ids: [...] }        daftar eksplisit
 *   { filter: {...} }     "pilih semua yang cocok filter ini"
 *
 * Jalur filter ada karena antrian bisa berisi ribuan baris setelah gangguan;
 * mengirim ribuan id lewat body permintaan boros dan rapuh. Dengan filter,
 * database yang menentukan baris mana yang terkena — sama persis dengan yang
 * dilihat operator di layar.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Filter {
  cabang?: string;
  group_project?: string;
  alert_type?: string;
  severity?: string;
  status?: string;
  vhcid?: string;
  from?: string;
  to?: string;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Belum login' }, { status: 401 });
  // Management tidak boleh menutup alert (PRD §4). Lapis pertama di sini,
  // lapis kedua di RLS policy al_update.
  if (!isStaff(user.role)) {
    return NextResponse.json({ error: 'Hanya Staff IT & Super Admin' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 });

  const aksi: 'close' | 'acknowledge' = body.action === 'acknowledge' ? 'acknowledge' : 'close';
  const ids: string[] | undefined = Array.isArray(body.ids) ? body.ids : undefined;
  const filter: Filter | undefined = body.filter;

  if (!ids?.length && !filter) {
    return NextResponse.json(
      { error: 'Sertakan ids[] atau filter — tanpa keduanya, permintaan ini akan menutup seluruh alert.' },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const patch =
    aksi === 'close'
      ? {
          status: 'closed',
          closed_at: now,
          closed_by: user.id,
          close_note: typeof body.close_note === 'string' ? body.close_note.trim() || null : null,
        }
      : {
          status: 'acknowledged',
          acknowledged_at: now,
          acknowledged_by: user.id,
        };

  // Klien ber-RLS, bukan service role: kalau kelak Staff IT dibatasi cabang,
  // pembatasan itu ikut berlaku di sini tanpa perlu diingat ulang.
  const supabase = createServerSupabase();
  let q = supabase.from('alerts').update(patch);

  if (ids?.length) {
    q = q.in('id', ids);
  } else if (filter) {
    // Baris yang sudah closed tidak pernah disentuh lagi. Tanpa ini, "tutup
    // semua sesuai filter" akan menimpa closed_by dan closed_at penutupan
    // sebelumnya — jejak audit yang hilang tanpa disadari (PRD §10).
    q = q.neq('status', 'closed');

    if (filter.status) q = q.eq('status', filter.status);
    if (filter.cabang) q = q.eq('cabang', filter.cabang);
    if (filter.group_project) q = q.eq('group_project', filter.group_project);
    if (filter.alert_type) q = q.eq('alert_type', filter.alert_type);
    if (filter.severity) q = q.eq('severity', filter.severity);
    if (filter.vhcid) q = q.eq('vhcid', filter.vhcid);
    if (filter.from) q = q.gte('occurrence_date', filter.from);
    if (filter.to) q = q.lte('occurrence_date', filter.to);
  }

  const { data, error } = await q.select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, affected: data?.length ?? 0, action: aksi });
}
