'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Sidebar navigasi (UIUX §7, §9).
 *
 * Glass dengan radius 28px — elemen "furnitur" paling besar, jadi radiusnya
 * paling besar pula (UIUX §5). Item aktif mendapat latar `--brand-primary-soft`
 * plus indikator garis kiri hijau solid.
 *
 * Mode `ciut` (wall display) menampilkan ikon saja, supaya ruang untuk grafik
 * dan feed maksimal.
 */

interface Item {
  href: string;
  label: string;
  ikon: React.ReactNode;
  staffOnly?: boolean;
}

export function Sidebar({ role, ciut = false }: { role: string; ciut?: boolean }) {
  const path = usePathname();
  const staff = role === 'super_admin' || role === 'staff_it';

  const items: Item[] = [
    { href: '/', label: 'Dashboard', ikon: <IkonGrid /> },
    { href: '/antrian', label: 'Antrian', ikon: <IkonDaftar /> },
    { href: '/ringkasan', label: 'Ringkasan', ikon: <IkonGrafik /> },
    { href: '/heatmap', label: 'Heatmap', ikon: <IkonPeta /> },
    { href: '/master-unit', label: 'Master Unit', ikon: <IkonTruk /> },
    { href: '/kesehatan', label: 'Kesehatan API', ikon: <IkonDenyut />, staffOnly: true },
    { href: '/sumber', label: 'Sumber API', ikon: <IkonPlug />, staffOnly: true },
    { href: '/jenis-alert', label: 'Jenis Alert', ikon: <IkonTag />, staffOnly: true },
  ].filter((i) => staff || !i.staffOnly);

  return (
    <aside
      className={`glass flex shrink-0 flex-col gap-1 rounded-sidebar p-3 ${ciut ? 'w-[76px]' : 'w-[212px]'}`}
    >
      <div className={`mb-3 px-2 pt-1 ${ciut ? 'text-center' : ''}`}>
        <p className="font-mono text-lg font-medium text-brand">ACM</p>
        {!ciut && <p className="text-xs text-content-secondary">Alert Centre</p>}
      </div>

      <nav className="flex flex-col gap-1">
        {items.map((i) => {
          const aktif = i.href === '/' ? path === '/' : path.startsWith(i.href);
          return (
            <Link
              key={i.href}
              href={i.href}
              title={ciut ? i.label : undefined}
              className={`relative flex items-center gap-3 rounded-btn px-3 py-2.5 transition-colors ${
                aktif
                  ? 'bg-brand-soft font-medium text-content-primary'
                  : 'text-content-secondary hover:bg-brand-soft hover:text-content-primary'
              } ${ciut ? 'justify-center' : ''}`}
            >
              {/* Indikator garis kiri hijau solid untuk item aktif (UIUX §9). */}
              {aktif && (
                <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-brand" />
              )}
              <span className="shrink-0">{i.ikon}</span>
              {!ciut && <span className="truncate text-sm">{i.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/*
  Ikon ditulis sebagai SVG inline, bukan dari pustaka ikon.
  Alasannya: hanya delapan ikon yang dibutuhkan, sedangkan menambah pustaka
  berarti menambah puluhan kilobyte ke bundel yang dimuat wall display
  sepanjang hari. Semuanya memakai currentColor supaya ikut warna item aktif.
*/
const svg = {
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const IkonGrid = () => (
  <svg {...svg}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
);
const IkonDaftar = () => (
  <svg {...svg}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
);
const IkonGrafik = () => (
  <svg {...svg}><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></svg>
);
const IkonPeta = () => (
  <svg {...svg}><path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
);
const IkonTruk = () => (
  <svg {...svg}><path d="M3 16V6h11v10" /><path d="M14 9h4l3 3.5V16h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></svg>
);
const IkonDenyut = () => (
  <svg {...svg}><path d="M3 12h4l2.5-6 4 12L16 12h5" /></svg>
);
const IkonPlug = () => (
  <svg {...svg}><path d="M9 3v6M15 3v6" /><path d="M6 9h12v3a6 6 0 0 1-12 0z" /><path d="M12 18v3" /></svg>
);
const IkonTag = () => (
  <svg {...svg}><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>
);
