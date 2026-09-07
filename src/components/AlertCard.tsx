'use client';

import { formatClock } from '@/lib/time';
import { SEVERITY_BADGE, SEVERITY_BORDER, kecepatan, type Alert } from '@/lib/alert';

/**
 * Kartu satu alert di feed (UIUX §9 "Item Feed Alert").
 *
 * Latar SOLID `--surface-elevated`, bukan glass. Ini bukan pilihan gaya: dari
 * 2-4 meter, transparansi menurunkan kontras cukup jauh untuk membuat operator
 * salah membaca VHCID atau angka waktu (UIUX §4). Border kiri 4px berwarna
 * severity supaya daftar bisa dipindai tanpa membaca badge satu per satu.
 *
 * Padat: dua baris, bukan empat. Semua keterangan sekunder (VHCID, jumlah
 * kejadian, waktu, cabang) digabung ke satu baris berpemisah titik. Dengan lima
 * lajur di layar sekaligus, tinggi kartu menentukan berapa banyak alert yang
 * terlihat tanpa menggulir — dan itu yang paling menentukan kegunaannya.
 *
 * Skala layar kerja sengaja lebih kecil dari angka acuan di UIUX §3 (24-28px
 * untuk plat). Angka itu ada demi keterbacaan dari 2-4 meter, yang hanya
 * berlaku di wall display — dan mode `wall` tetap dijaga pada 40px, sesuai
 * yang dituju dokumen. Di layar kerja berjarak 50 cm, ukuran sebesar itu justru
 * mengurangi jumlah alert yang muat di layar tanpa menambah keterbacaan.
 */
export function AlertCard({
  a,
  wall,
  onDetail,
}: {
  a: Alert;
  wall: boolean;
  onDetail: (id: string) => void;
}) {
  const s = wall
    ? {
        pad: 'p-3.5',
        plat: 'text-[40px] leading-none',
        badge: 'text-base px-3 py-1',
        speed: 'text-3xl',
        meta: 'text-base',
        tombol: 'text-sm px-2.5 py-1',
      }
    : {
        pad: 'p-3',
        plat: 'text-lg leading-tight',
        badge: 'text-[11px] px-2 py-0.5',
        speed: 'text-lg',
        meta: 'text-xs',
        tombol: 'text-[11px] px-2 py-0.5',
      };

  const kmh = kecepatan(a);

  // Keterangan sekunder digabung supaya tidak memakan satu baris masing-masing.
  const keterangan = [
    a.vhcid ?? 'tidak terdaftar',
    a.occurrence_count > 1 ? `${a.occurrence_count}×` : null,
    formatClock(a.last_seen_at),
    a.cabang,
  ].filter(Boolean);

  return (
    <article
      className={`alert-enter rounded-alert border-l-4 bg-surface-elevated ${s.pad} ${
        SEVERITY_BORDER[a.severity] ?? 'border-l-severity-unknown'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        {/* VHCID & no. plat monospace: mata operator langsung membedakan data
            identitas unit dari teks naratif (UIUX §3). */}
        <p className={`min-w-0 truncate font-mono font-medium ${s.plat}`}>
          {a.no_plat ?? a.vhcid ?? '—'}
        </p>

        <div className="flex shrink-0 items-center gap-2">
          {/* Kecepatan adalah pelanggarannya itu sendiri, bukan detail
              pendukung — jadi diberi warna kritis. Ini pemakaian warna severity
              yang sah (UIUX §10): yang dilarang adalah memakainya untuk elemen
              non-alert, sedangkan angka ini justru isi alertnya. */}
          {kmh != null && (
            <span className={`font-mono font-medium text-severity-critical ${s.speed}`}>
              {kmh}
              <span className={s.meta}> km/j</span>
            </span>
          )}

          <span
            className={`rounded-full font-medium ${s.badge} ${
              SEVERITY_BADGE[a.severity] ?? 'bg-severity-unknown text-white'
            }`}
          >
            {a.severity}
          </span>
        </div>
      </div>

      <div className={`mt-1 flex items-center gap-2 ${s.meta} text-content-secondary`}>
        <p className="min-w-0 flex-1 truncate font-mono">
          {keterangan.join(' · ')}
          {!a.cabang && (
            // Unit belum terdaftar tetap tampil — operasional tidak boleh
            // terhambat oleh kelengkapan master data (PRD §7.3).
            <span className="text-severity-unknown"> · belum terdaftar</span>
          )}
        </p>

        {/* Opsional, bukan wajib: wall display murni tanpa perangkat input
            tetap berfungsi penuh tanpa pernah menekan ini (UIUX §8). */}
        <button
          onClick={() => onDetail(a.id)}
          className={`shrink-0 rounded-btn border border-line ${s.tombol} transition-colors hover:border-brand hover:text-content-primary`}
        >
          Detail
        </button>
      </div>
    </article>
  );
}
