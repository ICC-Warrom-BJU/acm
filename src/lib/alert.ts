import { formatJam } from './time';

/**
 * Tipe dan helper alert yang dipakai bersama oleh feed, lane, grafik, dan
 * dashboard. Dikumpulkan di satu tempat supaya definisi severity tidak
 * tercecer dan berisiko berbeda antar komponen.
 */

export interface Alert {
  id: string;
  vhcid: string | null;
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  no_plat: string | null;
  cabang: string | null;
  group_project: string | null;
  occurrence_count: number;
  first_seen_at?: string | null;
  last_seen_at: string;
  status: string;

  /**
   * Jejak penanganan. Dibawa ke kartu supaya operator lain tahu alert ini
   * sudah dipegang seseorang — tanpa itu, dua orang bisa menelepon driver yang
   * sama untuk kejadian yang sama.
   */
  acknowledged_at?: string | null;
  ack?: { full_name: string | null } | null;

  /**
   * Kecepatan saat pelanggaran, khusus speed_flag.
   *
   * Diambil sebagai satu field dari jsonb (`speed:raw_payload->speed`), bukan
   * dengan memuat seluruh raw_payload — dashboard menahan ratusan baris dan
   * payload penuh akan memperberat wall display. Baris yang tiba lewat Realtime
   * membawa raw_payload utuh, jadi keduanya perlu dibaca (lihat kecepatan()).
   */
  speed?: number | string | null;

  /**
   * Keterangan kejadian dari API, mis. "IDLE >= 1h, 2m".
   *
   * Untuk jenis selain speed_flag, durasi pelanggaran HANYA ada di dalam teks
   * ini — API tidak menyediakannya sebagai angka. `durasi_stop` dan
   * `durasi_moving` justru selalu null pada record IDLE (diperiksa langsung
   * pada 2026-09-07), jadi mengurai teks ini satu-satunya jalan.
   */
  ket?: string | null;

  /**
   * Lama mengemudi menerus, khusus fatigue_driving ("4h").
   *
   * Regulasinya melarang mengemudi lebih dari 4 jam tanpa henti, jadi angka
   * inilah isi pelanggarannya — setara `speed` pada speed_flag. Berbeda dari
   * jenis lain, nilainya tersedia sebagai field tersendiri sehingga tidak perlu
   * diurai dari teks.
   */
  dm?: string | null;

  raw_payload?: {
    speed?: number | string | null;
    ket_notif?: string | null;
    durasi_moving?: string | null;
  } | null;
}

export const KOLOM_ALERT =
  'id, vhcid, alert_type, severity, no_plat, cabang, group_project, occurrence_count, first_seen_at, last_seen_at, status, acknowledged_at, ack:acknowledged_by(full_name), speed:raw_payload->speed, ket:raw_payload->>ket_notif, dm:raw_payload->>durasi_moving';

/** Warna severity — sama di mode terang maupun gelap (UIUX §2.3). */
export const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-severity-critical text-white',
  warning: 'bg-severity-warning text-black',
  info: 'bg-severity-info text-white',
};

export const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-l-severity-critical',
  warning: 'border-l-severity-warning',
  info: 'border-l-severity-info',
};

/** Kecepatan dari muatan awal (kolom teralias) atau dari event Realtime. */
export function kecepatan(a: Alert): number | null {
  const v = a.speed ?? a.raw_payload?.speed;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const SATUAN: Record<string, string> = { h: 'j', m: 'm', s: 'd' };

/** "4h" jadi "4j", "1h, 30m" jadi "1j 30m". Null kalau tak ada pola waktu. */
function formatDurasi(teks: string): string | null {
  const bagian = [...teks.matchAll(/(\d+)\s*([hms])/gi)];
  if (bagian.length === 0) return null;
  return bagian.map((b) => b[1] + SATUAN[b[2].toLowerCase()]).join(' ');
}

/**
 * Durasi pelanggaran, diurai dari `ket_notif`.
 *
 *   "IDLE >= 1h"                    -> "≥ 1j"
 *   "IDLE >= 1h, 2m"                -> "≥ 1j 2m"
 *   "Forbidden Parking >= 2h, 3m"   -> "≥ 2j 3m"
 *
 * Sengaja hanya membaca bagian SETELAH ">=". Tanpa penjangkaran itu, pola angka
 * akan salah menangkap kasus lain: "OVERSPEED max 49 · 1m, 20s" akan terbaca
 * sebagai durasi 1 menit, dan "MOVEMENT 32 km/h | 4h" sebagai 4 jam — padahal
 * angka pertamanya kecepatan, bukan durasi.
 *
 * Gagal-aman: kalau polanya tidak dikenali tapi ">=" tetap ada, teks setelahnya
 * ditampilkan apa adanya. Kalau ">=" tidak ada sama sekali (mis. "FATIQUE"),
 * hasilnya null dan tidak ada yang dirender — lebih baik kosong daripada
 * mengulang nama jenis yang sudah tertulis di kepala lajur.
 *
 * Ini pengurai berbasis teks, jadi rapuh terhadap perubahan format di sisi
 * EASYGO. Itu risiko yang disadari: API tidak menyediakan alternatif numerik.
 */
export function durasiPelanggaran(a: Alert): string | null {
  /*
    Field numerik lebih dulu, penguraian teks belakangan.

    fatigue_driving menyimpan lama mengemudi di `durasi_moving` ("4h") — inti
    pelanggarannya, karena regulasinya melarang mengemudi lebih dari 4 jam
    menerus. Nilainya diambil langsung, tanpa menebak dari teks.

    Field ini eksklusif milik fatigue_driving; jenis lain selalu null
    (diperiksa terhadap seluruh alert produksi pada 2026-09-07), jadi tidak ada
    risiko jenis lain menampilkan angka yang bukan miliknya.

    Tanpa "≥" karena ini durasi terukur, bukan ambang yang terlampaui.
  */
  const dm = a.dm ?? a.raw_payload?.durasi_moving;
  if (dm) {
    const hasil = formatDurasi(String(dm));
    if (hasil) return hasil;
  }

  const teks = a.ket ?? a.raw_payload?.ket_notif;
  if (!teks) return null;

  const cocok = String(teks).match(/>=\s*(.+)$/);
  if (!cocok) return null;

  const sisa = cocok[1].trim();
  const hasil = formatDurasi(sisa);
  return hasil ? '≥ ' + hasil : sisa.slice(0, 16);
}

export interface Metrik {
  /** Angka besar berwarna kritis — inti pelanggarannya. */
  utama: string;
  /** Satuan kecil yang menempel, mis. "km/j". */
  satuan?: string;
  /** Keterangan kecil di sebelahnya, mis. durasi. */
  sekunder?: string;
}

/**
 * "Ukuran pelanggaran" satu alert — isi slot menonjol di kartu.
 *
 * Setiap jenis punya inti yang berbeda, dan slot ini menyesuaikan supaya mata
 * operator selalu menemukan angka terpenting di tempat yang sama:
 *
 *   speed_flag         kecepatan          "74 km/j"
 *   fatigue_driving    lama mengemudi     "4j"        (regulasi maks 4 jam menerus)
 *   forbidden_driving  JAM kejadian       "08:00 · ≥ 1j 7m"
 *   idle/parking       durasi             "≥ 1j 2m"
 *
 * forbidden_driving ditangani khusus karena pelanggarannya adalah *kapan*
 * mengemudi, bukan berapa lama — mengemudi di jam yang tidak diperbolehkan.
 * Menampilkan durasinya saja membuatnya mudah tertukar dengan fatigue driving,
 * seolah-olah masalahnya lama mengemudi. Jamnya jadi angka utama, durasinya
 * (lama mengemudi di dalam jam terlarang) mengikut sebagai keterangan.
 *
 * Jenis disebut eksplisit di sini, satu-satunya tempat di kode yang begitu.
 * Ini keputusan penyajian yang terikat pada makna jenis tersebut, bukan
 * konfigurasi — jenis baru dari master data tetap tampil benar lewat jalur
 * umum di bawah, hanya tanpa perlakuan khusus.
 */
export function metrik(a: Alert): Metrik | null {
  const kmh = kecepatan(a);
  if (kmh != null) return { utama: String(kmh), satuan: 'km/j' };

  const lama = durasiPelanggaran(a);

  if (a.alert_type === 'forbidden_driving' && a.first_seen_at) {
    // Jam MULAI, bukan jam terakhir terlihat: yang dilanggar adalah saat unit
    // mulai bergerak di periode terlarang.
    return { utama: formatJam(a.first_seen_at), sekunder: lama ?? undefined };
  }

  return lama ? { utama: lama } : null;
}

/** Label jenis alert untuk manusia. */
export function labelJenis(t: string) {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Urutan lane di dashboard.
 *
 * Jenis yang paling gawat diletakkan lebih dulu supaya mata yang memindai dari
 * kiri atas menemukannya pertama. Jenis di luar daftar ini tetap muncul, diurut
 * setelahnya — daftar jenis bisa bertambah lewat master data tanpa sentuh kode,
 * jadi komponen ini tidak boleh menganggap daftarnya tetap.
 */
const URUTAN = [
  'speed_flag',
  'fatigue_driving',
  'forbidden_driving',
  'overspeed',
  'idle_overtime',
  'parking_overtime',
];

export function urutkanJenis(jenis: string[]) {
  return [...jenis].sort((a, b) => {
    const ia = URUTAN.indexOf(a);
    const ib = URUTAN.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}
