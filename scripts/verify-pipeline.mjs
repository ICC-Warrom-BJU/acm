/**
 * Uji pipeline normalisasi terhadap API EASYGO yang sungguhan, tanpa database.
 *
 * Gunanya: memastikan field_mapping, penanganan zona waktu, pemecahan
 * discriminator, dan dedup harian benar-benar cocok dengan data produksi —
 * sebelum ada satu baris pun masuk ke Supabase.
 *
 * Jalankan:  node scripts/verify-pipeline.mjs
 *
 * Mengimpor logika yang sama persis dengan yang dipakai poller (src/lib/normalize.ts),
 * jadi kalau uji ini lulus, itu memang logika produksinya yang lulus.
 */

import {
  getPath,
  parseTimestamp,
  parseCoord,
  parseText,
  formatEasygoTime,
  deriveSeverity,
} from '../src/lib/normalize.ts';

const BASE = 'https://vtsapi.easygo-gps.co.id';
const TOKEN = process.env.EASYGO_TOKEN;
if (!TOKEN) {
  // Sengaja tanpa nilai cadangan: token EASYGO adalah kredensial produksi yang
  // membuka seluruh data armada. Menanamkannya di kode berarti ia ikut masuk
  // ke git dan tersebar ke setiap salinan repo.
  console.error('EASYGO_TOKEN belum diset. Jalankan dengan: node --env-file=.env.local ...');
  process.exit(1);
}

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'GAGAL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// --- Uji murni (tanpa jaringan) ---------------------------------------------
console.log('\n== Uji normalisasi (offline) ==');

check('sentinel 0001-01-01 jadi null', parseTimestamp('0001-01-01T00:00:00', 0) === null);
check(
  'gps_time UTC dipertahankan',
  parseTimestamp('2026-09-07T02:31:49Z', 0) === '2026-09-07T02:31:49.000Z',
);
check(
  'offset +07:00 dikonversi ke UTC',
  parseTimestamp('2026-09-07T00:00:10+07:00', 0) === '2026-09-06T17:00:10.000Z',
);
check(
  'timestamp polos memakai offset cadangan dari sumber (+7)',
  parseTimestamp('2026/09/07 08:00:00', 7) === '2026-09-07T01:00:00.000Z',
);
check(
  'offset cadangan berbeda menghasilkan hasil berbeda — tidak ada default tersembunyi',
  parseTimestamp('2026/09/07 08:00:00', 0) === '2026-09-07T08:00:00.000Z',
);
check('koordinat 0 ditolak (GPS belum fix)', parseCoord(0) === null);
check('koordinat negatif diterima', parseCoord(-4.9633932) === -4.9633932);
check('nopol dengan sufiks tetap utuh', parseText('DD 8464 SI/dascam') === 'DD 8464 SI/dascam');
check('jalur bertitik', getPath({ a: { b: { c: 7 } } }, 'a.b.c') === 7);
check('jalur hilang jadi undefined', getPath({ a: 1 }, 'x.y.z') === undefined);
check(
  'format waktu EASYGO',
  formatEasygoTime(new Date('2026-09-07T01:00:00Z'), 7) === '2026/09/07 08:00:00',
  formatEasygoTime(new Date('2026-09-07T01:00:00Z'), 7),
);
check(
  'severity naik saat jauh melampaui ambang',
  deriveSeverity('speed_flag', { speed: 95, speed_flag_value: 70 }) === 'critical',
);
check(
  'severity warning saat baru sedikit melampaui',
  deriveSeverity('speed_flag', { speed: 71, speed_flag_value: 70 }) === 'warning',
);

// --- Uji terhadap API sungguhan ---------------------------------------------
async function fetchLive(path, minutes, offsetHours) {
  const now = new Date();
  const from = new Date(now.getTime() - minutes * 60_000);
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: TOKEN },
    body: JSON.stringify({
      start_time: formatEasygoTime(from, offsetHours),
      stop_time: formatEasygoTime(now, offsetHours),
      lstVehicleId: null,
      lstNoPOL: [],
    }),
  });
  return { status: res.status, payload: await res.json() };
}

const MAPPING = {
  vhcid_path: 'vehicle_id',
  timestamp_path: 'gps_time',
  lat_path: 'lat',
  long_path: 'lon',
  no_plat_path: 'nopol',
};

const DISCRIMINATOR_MAP = {
  idle: 'idle_overtime',
  'forbidden parking': 'parking_overtime',
  'forbidden driving': 'forbidden_driving',
};

function mapRecord(rec, alertTypeOrNull, discriminatorPath, offsetHours) {
  let alertType = alertTypeOrNull;
  if (discriminatorPath) {
    const raw = parseText(getPath(rec, discriminatorPath));
    alertType = raw ? DISCRIMINATOR_MAP[raw.toLowerCase().trim()] ?? null : null;
  }
  if (!alertType) return null;

  return {
    vhcid: parseText(getPath(rec, MAPPING.vhcid_path)),
    alert_type: alertType,
    severity: deriveSeverity(alertType, rec),
    lat: parseCoord(getPath(rec, MAPPING.lat_path)),
    long: parseCoord(getPath(rec, MAPPING.long_path)),
    no_plat: parseText(getPath(rec, MAPPING.no_plat_path)),
    ts: parseTimestamp(getPath(rec, MAPPING.timestamp_path), offsetHours),
  };
}

/** Tiruan dedup harian PRD §7.1 untuk memeriksa efeknya pada data nyata. */
function dedup(rows) {
  const m = new Map();
  for (const r of rows) {
    const key = `${r.vhcid ?? ''}|${r.alert_type}|${r.ts?.slice(0, 10)}`;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

// Offset window BERBEDA per endpoint — speed_flag membaca UTC, Notifikasi
// membaca WIB. Lihat FINDINGS 3.1. Ini justru yang paling perlu diuji, karena
// offset yang salah tetap dijawab 'success' oleh API.
for (const [label, path, disc, offset] of [
  ['Speed Flag', '/api/report/speed_flag', null, 0],
  ['Notifikasi Operation', '/api/Notifikasi/Operation', 'tipe_notif', 7],
]) {
  console.log(`\n== ${label} (live, window 60 menit) ==`);
  try {
    const { status, payload } = await fetchLive(path, 60, offset);
    check('HTTP 200', status === 200);
    check('ResponseCode = 1', payload.ResponseCode === 1, payload.ResponseMessage);

    const records = payload.Data ?? [];
    console.log(`  ${records.length} record mentah`);

    const mapped = records
      .map((r) => mapRecord(r, disc ? null : 'speed_flag', disc, offset))
      .filter(Boolean);

    console.log(`  ${mapped.length} record termap (${records.length - mapped.length} dilewati)`);

    if (mapped.length > 0) {
      check('semua punya VHCID', mapped.every((r) => r.vhcid));
      check('semua punya timestamp valid', mapped.every((r) => r.ts));
      check('semua punya koordinat', mapped.every((r) => r.lat != null && r.long != null));
      check(
        'timestamp masuk akal (dalam 24 jam terakhir)',
        mapped.every((r) => Math.abs(Date.now() - Date.parse(r.ts)) < 86_400_000),
        `contoh: ${mapped[0].ts}`,
      );

      const byType = {};
      for (const r of mapped) byType[r.alert_type] = (byType[r.alert_type] ?? 0) + 1;
      console.log('  per alert_type:', JSON.stringify(byType));

      const d = dedup(mapped);
      console.log(`  setelah dedup harian: ${d.size} baris (dari ${mapped.length} kejadian)`);
      console.log('  contoh:', JSON.stringify(mapped[0]));
    } else if (records.length === 0) {
      console.log('  (tidak ada kejadian di window ini — bukan kegagalan)');
    }
  } catch (e) {
    check(`panggilan ${label}`, false, e.message);
  }
}

console.log(failures === 0 ? '\nSEMUA LULUS\n' : `\n${failures} PEMERIKSAAN GAGAL\n`);
process.exit(failures === 0 ? 0 : 1);
