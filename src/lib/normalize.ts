/**
 * Normalisasi payload API sumber ke skema alert ACM.
 *
 * Aturan di berkas ini berasal dari response asli yang diuji pada 2026-09-07 —
 * lihat `docs/FINDINGS_API_M0.md`. Kalau ada yang tampak berlebihan, biasanya
 * karena memang ada bentuk data nyata yang menuntutnya.
 */

/** Ambil nilai lewat jalur bertitik, mis. "data.gps.lat". */
export function getPath(obj: unknown, path: string | null | undefined): unknown {
  if (!path) return undefined;
  let cur: any = obj;
  for (const seg of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * EASYGO memakai "0001-01-01T00:00:00" sebagai penanda "tidak ada nilai",
 * bukan tanggal sungguhan. Kalau ini lolos, ia akan tersimpan sebagai tahun 1
 * dan merusak semua perhitungan rentang.
 */
const EMPTY_DATE_SENTINEL = /^0001-01-01/;

/**
 * Ubah timestamp jadi ISO UTC.
 *
 * Dua endpoint EASYGO memakai konvensi berbeda: `speed_flag` mengirim UTC
 * ("...Z") sedangkan `Notifikasi/Operation` mengirim offset lokal ("...+07:00").
 * Selama offsetnya ikut dikirim, keduanya ditangani benar tanpa tebakan.
 *
 * `fallbackOffsetHours` HANYA dipakai kalau timestamp datang tanpa penanda zona
 * waktu sama sekali, dan wajib diisi eksplisit oleh pemanggil — diambil dari
 * konfigurasi sumbernya. Sebelumnya nilai ini punya default tersembunyi (+7),
 * yang berarti sumber baru dengan konvensi berbeda akan tergeser berjam-jam
 * tanpa gejala apa pun: tidak ada error, hanya waktu yang salah.
 *
 * Tanpa penanganan ini, JavaScript akan menganggap timestamp polos sebagai
 * waktu lokal server — dan di Vercel server itu berjalan pada UTC.
 */
export function parseTimestamp(
  value: unknown,
  fallbackOffsetHours: number,
): string | null {
  if (value == null) return null;
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value !== 'string') return null;

  const raw = value.trim();
  if (!raw || EMPTY_DATE_SENTINEL.test(raw)) return null;

  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  // Format "YYYY/MM/DD HH:MM:SS" tidak dikenali andal oleh semua mesin JS.
  const iso = raw.replace(/\//g, '-').replace(' ', 'T');

  const sign = fallbackOffsetHours < 0 ? '-' : '+';
  const abs = Math.abs(fallbackOffsetHours);
  const suffix = `${sign}${String(Math.floor(abs)).padStart(2, '0')}:${String(
    Math.round((abs % 1) * 60),
  ).padStart(2, '0')}`;

  const d = new Date(hasOffset ? iso : `${iso}${suffix}`);

  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Koordinat: tolak nilai non-numerik dan titik nol-nol (GPS belum fix). */
export function parseCoord(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

export function parseText(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * Format waktu yang diminta EASYGO di body: "YYYY/MM/DD HH:MM:SS".
 *
 * `offsetHours` wajib diisi eksplisit — TIDAK ada default. Zona waktu yang
 * dipakai tiap endpoint untuk membaca window berbeda-beda (`speed_flag` UTC,
 * `Notifikasi/Operation` WIB), dan offset yang salah tidak menghasilkan error:
 * API tetap menjawab "success" untuk rentang yang keliru. Sebuah default di
 * sini akan menyembunyikan kesalahan itu, bukan mencegahnya.
 */
export function formatEasygoTime(d: Date, offsetHours: number): string {
  const shifted = new Date(d.getTime() + offsetHours * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}/${p(shifted.getUTCMonth() + 1)}/${p(shifted.getUTCDate())} ` +
    `${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}`
  );
}

/**
 * Turunkan severity.
 *
 * Milestone 0 memastikan tidak ada satu pun field severity di kedua endpoint,
 * jadi severity tidak bisa dipetakan — harus diturunkan. Aturan di bawah adalah
 * usulan awal yang masih menunggu kesepakatan (PRD §12, FINDINGS §8.3), dan
 * sengaja dikumpulkan di satu fungsi supaya mudah diubah saat sudah disepakati.
 */
export function deriveSeverity(alertType: string, rec: Record<string, any>): 'critical' | 'warning' | 'info' {
  const speed = parseCoord(rec.speed);
  const limit = parseCoord(rec.speed_flag_value);

  // Overspeed: seberapa jauh melampaui ambangnya, bukan sekadar melampaui.
  if (speed != null && limit != null && speed > 0 && limit > 0) {
    const excess = ((speed - limit) / limit) * 100;
    if (excess >= 25) return 'critical';
    if (excess >= 0) return 'warning';
  }

  switch (alertType) {
    case 'fuel_theft':
      return 'critical'; // dugaan pencurian BBM selalu butuh tindakan segera
    case 'speed_flag':
    case 'overspeed':
    case 'overspeed_in_geo':
    case 'forbidden_driving':
    case 'fatigue_driving':
      return 'critical';
    case 'forbidden_parking':
    case 'parking_overtime':
    case 'idle_overtime':
      return 'warning';
    default:
      return 'info';
  }
}
