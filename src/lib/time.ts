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

/**
 * Tanggal kalender bisnis dari sebuah timestamp, format 'YYYY-MM-DD'.
 *
 * WAJIB dipakai untuk apa pun yang berkaitan dengan dedup harian. Nilainya
 * harus sama persis dengan kolom generated `alerts.occurrence_date`, yang
 * dihitung database sebagai `(first_seen_at at time zone 'Asia/Makassar')::date`.
 *
 * Memakai `iso.slice(0, 10)` untuk keperluan ini SALAH: itu memberi tanggal UTC,
 * yang berbeda dari tanggal WITA selama delapan jam setiap hari (16:00-24:00
 * UTC = 00:00-08:00 WITA keesokan harinya). Ketidaksepakatan itu membuat poller
 * mengirim dua baris yang menurut database adalah satu, dan seluruh perintah
 * ditolak dengan "ON CONFLICT DO UPDATE command cannot affect row a second time".
 *
 * Dihitung lewat Intl, bukan dengan menambahkan 8 jam secara manual, supaya
 * tetap benar kalau zona waktu bisnisnya kelak diubah.
 */
export function businessDate(iso: string): string {
  // Locale 'en-CA' menghasilkan format YYYY-MM-DD.
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: BUSINESS_TIMEZONE });
}

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
