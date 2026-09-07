/**
 * Seed konfigurasi sumber alert (TASKS Milestone 1 & 3).
 *
 * Skrip terpisah, bukan file SQL, karena token harus dienkripsi dengan
 * ACM_ENCRYPTION_KEY di sisi Node sebelum disimpan.
 *
 * Jalankan:  node --env-file=.env.local scripts/seed-sources.mjs
 *
 * Field mapping di bawah bukan tebakan — diambil dari response asli yang
 * diuji pada 2026-09-07, lihat docs/FINDINGS_API_M0.md.
 */

import { createClient } from '@supabase/supabase-js';
import { createCipheriv, randomBytes, createHash } from 'node:crypto';

function encryptToken(plain) {
  const key = createHash('sha256').update(process.env.ACM_ENCRYPTION_KEY).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ACM_ENCRYPTION_KEY',
  'EASYGO_TOKEN',
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Env belum lengkap:', missing.join(', '));
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const token = encryptToken(process.env.EASYGO_TOKEN);

const shared = {
  method: 'POST',
  auth_type: 'custom_header',
  auth_header_name: 'token', // huruf kecil — lihat FINDINGS §1
  token_encrypted: token,
  data_path: 'Data',
  is_active: true,
  time_window_enabled: true,
  time_window_start_field: 'start_time',
  time_window_stop_field: 'stop_time',
  // time_window_offset_hours diisi per sumber di bawah — tidak ada nilai
  // bersama yang benar untuk keduanya.
  polling_interval_seconds: 300,
  // Lookback 900 s untuk interval 300 s: window tumpang tindih supaya tidak ada
  // kejadian yang lolos di antara dua polling. Duplikatnya diserap dedup harian.
  time_window_lookback_seconds: 900,
  body_template: { lstVehicleId: null, lstNoPOL: [] },
};

const sources = [
  {
    ...shared,
    name: 'Speed Flag',
    alert_type: 'speed_flag',
    endpoint_url: 'https://vtsapi.easygo-gps.co.id/api/report/speed_flag',
    // Endpoint ini membaca start_time/stop_time sebagai UTC (FINDINGS 3.1).
    time_window_offset_hours: 0,
    field_mapping: {
      vhcid_path: 'vehicle_id',
      timestamp_path: 'gps_time',
      lat_path: 'lat',
      long_path: 'lon',
      no_plat_path: 'nopol',
    },
  },
  {
    ...shared,
    name: 'Notifikasi Operation',
    // Satu sumber, satu panggilan, dipecah jadi banyak alert_type di Node.js.
    // Tiga baris terpisah akan memanggil endpoint yang sama 3x dengan parameter
    // identik — boros dan berisiko kena rate limit (API_LIST §"Catatan Penting").
    alert_type: 'notifikasi_operation',
    endpoint_url: 'https://vtsapi.easygo-gps.co.id/api/Notifikasi/Operation',
    // Endpoint ini membaca window sebagai WIB (+7) — beda dari speed_flag.
    time_window_offset_hours: 7,
    field_mapping: {
      vhcid_path: 'vehicle_id',
      timestamp_path: 'gps_time',
      lat_path: 'lat',
      long_path: 'lon',
      no_plat_path: 'nopol',
    },
    discriminator_path: 'tipe_notif',
    // Pemetaan nilainya TIDAK di sini — ada di master data alert_type_master,
    // di-seed di bawah, supaya bisa diubah lewat UI tanpa menyentuh kode.
  },
];

const inserted = {};

for (const s of sources) {
  const { data, error } = await db
    .from('alert_sources')
    .upsert(s, { onConflict: 'alert_type' })
    .select('id, alert_type')
    .single();

  if (error) {
    console.error(`GAGAL ${s.name}:`, error.message);
    process.exitCode = 1;
  } else {
    inserted[data.alert_type] = data.id;
    console.log(`OK  ${s.name} (${s.alert_type}) — interval ${s.polling_interval_seconds}s`);
  }
}

// ---------------------------------------------------------------------------
// Master data jenis notifikasi (alert_type_master).
//
// Nilai `notif_value` di bawah adalah yang benar-benar diamati dari API pada
// 2026-09-07. Jenis yang belum ada di daftar ini TIDAK perlu ditambahkan
// manual: poller mencatat sendiri setiap nilai tipe_notif baru yang muncul
// sebagai baris nonaktif, lengkap dengan contoh payload, untuk ditinjau.
// ---------------------------------------------------------------------------
const notifSourceId = inserted['notifikasi_operation'];

if (notifSourceId) {
  const types = [
    // --- Aktif: diproses jadi alert ---
    { notif_value: 'IDLE', alert_type: 'idle_overtime', label: 'Idle Overtime',
      severity: 'warning', is_active: true },

    { notif_value: 'Forbidden Parking', alert_type: 'parking_overtime', label: 'Parking Overtime',
      severity: 'warning', is_active: true },

    // Kandidat untuk Fatigue Driving. Diaktifkan dengan alert_type-nya sendiri
    // dulu — begitu EASYGO memastikan jenis mana yang benar-benar mewakili
    // fatigue, cukup ubah alert_type baris ini lewat UI.
    { notif_value: 'Forbidden Driving', alert_type: 'forbidden_driving', label: 'Forbidden Driving',
      severity: 'critical', is_active: true,
      notes: 'Kandidat terdekat untuk fatigue_driving. API tidak punya jenis fatigue eksplisit — perlu konfirmasi EASYGO (FINDINGS 6.1).' },

    // --- Nonaktif: terdaftar tapi sengaja tidak diproses ---

    // KEPUTUSAN BJU: sumber overspeed tunggal adalah Speed Flag. Tetap
    // didaftarkan (bukan dihapus) supaya alasannya terlihat di UI, dan supaya
    // ia tidak muncul berulang sebagai "jenis baru yang belum ditinjau".
    { notif_value: 'OVERSPEED', alert_type: null, label: 'Overspeed (via Notifikasi)',
      is_active: false,
      notes: 'Sengaja nonaktif. Overspeed memakai sumber Speed Flag agar satu kejadian ngebut tidak tercatat dua kali (FINDINGS 6.2).' },

    { notif_value: 'OVERSPEED_IN_GEO', alert_type: null, label: 'Overspeed dalam Geofence',
      is_active: false, notes: 'Di luar lingkup Fase 1. Aktifkan bila diperlukan.' },
    { notif_value: 'FUEL THEFT', alert_type: null, label: 'Dugaan Pencurian BBM',
      is_active: false, notes: 'Di luar lingkup Fase 1, tapi datanya sudah tersedia tanpa panggilan tambahan.' },
    { notif_value: 'FUEL FILLING', alert_type: null, label: 'Pengisian BBM',
      is_active: false, notes: 'Di luar lingkup Fase 1.' },
    { notif_value: 'MOVEMENT', alert_type: null, label: 'Pergerakan Unit',
      is_active: false, notes: 'Di luar lingkup Fase 1.' },
  ];

  for (const t of types) {
    const { error } = await db
      .from('alert_type_master')
      .upsert({ ...t, source_id: notifSourceId, auto_discovered: false },
              { onConflict: 'source_id,notif_value_key' });

    if (error) {
      console.error(`GAGAL master ${t.notif_value}:`, error.message);
      process.exitCode = 1;
    } else {
      console.log(`OK  master ${t.notif_value.padEnd(18)} -> ${t.alert_type ?? '(belum dipetakan)'}` +
                  `${t.is_active ? '' : '  [nonaktif]'}`);
    }
  }
} else {
  console.error('GAGAL: source notifikasi_operation tidak ditemukan, master jenis dilewati.');
  process.exitCode = 1;
}

console.log('\nTrigger reschedule_alert_source akan otomatis membuat job pg_cron-nya.');
