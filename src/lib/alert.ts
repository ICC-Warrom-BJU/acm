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
  last_seen_at: string;
  status: string;

  /**
   * Kecepatan saat pelanggaran, khusus speed_flag.
   *
   * Diambil sebagai satu field dari jsonb (`speed:raw_payload->speed`), bukan
   * dengan memuat seluruh raw_payload — dashboard menahan ratusan baris dan
   * payload penuh akan memperberat wall display. Baris yang tiba lewat Realtime
   * membawa raw_payload utuh, jadi keduanya perlu dibaca (lihat kecepatan()).
   */
  speed?: number | string | null;
  raw_payload?: { speed?: number | string | null } | null;
}

export const KOLOM_ALERT =
  'id, vhcid, alert_type, severity, no_plat, cabang, group_project, occurrence_count, last_seen_at, status, speed:raw_payload->speed';

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
