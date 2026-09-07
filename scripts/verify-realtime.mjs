/**
 * Uji Realtime end-to-end: apakah baris baru di `alerts` benar-benar sampai ke
 * klien yang berlangganan.
 *
 * Ini menguji rantai yang tidak bisa dilihat dari query biasa:
 * publikasi supabase_realtime -> WAL -> Realtime server -> RLS -> klien.
 *
 * Memakai akun sementara yang dibuat dan dihapus lagi di akhir, karena Realtime
 * tunduk pada RLS — klien anonim tidak akan menerima event apa pun, jadi menguji
 * tanpa sesi login akan selalu "gagal" secara menyesatkan.
 *
 * Pakai: node --env-file=.env.local scripts/verify-realtime.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const email = `acm-realtime-test-${Date.now()}@example.com`;
const password = crypto.randomUUID();
let userId = null;
let alertId = null;
let ok = false;

const cleanup = async () => {
  if (alertId) await admin.from('alerts').delete().eq('id', alertId);
  if (userId) await admin.auth.admin.deleteUser(userId);
};

try {
  // 1. Akun sementara, dinaikkan ke staff_it supaya lolos RLS `alerts`.
  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (uErr) throw new Error(`Gagal membuat akun uji: ${uErr.message}`);
  userId = created.user.id;

  const { error: pErr } = await admin
    .from('user_profiles')
    .update({ role: 'staff_it', full_name: 'Uji Realtime' })
    .eq('user_id', userId);
  if (pErr) throw new Error(`Gagal set role: ${pErr.message}`);
  console.log('OK  akun uji dibuat + trigger handle_new_user membuat profilnya');

  // 2. Login sebagai klien biasa (anon key + sesi), persis seperti dashboard.
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: sess, error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`Gagal login: ${sErr.message}`);
  console.log('OK  login sebagai staff_it');

  // Langkah yang mudah terlewat: socket Realtime tidak mewarisi sesi sendiri.
  // Tanpa ini channel tetap SUBSCRIBED tapi RLS memblokir seluruh event, dan
  // tidak ada satu pun pesan error yang muncul.
  await client.realtime.setAuth(sess.session.access_token);
  console.log('OK  token didorong ke socket Realtime (setAuth)');

  // 3. Berlangganan, lalu tunggu sampai benar-benar SUBSCRIBED.
  const received = new Promise((resolve) => {
    const ch = client
      .channel('uji-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' },
          (payload) => resolve(payload.new))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('OK  channel SUBSCRIBED');
          // 4. Sisipkan alert lewat service role, meniru endpoint polling.
          admin.from('alert_sources').select('id').limit(1).single().then(({ data: src }) => {
            admin.from('alerts').insert({
              source_id: src.id,
              vhcid: 'VEH-UJI-REALTIME',
              alert_type: 'speed_flag',
              severity: 'critical',
              cabang: 'MKS1',
              no_plat: 'UJI 1234 XX',
              lat: -5.14, long: 119.42,
            }).select('id').single().then(({ data, error }) => {
              if (error) console.error('  gagal insert:', error.message);
              else { alertId = data.id; console.log('OK  alert uji disisipkan:', data.id); }
            });
          });
        }
      });
    setTimeout(() => resolve(null), 20000);
  });

  const row = await received;
  if (row) {
    ok = true;
    console.log('\nEVENT DITERIMA KLIEN:');
    console.log('  ', row.no_plat, '|', row.vhcid, '|', row.alert_type, '|', row.severity, '|', row.cabang);
    console.log('\nRealtime BEKERJA — dashboard akan hidup tanpa refresh.');
  } else {
    console.log('\nGAGAL: tidak ada event dalam 20 detik.');
    console.log('Periksa: tabel alerts sudah masuk publikasi supabase_realtime?');
  }
} catch (e) {
  console.error('\nGALAT:', e.message);
} finally {
  await cleanup();
  console.log('(akun & alert uji dibersihkan)');
  process.exit(ok ? 0 : 1);
}
