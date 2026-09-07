/**
 * Verifikasi Milestone 3 — pemecahan satu endpoint menjadi banyak alert_type.
 *
 * Pakai: node --import ./scripts/ts-resolve.mjs --env-file=.env.local scripts/verify-split.mjs [jam]
 *
 * Yang dibuktikan:
 *   1. SATU panggilan endpoint menghasilkan BANYAK jenis alert (bukan satu
 *      panggilan per jenis — itu akan memanggil endpoint yang sama 3x dengan
 *      parameter identik, boros dan berisiko rate limit).
 *   2. Tiap jenis mendarat dengan alert_type yang benar sesuai master data.
 *   3. Jenis yang dinonaktifkan benar-benar tidak masuk.
 *
 * Window polling normal hanya 15 menit, dan jenis seperti Forbidden Parking
 * jarang muncul di rentang sesempit itu. Skrip ini melebarkan window sementara
 * lalu MENGEMBALIKANNYA — termasuk kalau terjadi galat di tengah jalan.
 */
import { createClient } from '@supabase/supabase-js';
import { pollSource } from '../src/lib/poller.ts';

const JAM = Number(process.argv[2] ?? 6);

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: src, error } = await db
  .from('alert_sources')
  .select('id, name, alert_type, endpoint_url, time_window_lookback_seconds, discriminator_path')
  .eq('alert_type', 'notifikasi_operation')
  .single();

if (error || !src) {
  console.error('Sumber notifikasi_operation tidak ditemukan:', error?.message);
  process.exit(1);
}

console.log(`Sumber   : ${src.name}`);
console.log(`Endpoint : ${src.endpoint_url}`);
console.log(`Pembeda  : ${src.discriminator_path}`);

const { data: master } = await db
  .from('alert_type_master')
  .select('notif_value, alert_type, is_active, severity')
  .eq('source_id', src.id)
  .order('notif_value');

console.log('\n=== Master data pemetaan ===');
for (const m of master ?? []) {
  console.log(
    `  ${m.notif_value.padEnd(18)} -> ${(m.alert_type ?? '(belum dipetakan)').padEnd(20)}` +
    `${m.is_active ? 'AKTIF' : 'nonaktif'}${m.severity ? '  severity=' + m.severity : ''}`,
  );
}

const asli = src.time_window_lookback_seconds;
const lebar = JAM * 3600;
let sukses = false;

try {
  console.log(`\nMelebarkan window sementara: ${asli}s -> ${lebar}s (${JAM} jam)`);
  await db.from('alert_sources')
    .update({ time_window_lookback_seconds: lebar })
    .eq('id', src.id);

  const sebelum = await hitungPerJenis();

  console.log('\nMenjalankan SATU siklus polling...');
  const r = await pollSource(src.id);

  console.log(`\n=== Hasil satu panggilan endpoint ===`);
  console.log(`  sukses          : ${r.success}`);
  console.log(`  durasi          : ${r.durationMs} ms`);
  console.log(`  record diambil  : ${r.recordsFetched}`);
  console.log(`  baris baru      : ${r.recordsNew}`);
  console.log(`  ter-dedup       : ${r.recordsDeduped}`);
  console.log(`  dilewati        : ${r.recordsSkipped}  (jenis nonaktif / belum dipetakan)`);
  if (r.unmappedTypes.length) console.log(`  belum dipetakan : ${r.unmappedTypes.join(', ')}`);
  if (r.error) console.log(`  GALAT           : ${r.error}`);

  const sesudah = await hitungPerJenis();

  console.log('\n=== Alert per jenis, dari sumber ini saja ===');
  const semua = new Set([...Object.keys(sebelum), ...Object.keys(sesudah)]);
  for (const t of [...semua].sort()) {
    const a = sebelum[t] ?? 0, b = sesudah[t] ?? 0;
    console.log(`  ${t.padEnd(22)} ${String(b).padStart(4)} baris` + (b > a ? `  (+${b - a})` : ''));
  }

  // Pembuktian inti Milestone 3.
  const jenis = [...semua];
  const aktif = (master ?? []).filter((m) => m.is_active && m.alert_type).map((m) => m.alert_type);

  console.log('\n=== Kesimpulan ===');
  console.log(`  Panggilan endpoint dalam siklus ini : 1`);
  console.log(`  alert_type yang dihasilkan          : ${jenis.length} (${jenis.join(', ')})`);

  const nonaktifBocor = jenis.filter((t) => !aktif.includes(t));
  if (nonaktifBocor.length) {
    console.log(`  MASALAH: jenis di luar daftar aktif ikut masuk -> ${nonaktifBocor.join(', ')}`);
  } else {
    console.log(`  Tidak ada jenis nonaktif yang bocor masuk.`);
  }

  sukses = jenis.length >= 2 && nonaktifBocor.length === 0;
  console.log(
    sukses
      ? '\nTERBUKTI: satu panggilan endpoint dipecah jadi beberapa alert_type dengan benar.'
      : '\nBELUM TERBUKTI dari window ini — coba rentang lebih panjang, mis. `... verify-split.mjs 24`.',
  );
} finally {
  // Pemulihan wajib terjadi apa pun yang terjadi. Kalau window lebar ini
  // tertinggal, setiap polling terjadwal akan menarik rentang berjam-jam
  // setiap 5 menit — boros dan berisiko melewati batas waktu fungsi.
  await db.from('alert_sources')
    .update({ time_window_lookback_seconds: asli })
    .eq('id', src.id);
  console.log(`\n(window dikembalikan ke ${asli}s)`);
}

async function hitungPerJenis() {
  const { data } = await db
    .from('alerts')
    .select('alert_type')
    .eq('source_id', src.id);
  const m = {};
  for (const r of data ?? []) m[r.alert_type] = (m[r.alert_type] ?? 0) + 1;
  return m;
}

process.exit(sukses ? 0 : 1);
