/**
 * Import Master Data VHCID dari Excel (TASKS Milestone 4).
 *
 * Jalankan:
 *   node --env-file=.env.local scripts/import-master-vehicles.mjs "docs/Master Data VHCID.xlsx"
 *   node --env-file=.env.local scripts/import-master-vehicles.mjs "<file>" --commit
 *
 * Tanpa `--commit` skrip hanya memvalidasi dan menampilkan ringkasan — sesuai
 * PRD §9 yang meminta preview sebelum commit. Import massal ke tabel yang jadi
 * rujukan seluruh alert tidak boleh terjadi karena salah ketik nama file.
 */

import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';

const [file, ...flags] = process.argv.slice(2);
const COMMIT = flags.includes('--commit');

if (!file) {
  console.error('Pakai: node scripts/import-master-vehicles.mjs <file.xlsx> [--commit]');
  process.exit(1);
}

// Header di file BJU -> kolom master_vehicles. Dicocokkan longgar (huruf kecil,
// tanpa titik/spasi) supaya file yang headernya sedikit berbeda tetap terbaca
// tanpa perlu diedit dulu.
const HEADER_MAP = {
  gpsvhcid: 'vhcid',
  vhcid: 'vhcid',
  cabang: 'cabang',
  norangka: 'no_rangka',
  nopolisi: 'no_plat',
  nopol: 'no_plat',
  noplat: 'no_plat',
  project: 'group_project',
  groupproject: 'group_project',
  vendor: 'vendor',
  jenisgps: 'jenis_gps',
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const cell = (c) => {
  if (c == null) return '';
  if (typeof c === 'object') return String(c.text ?? c.result ?? '').trim();
  return String(c).trim();
};

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.worksheets[0];
console.log(`Sheet: "${ws.name}"`);

const header = ws.getRow(1).values.slice(1).map(cell);
const cols = header.map((h) => HEADER_MAP[norm(h)] ?? null);

console.log('Pemetaan kolom:');
header.forEach((h, i) => console.log(`  ${JSON.stringify(h)} -> ${cols[i] ?? '(diabaikan)'}`));

if (!cols.includes('vhcid')) {
  console.error('\nGAGAL: kolom VHCID tidak ditemukan. Import dibatalkan.');
  process.exit(1);
}

const rows = [];
const masalah = [];
const terlihat = new Set();

ws.eachRow((row, n) => {
  if (n === 1) return;
  const vals = row.values.slice(1).map(cell);

  const r = {};
  cols.forEach((c, i) => { if (c) r[c] = vals[i] ?? ''; });

  if (!r.vhcid) { masalah.push(`baris ${n}: VHCID kosong, dilewati`); return; }
  if (terlihat.has(r.vhcid)) { masalah.push(`baris ${n}: VHCID ${r.vhcid} duplikat, dilewati`); return; }
  terlihat.add(r.vhcid);

  // "XX" dipakai di file sebagai penanda nomor polisi belum diketahui.
  // Disimpan sebagai NULL, bukan teks "XX", supaya tidak ada yang mengira
  // itu nomor plat sungguhan saat muncul di feed alert.
  if (/^x+$/i.test(r.no_plat ?? '')) { r.no_plat = null; }

  for (const k of Object.keys(r)) if (r[k] === '') r[k] = null;
  rows.push(r);
});

const hitung = (k) => {
  const m = {};
  for (const r of rows) m[r[k] ?? '(kosong)'] = (m[r[k] ?? '(kosong)'] ?? 0) + 1;
  return m;
};

console.log(`\nBaris valid : ${rows.length}`);
console.log(`Dilewati    : ${masalah.length}`);
masalah.slice(0, 10).forEach((m) => console.log('  ' + m));
console.log(`Tanpa no. plat : ${rows.filter((r) => !r.no_plat).length}`);
console.log(`Cabang  : ${JSON.stringify(hitung('cabang'))}`);
console.log(`Project : ${Object.keys(hitung('group_project')).length} nilai berbeda`);

if (!COMMIT) {
  console.log('\n[PREVIEW] Tidak ada yang ditulis ke database.');
  console.log('Tambahkan --commit untuk benar-benar mengimpor.');
  process.exit(0);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Dipotong per 200 baris: satu permintaan berisi 500+ baris cenderung kena
// batas ukuran payload, dan kalau gagal tidak jelas bagian mana yang bermasalah.
let ok = 0;
for (let i = 0; i < rows.length; i += 200) {
  const batch = rows.slice(i, i + 200);
  const { error } = await db.from('master_vehicles').upsert(batch, { onConflict: 'vhcid' });
  if (error) {
    console.error(`GAGAL batch ${i}-${i + batch.length}: ${error.message}`);
    process.exit(1);
  }
  ok += batch.length;
  console.log(`  ${ok}/${rows.length}`);
}

const { count } = await db
  .from('master_vehicles')
  .select('vhcid', { count: 'exact', head: true });

console.log(`\nSelesai. Total unit di master_vehicles: ${count}`);
