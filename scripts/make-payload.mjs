/**
 * Ambil data sungguhan dari API EASYGO, petakan dengan logika normalisasi
 * produksi, lalu cetak payload persis seperti yang dikirim poller ke
 * upsert_alerts(). Dipakai untuk menguji dedup di database sungguhan.
 *
 * Pakai: node scripts/make-payload.mjs <speed_flag|notif> <source_id> > payload.json
 */
import {
  getPath, parseTimestamp, parseCoord, parseText, formatEasygoTime, deriveSeverity,
} from '../src/lib/normalize.ts';

const [which, sourceId] = process.argv.slice(2);
const TOKEN = process.env.EASYGO_TOKEN;
if (!TOKEN) {
  // Sengaja tanpa nilai cadangan: token EASYGO adalah kredensial produksi yang
  // membuka seluruh data armada. Menanamkannya di kode berarti ia ikut masuk
  // ke git dan tersebar ke setiap salinan repo.
  console.error('EASYGO_TOKEN belum diset. Jalankan dengan: node --env-file=.env.local ...');
  process.exit(1);
}

const CFG = {
  speed_flag: { path: '/api/report/speed_flag', offset: 0, disc: null },
  notif: {
    path: '/api/Notifikasi/Operation', offset: 7, disc: 'tipe_notif',
    map: { idle: 'idle_overtime', 'forbidden parking': 'parking_overtime',
           'forbidden driving': 'forbidden_driving' },
  },
}[which];

const now = new Date();
const from = new Date(now.getTime() - 90 * 60_000);

const res = await fetch('https://vtsapi.easygo-gps.co.id' + CFG.path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', token: TOKEN },
  body: JSON.stringify({
    start_time: formatEasygoTime(from, CFG.offset),
    stop_time: formatEasygoTime(now, CFG.offset),
    lstVehicleId: null, lstNoPOL: [],
  }),
});
const payload = await res.json();

const rows = [];
for (const rec of payload.Data ?? []) {
  let alertType = which === 'speed_flag' ? 'speed_flag' : null;
  if (CFG.disc) {
    const raw = parseText(getPath(rec, CFG.disc));
    alertType = raw ? CFG.map[raw.toLowerCase().trim()] ?? null : null;
  }
  if (!alertType) continue;

  const ts = parseTimestamp(getPath(rec, 'gps_time'), CFG.offset) ?? new Date().toISOString();
  rows.push({
    source_id: sourceId,
    vhcid: parseText(getPath(rec, 'vehicle_id')),
    alert_type: alertType,
    severity: deriveSeverity(alertType, rec),
    lat: parseCoord(getPath(rec, 'lat')),
    long: parseCoord(getPath(rec, 'lon')),
    no_plat: parseText(getPath(rec, 'nopol')),
    raw_payload: rec,
    first_seen_at: ts,
    last_seen_at: ts,
  });
}

// Penggabungan dalam batch, sama seperti di poller: ON CONFLICT tidak boleh
// menyentuh baris yang sama dua kali dalam satu perintah.
const merged = new Map();
for (const r of rows) {
  const key = `${r.vhcid ?? ''}|${r.alert_type}|${r.first_seen_at.slice(0, 10)}`;
  const prev = merged.get(key);
  if (!prev) merged.set(key, { ...r, occurrence_count: 1 });
  else {
    prev.occurrence_count++;
    if (r.first_seen_at < prev.first_seen_at) prev.first_seen_at = r.first_seen_at;
    if (r.last_seen_at > prev.last_seen_at) { prev.last_seen_at = r.last_seen_at; prev.severity = r.severity; }
  }
}

console.error(`${which}: ${payload.Data?.length ?? 0} mentah -> ${rows.length} termap -> ${merged.size} baris setelah gabung batch`);
process.stdout.write(JSON.stringify(Array.from(merged.values())));
