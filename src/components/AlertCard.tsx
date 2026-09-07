'use client';

import { formatClock, formatJam } from '@/lib/time';
import { SEVERITY_BADGE, SEVERITY_BORDER, metrik, type Alert } from '@/lib/alert';

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
        // Skala padat untuk layar kerja. 13px untuk data identitas, 11px untuk
        // keterangan sekunder — di bawah 14px yang disebut UIUX §3 sebagai
        // ukuran body layar kerja, karena ini daftar padat yang dipindai dari
        // jarak 50 cm, bukan teks yang dibaca menerus.
        pad: 'px-2.5 py-1.5',
        plat: 'text-[13px] leading-tight',
        badge: 'text-[10px] px-1.5 py-0',
        speed: 'text-[13px]',
        meta: 'text-[11px]',
        tombol: 'text-[10px] px-1.5 py-0',
      };

  /*
    Satu slot "ukuran pelanggaran" yang isinya menyesuaikan jenis alert:
    kecepatan untuk speed_flag, durasi untuk idle/parking/forbidden driving.
    Diletakkan di posisi yang sama supaya mata operator selalu menemukan angka
    terpenting di tempat yang sama, apa pun jenis alertnya.
  */
  const m = metrik(a);

  /*
    Alert yang sudah di-acknowledge sengaja TETAP tampil — wall display adalah
    layar kesadaran bersama, dan menyembunyikan pekerjaan yang sedang berjalan
    justru membuat operator lain mengira belum ada yang menanganinya.

    Yang diubah hanya penekanannya: diredupkan dan diberi label penangan,
    supaya yang belum tersentuh tetap paling menonjol.
  */
  const ditangani = a.status === 'acknowledged';

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
      } ${ditangani ? 'opacity-60' : ''}`}
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
          {m != null && (
            <span className="flex items-baseline gap-1 whitespace-nowrap font-mono">
              <span className={`font-medium text-severity-critical ${s.speed}`}>
                {m.utama}
                {m.satuan && (
                  <span className={wall ? s.meta : 'text-[10px]'}> {m.satuan}</span>
                )}
              </span>
              {m.sekunder && (
                <span className={`${wall ? s.meta : 'text-[10px]'} text-content-secondary`}>
                  · {m.sekunder}
                </span>
              )}
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

      {ditangani && (
        /* Warna brand, bukan warna severity: ini status penanganan, bukan
           tingkat kegawatan (UIUX §10 melarang warna severity untuk elemen
           non-alert). */
        <p className={`mt-1 flex items-center gap-1.5 ${s.meta} text-brand`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6L9 17l-5-5" />
          </svg>
          Ditangani
          {a.ack?.full_name ? ` ${a.ack.full_name}` : ''}
          {a.acknowledged_at ? ` · ${formatJam(a.acknowledged_at)}` : ''}
        </p>
      )}

      <div className={`${wall ? 'mt-1' : 'mt-0.5'} flex items-center gap-2 ${s.meta} text-content-secondary`}>
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
