import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getCurrentUser, isStaff, createServerSupabase } from '@/lib/supabase/server';
import { BUSINESS_TIMEZONE, BUSINESS_TZ_LABEL } from '@/lib/time';

/**
 * GET /api/alerts/export?format=xlsx|json&... (PRD §8)
 *
 * Dua sumber data yang berbeda peruntukan:
 *   source=alerts   -> raw, untuk investigasi. Staff IT & Super Admin saja.
 *   source=summary  -> agregat harian, untuk laporan. Semua role.
 *
 * Management sengaja hanya boleh mengambil ringkasan (PRD §4: "Tidak (hanya
 * ringkasan)"). Raw memuat payload mentah dan detail per kejadian yang bukan
 * kebutuhan mereka.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Batas baris. Tanpa ini, rentang panjang pada armada 1000+ unit bisa membuat
// fungsi serverless kehabisan memori — dan gagalnya di tengah penulisan file,
// yang menghasilkan unduhan rusak alih-alih pesan galat yang jelas.
const MAKS_BARIS = 50_000;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Belum login' }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const format = p.get('format') === 'json' ? 'json' : 'xlsx';
  const source = p.get('source') === 'alerts' ? 'alerts' : 'summary';

  if (source === 'alerts' && !isStaff(user.role)) {
    return NextResponse.json(
      { error: 'Management hanya dapat mengekspor data ringkasan, bukan data mentah.' },
      { status: 403 },
    );
  }

  const supabase = createServerSupabase();
  const from = p.get('from');
  const to = p.get('to');

  let rows: any[] = [];
  let judul = '';

  if (source === 'alerts') {
    let q = supabase
      .from('alerts')
      .select('occurrence_date, vhcid, no_plat, alert_type, severity, cabang, group_project, status, occurrence_count, first_seen_at, last_seen_at, lat, long, close_note');

    if (from) q = q.gte('occurrence_date', from);
    if (to) q = q.lte('occurrence_date', to);
    if (p.get('cabang')) q = q.eq('cabang', p.get('cabang'));
    if (p.get('alert_type')) q = q.eq('alert_type', p.get('alert_type'));
    if (p.get('severity')) q = q.eq('severity', p.get('severity'));
    if (p.get('status')) q = q.eq('status', p.get('status'));
    if (p.get('vhcid')) q = q.eq('vhcid', p.get('vhcid'));

    const { data, error } = await q.order('last_seen_at', { ascending: false }).limit(MAKS_BARIS);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    rows = data ?? [];
    judul = 'Alert Mentah';
  } else {
    let q = supabase
      .from('alert_daily_summary')
      .select('summary_date, vhcid, alert_type, cabang, group_project, occurrence_count, alert_count, critical_count, warning_count, first_occurrence_at, last_occurrence_at');

    if (from) q = q.gte('summary_date', from);
    if (to) q = q.lte('summary_date', to);
    if (p.get('cabang')) q = q.eq('cabang', p.get('cabang'));
    if (p.get('alert_type')) q = q.eq('alert_type', p.get('alert_type'));

    const { data, error } = await q.order('summary_date', { ascending: false }).limit(MAKS_BARIS);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    rows = data ?? [];
    judul = 'Ringkasan Harian';
  }

  const namaFile = `ACM-${source}-${from ?? 'awal'}-sd-${to ?? 'kini'}`;

  if (format === 'json') {
    return new NextResponse(JSON.stringify({ judul, from, to, jumlah: rows.length, data: rows }, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${namaFile}.json"`,
      },
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ACM — PT. Bumi Jasa Utama';
  wb.created = new Date();

  const ws = wb.addWorksheet(judul);

  // Timestamp diubah jadi teks waktu bisnis, bukan dibiarkan sebagai UTC.
  // Excel tidak menyimpan zona waktu, jadi nilai UTC mentah akan terbaca
  // meleset delapan jam oleh siapa pun yang membukanya di Makassar.
  const kolom = Object.keys(rows[0] ?? { info: '' });
  ws.columns = kolom.map((k) => ({
    header: LABEL[k] ?? k,
    key: k,
    width: LEBAR[k] ?? 18,
  }));

  for (const r of rows) {
    const baris: Record<string, unknown> = {};
    for (const k of kolom) {
      const v = r[k];
      baris[k] = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? waktuBisnis(v) : v;
    }
    ws.addRow(baris);
  }

  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (rows.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolom.length } };
  }

  // Lembar kedua berisi konteks ekspor. Tanpa ini, file yang beredar lewat
  // WhatsApp beberapa minggu kemudian tidak lagi diketahui rentang dan
  // filternya — dan angkanya jadi mudah disalahartikan.
  const info = wb.addWorksheet('Info Ekspor');
  info.columns = [{ header: 'Keterangan', width: 28 }, { header: 'Nilai', width: 60 }];
  info.addRows([
    ['Sumber data', source === 'alerts' ? 'alerts (mentah, retensi 90 hari)' : 'alert_daily_summary (agregat, permanen)'],
    ['Rentang tanggal', `${from ?? 'awal'} s/d ${to ?? 'sekarang'}`],
    ['Filter cabang', p.get('cabang') ?? 'semua'],
    ['Filter jenis alert', p.get('alert_type') ?? 'semua'],
    ['Jumlah baris', rows.length],
    ['Dibatasi pada', rows.length >= MAKS_BARIS ? `${MAKS_BARIS} baris — persempit rentangnya` : 'tidak'],
    ['Zona waktu', `${BUSINESS_TZ_LABEL} (${BUSINESS_TIMEZONE})`],
    ['Diekspor oleh', `${user.fullName} (${user.role})`],
    ['Waktu ekspor', waktuBisnis(new Date().toISOString())],
  ]);
  info.getRow(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${namaFile}.xlsx"`,
    },
  });
}

function waktuBisnis(iso: string) {
  return new Date(iso).toLocaleString('id-ID', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const LABEL: Record<string, string> = {
  occurrence_date: 'Tanggal', summary_date: 'Tanggal', vhcid: 'VHCID',
  no_plat: 'No. Polisi', alert_type: 'Jenis Alert', severity: 'Severity',
  cabang: 'Cabang', group_project: 'Project', status: 'Status',
  occurrence_count: 'Jumlah Kejadian', alert_count: 'Jumlah Alert',
  critical_count: 'Kritis', warning_count: 'Peringatan',
  first_seen_at: 'Pertama Terlihat', last_seen_at: 'Terakhir Terlihat',
  first_occurrence_at: 'Kejadian Pertama', last_occurrence_at: 'Kejadian Terakhir',
  lat: 'Lintang', long: 'Bujur', close_note: 'Catatan Penutupan',
};

const LEBAR: Record<string, number> = {
  group_project: 34, close_note: 30, alert_type: 20,
  first_seen_at: 22, last_seen_at: 22, first_occurrence_at: 22, last_occurrence_at: 22,
};
