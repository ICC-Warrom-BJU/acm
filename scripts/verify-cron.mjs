/**
 * Buktikan rantai pg_cron -> pg_net -> aplikasi benar-benar berjalan.
 *
 * Pakai: node --env-file=.env.local scripts/verify-cron.mjs
 *
 * Ini satu-satunya bagian arsitektur yang tidak bisa diuji dari mesin lokal,
 * karena pg_net berjalan di server Supabase dan tidak bisa menjangkau localhost.
 *
 * Caranya lewat bukti tidak langsung: kalau ada baris `polling_logs` yang lahir
 * TANPA ada yang menjalankan skrip polling manual, satu-satunya yang bisa
 * membuatnya adalah pg_cron. Karena itu skrip ini melihat jendela waktu
 * terakhir, bukan sekadar "apakah ada log".
 */
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: settings } = await db.from('app_settings').select('key, value');
const baseUrl = settings?.find((s) => s.key === 'app_base_url')?.value;

console.log(`app_base_url : ${baseUrl}`);
if (!baseUrl || baseUrl.includes('example')) {
  console.log('\nMasih placeholder. Jalankan dulu: npm run set:baseurl https://<domain-anda>');
  process.exit(1);
}

const sinceMin = Number(process.argv[2] ?? 15);
const since = new Date(Date.now() - sinceMin * 60_000).toISOString();

const { data: logs, error } = await db
  .from('polling_logs')
  .select('source_id, executed_at, success, response_code, duration_ms, records_fetched, records_new, error_message')
  .gte('executed_at', since)
  .order('executed_at', { ascending: false });

if (error) { console.error('Gagal membaca polling_logs:', error.message); process.exit(1); }

const { data: sources } = await db.from('alert_sources').select('id, name');
const nameOf = Object.fromEntries((sources ?? []).map((s) => [s.id, s.name]));

console.log(`\npolling_logs ${sinceMin} menit terakhir: ${logs.length} baris\n`);

for (const l of logs.slice(0, 12)) {
  console.log(
    `  ${l.executed_at.slice(11, 19)}  ${(nameOf[l.source_id] ?? '?').padEnd(22)}` +
    `${l.success ? 'sukses' : 'GAGAL '}  resp=${l.response_code ?? '-'}  ` +
    `${String(l.duration_ms).padStart(6)}ms  diambil=${l.records_fetched}  baru=${l.records_new}` +
    (l.error_message ? `  ${l.error_message.slice(0, 60)}` : ''),
  );
}

if (logs.length === 0) {
  console.log('  (tidak ada)');
  console.log('\nBELUM TERBUKTI. Kemungkinan sebabnya:');
  console.log('  - Belum lewat satu siklus (interval 5 menit) sejak app_base_url diisi');
  console.log('  - Job pg_cron belum terbentuk. Cek di SQL Editor:');
  console.log("      select jobname, schedule, active from cron.job where jobname like 'poll_source_%';");
  console.log('  - Panggilan pg_net gagal. Lihat riwayat responsnya di SQL Editor:');
  console.log('      select id, status_code, left(content, 200) as content, created');
  console.log('        from net._http_response order by created desc limit 10;');
  process.exit(1);
}

// Interval antar log adalah sidik jari penjadwal: kalau jaraknya rapi ~5 menit,
// itu pg_cron, bukan seseorang yang kebetulan menjalankan skrip manual.
const times = logs.map((l) => Date.parse(l.executed_at)).sort((a, b) => b - a);
const gaps = times.slice(0, -1).map((t, i) => Math.round((t - times[i + 1]) / 1000));

console.log(`\njeda antar polling (detik): ${gaps.slice(0, 8).join(', ') || '-'}`);

const berkala = gaps.filter((g) => g >= 240 && g <= 360).length;
if (berkala >= 1) {
  console.log('\nTERBUKTI: ada polling berjeda ~5 menit — pg_cron memicu aplikasi dengan benar.');
} else {
  console.log('\nBelum meyakinkan: ada log, tapi jedanya tidak berpola 5 menit.');
  console.log('Mungkin itu hasil `npm run poll` manual. Tunggu ~10 menit tanpa menjalankan apa pun, lalu ulangi.');
  process.exit(1);
}
