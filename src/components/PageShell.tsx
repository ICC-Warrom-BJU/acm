import Link from 'next/link';
import { UserMenu } from './UserMenu';

/**
 * Kerangka halaman kerja (bukan wall display).
 *
 * Topbar glass mengambang dengan margin dari tepi, radius 24px (UIUX §5, §9).
 */
export function PageShell({
  title,
  subtitle,
  name,
  role,
  active,
  children,
}: {
  title: string;
  subtitle?: string;
  name: string;
  role: string;
  active: string;
  children: React.ReactNode;
}) {
  // Modul konfigurasi tidak ditampilkan sama sekali untuk Management — mereka
  // memang tidak punya akses (PRD §4), dan menampilkan tautan yang pasti
  // ditolak hanya membingungkan.
  const staff = role === 'super_admin' || role === 'staff_it';

  const nav = [
    { href: '/', label: 'Dashboard', staffOnly: false },
    { href: '/master-unit', label: 'Master Unit', staffOnly: false },
    { href: '/kesehatan', label: 'Kesehatan API', staffOnly: true },
    { href: '/sumber', label: 'Sumber', staffOnly: true },
    { href: '/jenis-alert', label: 'Jenis Alert', staffOnly: true },
  ].filter((n) => staff || !n.staffOnly);

  return (
    <div className="min-h-screen bg-surface-base p-4 md:p-6">
      <header className="glass mb-6 flex flex-wrap items-center justify-between gap-4 rounded-topbar px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-medium">{title}</h1>
          {subtitle && <p className="text-sm text-content-secondary">{subtitle}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <nav className="flex gap-1 text-sm">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-btn px-3 py-1.5 transition-colors ${
                  active === n.href
                    ? // Item aktif: latar brand-soft + teks penuh (UIUX §9)
                      'bg-brand-soft font-medium text-content-primary'
                    : 'text-content-secondary hover:bg-brand-soft hover:text-content-primary'
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <UserMenu name={name} role={role} />
        </div>
      </header>

      {children}
    </div>
  );
}
