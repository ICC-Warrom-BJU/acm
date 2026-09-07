'use client';

import { formatClock, BUSINESS_TZ_LABEL } from '@/lib/time';
import { SEVERITY_BADGE, SEVERITY_BORDER, kecepatan, type Alert } from '@/lib/alert';

/**
 * Kartu satu alert di feed (UIUX §9 "Item Feed Alert").
 *
 * Latar SOLID `--surface-elevated`, bukan glass. Ini bukan pilihan gaya: dari
 * 2-4 meter, transparansi menurunkan kontras cukup jauh untuk membuat operator
 * salah membaca VHCID atau angka waktu (UIUX §4).
 *
 * Border kiri 4px berwarna severity supaya daftar bisa dipindai tanpa membaca
 * badge satu per satu.
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
  // Skala TV ~1.6-2x skala kerja (UIUX §3).
  const s = wall
    ? { plat: 'text-4xl', meta: 'text-lg', badge: 'text-lg', speed: 'text-3xl' }
    : { plat: 'text-2xl', meta: 'text-sm', badge: 'text-sm', speed: 'text-xl' };

  const kmh = kecepatan(a);

  return (
    <article
      className={`alert-enter rounded-alert border-l-4 bg-surface-elevated p-4 ${
        SEVERITY_BORDER[a.severity] ?? 'border-l-severity-unknown'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* VHCID & no. plat monospace: mata operator langsung membedakan
              data identitas unit dari teks naratif (UIUX §3). */}
          <p className={`truncate font-mono font-medium ${s.plat} leading-tight`}>
            {a.no_plat ?? a.vhcid ?? '—'}
          </p>
          <p className={`truncate font-mono ${s.meta} text-content-secondary`}>
            {a.vhcid ?? 'VHCID tidak diketahui'}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`rounded-full px-3 py-1 font-medium ${s.badge} ${
              SEVERITY_BADGE[a.severity] ?? 'bg-severity-unknown text-white'
            }`}
          >
            {a.severity}
          </span>

          {/* Kecepatan adalah pelanggarannya itu sendiri, bukan detail
              pendukung — jadi diberi warna kritis. Ini pemakaian warna severity
              yang sah (UIUX §10): yang dilarang adalah memakainya untuk elemen
              non-alert, sedangkan angka ini justru isi alertnya. */}
          {kmh != null && (
            <span className={`font-mono font-medium text-severity-critical ${s.speed}`}>
              {kmh} km/jam
            </span>
          )}
        </div>
      </div>

      <div className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 ${s.meta}`}>
        {a.occurrence_count > 1 && (
          <span className="text-content-secondary">{a.occurrence_count}× hari ini</span>
        )}
        <span className="font-mono text-content-secondary">
          {formatClock(a.last_seen_at)} {BUSINESS_TZ_LABEL}
        </span>

        {/* Opsional, bukan wajib: wall display murni tanpa perangkat input
            tetap berfungsi penuh tanpa pernah menekan ini (UIUX §8). */}
        <button
          onClick={() => onDetail(a.id)}
          className="ml-auto rounded-btn border border-line px-2.5 py-0.5 text-content-secondary transition-colors hover:border-brand hover:text-content-primary"
        >
          Detail
        </button>
      </div>

      <div className={`mt-1 ${s.meta} text-content-secondary`}>
        {a.cabang || a.group_project ? (
          <span className="line-clamp-1">
            {[a.cabang, a.group_project].filter(Boolean).join(' · ')}
          </span>
        ) : (
          // Unit belum terdaftar tetap tampil — operasional tidak boleh
          // terhambat oleh kelengkapan master data (PRD §7.3).
          <span className="rounded-full bg-severity-unknown/20 px-2 py-0.5 text-severity-unknown">
            Unit belum terdaftar
          </span>
        )}
      </div>
    </article>
  );
}
