/**
 * Zona waktu bisnis ACM.
 *
 * Ada tiga zona waktu berbeda yang berperan di sistem ini, dan mencampurnya
 * adalah sumber kesalahan yang tidak menimbulkan error — hanya angka yang
 * salah. Pembagiannya:
 *
 * 1. Zona waktu PENYIMPANAN — selalu UTC. Semua kolom `timestamptz`.
 *
 * 2. Zona waktu WINDOW REQUEST — milik masing-masing API sumber, bukan milik
 *    BJU. Dikonfigurasi per baris di `alert_sources.time_window_offset_hours`
 *    (`speed_flag` UTC, `Notifikasi/Operation` WIB). Tidak ada hubungannya
 *    dengan berkas ini.
 *
 * 3. Zona waktu BISNIS — di bawah ini. Dipakai untuk apa yang dilihat dan
 *    dihitung manusia: jam di feed, sumbu grafik, dan batas "hari yang sama"
 *    pada dedup harian (PRD §7.1).
 *
 * BJU memilih WITA karena control room berada di Makassar — operator membaca
 * jam yang sama dengan jam dinding di ruangan.
 *
 * Konsekuensi yang perlu diingat saat membaca laporan: batas hari ACM bergeser
 * satu jam dari batas hari TMS EASYGO (yang memakai WIB), jadi rekap harian
 * ACM bisa berbeda tipis dengan laporan TMS untuk kejadian di sekitar tengah
 * malam. Ini konsekuensi yang disadari, bukan bug.
 *
 * PENTING: nilai di bawah harus SAMA dengan zona waktu pada kolom generated
 * `alerts.occurrence_date` di `0001_schema.sql` serta pada `rollup_daily()` dan
 * `purge_old_data()` di `0004_scheduler.sql`. Kalau berbeda, tampilan dan
 * agregasi akan memakai batas hari yang tidak sama.
 */
export const BUSINESS_TIMEZONE = 'Asia/Makassar';

/** Label singkat untuk ditampilkan di sebelah jam. */
export const BUSINESS_TZ_LABEL = 'WITA';

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: BUSINESS_TIMEZONE,
  });
}

export function formatHour(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    timeZone: BUSINESS_TIMEZONE,
  });
}
