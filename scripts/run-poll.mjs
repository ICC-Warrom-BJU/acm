/**
 * Jalankan satu siklus polling secara manual, memakai poller produksi.
 *
 * Ini jalur yang sama persis dengan yang dipanggil pg_cron lewat
 * /api/internal/poll/:source_id — hanya tanpa lompatan HTTP-nya. Berguna untuk
 * memverifikasi pipeline sebelum aplikasi ter-deploy, dan untuk mendiagnosis
 * satu sumber tanpa menunggu jadwal.
 *
 * Pakai: node --env-file=.env.local scripts/run-poll.mjs [alert_type ...]
 */
import { createClient } from '@supabase/supabase-js';
import { pollSource } from '../src/lib/poller.ts';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const wanted = process.argv.slice(2);
let q = db.from('alert_sources').select('id, name, alert_type').is('deleted_at', null);
if (wanted.length) q = q.in('alert_type', wanted);

const { data: sources, error } = await q;
if (error) { console.error('Gagal membaca sumber:', error.message); process.exit(1); }

for (const s of sources) {
  console.log(`\n=== ${s.name} (${s.alert_type})`);
  const r = await pollSource(s.id);
  console.log(`  sukses          : ${r.success}`);
  console.log(`  HTTP / RespCode : ${r.httpStatus} / ${r.responseCode}`);
  console.log(`  durasi          : ${r.durationMs} ms`);
  console.log(`  record diambil  : ${r.recordsFetched}`);
  console.log(`  baris baru      : ${r.recordsNew}`);
  console.log(`  ter-dedup       : ${r.recordsDeduped}`);
  console.log(`  dilewati        : ${r.recordsSkipped}`);
  if (r.unmappedTypes.length) console.log(`  jenis belum dipetakan: ${r.unmappedTypes.join(', ')}`);
  if (r.error) console.log(`  GALAT           : ${r.error}`);
}
