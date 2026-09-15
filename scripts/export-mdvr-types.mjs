/**
 * Ekspor seluruh alarm type MDVR EasyGo ke Excel.
 *
 * Jalankan:  node --env-file=.env.local scripts/export-mdvr-types.mjs
 * Hasil   :  docs/MDVR_Alarm_Types.xlsx
 *
 * Selain daftar ID dan nama dari API, berkas ini juga membawa kolom yang tidak
 * ada di API: pasangan L1/L2, jumlah kejadian nyata, dan rentang kecepatan.
 * Daftar telanjang berisi 59 baris tanpa konteks sulit dipakai untuk memutuskan
 * jenis mana yang perlu dipantau — angka kejadian yang membuatnya berguna.
 */
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';

const BASE = 'https://mdvr-openapi.easygo-gps.co.id';
const KEY = process.env.MDVR_API_KEY;

if (!KEY) {
  console.error('MDVR_API_KEY belum diset di .env.local');
  process.exit(1);
}

// --- token -----------------------------------------------------------------
const auth = await fetch(BASE + '/api/open/v1/auth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ api_key: KEY }),
});
const { access_token } = await auth.json();
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + access_token };

const tipe = (await (await fetch(BASE + '/api/open/v1/alarm-types', { headers: H })).json()).data;
console.log(`alarm type dari API: ${tipe.length}`);

// --- kejadian nyata 7 hari terakhir ----------------------------------------
// Dipakai untuk mengisi kolom "kejadian" dan "kecepatan". Tanpa ini pembaca
// tidak punya cara membedakan jenis yang aktif dari yang tidak pernah muncul.
let alarms = [];
try {
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: unit } = await svc.from('master_vehicles').select('vhcid');
  const ids = (unit ?? []).map((u) => u.vhcid);

  const z = (n) => String(n).padStart(2, '0');
  const f = (d) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  const AWAL = f(new Date(Date.now() - 7 * 86400_000));
  const AKHIR = f(new Date());

  /*
    Batching adaptif yang memecah diri pada DUA kondisi:

    1. Hasil tepat 200 — API membatasi take=200 dan tidak melaporkan total yang
       cocok, jadi 200 berarti "mungkin ada yang terpotong".

    2. Status 403 — API key hanya mengizinkan sebagian device, dan
       penolakannya semua-atau-tidak: SATU unit tak berizin di dalam array
       membuat seluruh permintaan gagal. Memecah batch mengisolasi unit yang
       ditolak; yang berizin tetap ikut tertarik.

    Tanpa penanganan 403 ini, satu unit tak berizin di antara 25 akan
    menghapus seluruh batch dari hasil — dan diam-diam, karena tidak ada
    galat yang muncul ke permukaan.
  */
  const kumpul = [];
  let ditolak = 0;
  const tarik = async (b) => {
    const res = await fetch(BASE + '/api/open/v1/alarms', {
      method: 'POST', headers: H,
      body: JSON.stringify({ vehicle_id: b, period_start: AWAL, period_end: AKHIR, take: 200 }),
    });

    if (res.status === 403 || res.status === 404) {
      if (b.length === 1) { ditolak++; return; }
      const t = Math.ceil(b.length / 2);
      await tarik(b.slice(0, t));
      await tarik(b.slice(t));
      return;
    }
    if (res.status !== 200) return;

    const d = (await res.json()).data ?? [];
    if (d.length === 200 && b.length > 1) {
      const t = Math.ceil(b.length / 2);
      await tarik(b.slice(0, t));
      await tarik(b.slice(t));
      return;
    }
    kumpul.push(...d);
  };

  const batch = [];
  for (let i = 0; i < ids.length; i += 25) batch.push(ids.slice(i, i + 25));
  const antre = [...batch];
  await Promise.all(Array.from({ length: 4 }, async () => { while (antre.length) await tarik(antre.shift()); }));

  alarms = [...new Map(kumpul.map((x) => [x.alarm_no, x])).values()];
  console.log(`kejadian 7 hari: ${alarms.length} alarm unik (${ditolak} unit tidak diizinkan API key)`);
} catch (e) {
  console.warn('Kejadian nyata dilewati:', e.message);
}

const statistik = (id) => {
  const d = alarms.filter((x) => String(x.alarm_id) === String(id));
  if (!d.length) return { n: 0, unit: 0, speed: '' };
  const s = d.map((x) => Number(x.speed)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    n: d.length,
    unit: new Set(d.map((x) => x.vehicle_id)).size,
    speed: s.length ? `${s[0]}–${s[s.length - 1]}` : '',
  };
};

// Pasangan L1/L2: perilaku sama, ambang kecepatan berbeda (~61 km/jam).
const pasangan = new Map();
for (const a of tipe) {
  if (a.alarm_type_id < 221 || a.alarm_type_id > 268) continue;
  const dasar = a.alarm_type_id < 251 ? a.alarm_type_id : a.alarm_type_id - 30;
  if (!pasangan.has(dasar)) pasangan.set(dasar, {});
  pasangan.get(dasar)[a.alarm_type_id < 251 ? 'l1' : 'l2'] = a.alarm_type_id;
}

const kelompok = (id) =>
  id < 221 ? 'ADAS — bahaya di depan kendaraan'
  : id < 251 ? 'DMS tingkat 1 — perilaku pengemudi'
  : id < 281 ? 'DMS tingkat 2 — perilaku pengemudi'
  : id < 291 ? 'BSD — titik buta'
  : 'Bad Driving — manuver kasar';

// --- tulis Excel -----------------------------------------------------------
const wb = new ExcelJS.Workbook();
wb.creator = 'ACM — PT. Bumi Jasa Utama';
wb.created = new Date();

const ws = wb.addWorksheet('Alarm Types');
ws.columns = [
  { header: 'alarm_type_id', key: 'id', width: 14 },
  { header: 'Nama di API', key: 'nama', width: 38 },
  { header: 'Kelompok', key: 'kelompok', width: 34 },
  { header: 'Tingkat', key: 'tingkat', width: 9 },
  { header: 'Pasangan', key: 'pasangan', width: 11 },
  { header: 'Severity (API)', key: 'sev', width: 14 },
  { header: 'Usulan severity ACM', key: 'sevAcm', width: 19 },
  { header: 'Perlu tindakan', key: 'tindakan', width: 15 },
  { header: 'SLA (menit)', key: 'sla', width: 12 },
  { header: 'Kejadian 7 hari', key: 'kejadian', width: 16 },
  { header: 'Unit terdampak', key: 'unitn', width: 15 },
  { header: 'Rentang kecepatan (km/jam)', key: 'speed', width: 25 },
  { header: 'routing_group', key: 'grup', width: 14 },
  { header: 'publish_policy', key: 'publish', width: 28 },
  { header: 'is_alarm', key: 'isAlarm', width: 10 },
];

for (const a of tipe.sort((x, y) => x.alarm_type_id - y.alarm_type_id)) {
  const id = a.alarm_type_id;
  const st = statistik(id);
  const L2 = id >= 251 && id <= 268;
  const L1 = id >= 221 && id <= 238;
  const dasar = L2 ? id - 30 : id;
  const p = pasangan.get(dasar);

  ws.addRow({
    id,
    nama: a.alarm_name,
    kelompok: kelompok(id),
    tingkat: L1 ? 'L1' : L2 ? 'L2' : '',
    pasangan: p ? (L1 ? `L2: ${p.l2 ?? '-'}` : `L1: ${p.l1 ?? '-'}`) : '',
    sev: a.severity,
    // Usulan BJU: L1 = warning, L2 = critical. Kecepatan tinggi membuat
    // perilaku yang sama jauh lebih berbahaya.
    sevAcm: L1 ? 'warning' : L2 ? 'critical' : a.severity === 'WARNING' ? 'warning' : 'info',
    tindakan: a.requires_internal_action ? 'YA' : '',
    sla: a.action_sla_minutes ?? '',
    kejadian: st.n || '',
    unitn: st.unit || '',
    speed: st.speed,
    grup: a.routing_group,
    publish: a.publish_policy,
    isAlarm: a.is_alarm ? 'ya' : 'tidak',
  });
}

ws.getRow(1).font = { bold: true };
ws.views = [{ state: 'frozen', ySplit: 1 }];
ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

// Sorot baris yang benar-benar pernah muncul — itu yang layak dipertimbangkan
// lebih dulu saat memilih jenis yang dipantau.
ws.eachRow((row, i) => {
  if (i === 1) return;
  if (row.getCell('kejadian').value) {
    row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE1F5EE' } }; });
  }
});

const info = wb.addWorksheet('Info');
info.columns = [{ header: 'Keterangan', width: 32 }, { header: 'Nilai', width: 72 }];
info.addRows([
  ['Sumber', `${BASE}/api/open/v1/alarm-types`],
  ['Jumlah alarm type', tipe.length],
  ['Kejadian dihitung dari', '7 hari terakhir, seluruh unit master data ACM yang diizinkan API key'],
  ['Alarm unik terkumpul', alarms.length],
  ['Jenis yang pernah muncul', tipe.filter((a) => statistik(a.alarm_type_id).n > 0).length],
  ['Baris berlatar hijau', 'Jenis yang benar-benar pernah muncul pada periode di atas'],
  ['Tingkat L1 / L2', 'Perilaku sama, ambang kecepatan berbeda. Pemisah teramati ~61 km/jam (akurasi 97,5% pada 282 sampel)'],
  ['Usulan severity ACM', 'L1 = warning, L2 = critical. Dapat diubah lewat halaman Jenis Alert tanpa perubahan kode'],
  ['Catatan filter API', 'Parameter alarm_type_id pada POST /alarms TIDAK berfungsi — nilai apa pun mengembalikan 0 hasil. Penyaringan harus dilakukan di sisi ACM'],
  ['Catatan batas hasil', 'POST /alarms membatasi take=200 dan tidak melaporkan total yang cocok. Penarikan di skrip ini memecah batch secara adaptif agar tidak ada yang hilang'],
  ['Diekspor', new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' }) + ' WITA'],
]);
info.getRow(1).font = { bold: true };

await wb.xlsx.writeFile('docs/MDVR_Alarm_Types.xlsx');
console.log('\ndocs/MDVR_Alarm_Types.xlsx tersimpan');
console.log(`  ${tipe.length} alarm type, ${tipe.filter((a) => statistik(a.alarm_type_id).n > 0).length} di antaranya pernah muncul`);
