/**
 * Arahkan pg_cron ke aplikasi yang sudah ter-deploy.
 *
 * Pakai: node --env-file=.env.local scripts/set-base-url.mjs https://acm-bju.vercel.app
 *
 * Selain menyimpan URL, skrip ini lebih dulu MENGUJI endpoint internalnya
 * sungguhan. Alasannya: kalau URL salah atau Deployment Protection Vercel masih
 * menyala, pg_cron akan tetap memanggil tiap 5 menit tanpa keluhan apa pun —
 * pg_net tidak pernah melaporkan kegagalan ke mana pun yang terlihat operator.
 * Lebih baik gagal sekarang, di depan mata, daripada senyap selamanya.
 */
import { createClient } from '@supabase/supabase-js';

const base = (process.argv[2] ?? '').replace(/\/+$/, '');

if (!/^https:\/\/.+/.test(base)) {
  console.error('Pakai: node --env-file=.env.local scripts/set-base-url.mjs https://<domain-anda>');
  process.exit(1);
}

const secret = process.env.ACM_INTERNAL_SECRET;
if (!secret) {
  console.error('ACM_INTERNAL_SECRET belum ada di .env.local');
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: sources, error } = await db
  .from('alert_sources')
  .select('id, name, alert_type')
  .is('deleted_at', null)
  .limit(1);

if (error || !sources?.length) {
  console.error('Gagal membaca alert_sources:', error?.message ?? 'kosong');
  process.exit(1);
}

const target = `${base}/api/internal/poll/${sources[0].id}`;
console.log(`Menguji  : POST ${target}`);

// 1. Tanpa rahasia — harus DITOLAK. Kalau ini lolos, endpoint polling terbuka
//    untuk siapa saja di internet.
const open = await fetch(target, { method: 'POST' }).catch((e) => ({ status: 0, err: e.message }));
console.log(`  tanpa rahasia -> ${open.status} ${open.status === 401 ? '(benar: ditolak)' : '(MASALAH: seharusnya 401)'}`);

// 2. Dengan rahasia — harus berhasil.
const res = await fetch(target, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-acm-internal': secret },
}).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));

const body = await res.text?.() ?? '';
console.log(`  dengan rahasia -> ${res.status}`);

if (res.status !== 200) {
  console.error('\nGAGAL. Isi respons (200 karakter pertama):');
  console.error('  ' + body.slice(0, 200));
  if (/vercel|authentication|sso/i.test(body)) {
    console.error('\nTerlihat seperti halaman login Vercel: Deployment Protection masih menyala.');
    console.error('Matikan di Vercel -> Settings -> Deployment Protection -> Vercel Authentication.');
  }
  if (res.status === 401) {
    console.error('\n401 dari aplikasi berarti ACM_INTERNAL_SECRET di Vercel belum sama dengan yang di .env.local.');
  }
  process.exit(1);
}

let parsed = null;
try { parsed = JSON.parse(body); } catch {}
if (parsed) {
  console.log(`  sumber diuji  : ${parsed.source}`);
  console.log(`  record diambil: ${parsed.recordsFetched}, baris baru: ${parsed.recordsNew}, ter-dedup: ${parsed.recordsDeduped}`);
}

// 3. Baru simpan URL-nya, setelah terbukti bisa dipanggil.
const { error: upErr } = await db
  .from('app_settings')
  .update({ value: base })
  .eq('key', 'app_base_url');

if (upErr) {
  console.error('Gagal menyimpan app_base_url:', upErr.message);
  process.exit(1);
}

console.log(`\nOK. app_base_url = ${base}`);
console.log('pg_cron akan memakai URL ini pada siklus berikutnya (tiap 5 menit).');
console.log('Verifikasi setelah ~6 menit dengan: npm run verify:cron');
