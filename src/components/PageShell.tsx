import { Sidebar } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

/**
 * Kerangka halaman kerja (bukan wall display).
 *
 * Memakai sidebar yang sama dengan dashboard supaya navigasi tidak berpindah
 * tempat saat berganti halaman. Topbar glass radius 24px, sidebar 28px — makin
 * besar dan makin "furnitur" elemennya, makin besar radiusnya (UIUX §5).
 *
 * Prop `active` tidak lagi diperlukan: sidebar menentukan item aktif dari
 * pathname, sehingga tidak ada lagi kemungkinan halaman menyorot menu yang
 * salah karena nilainya lupa diperbarui.
 */
export function PageShell({
  title,
  subtitle,
  name,
  role,
  aksi,
  children,
}: {
  title: string;
  subtitle?: string;
  name: string;
  role: string;
  /** Tombol khusus halaman, mis. Export. */
  aksi?: React.ReactNode;
  /** Diterima demi kompatibilitas pemanggil lama; sidebar kini memakai pathname. */
  active?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen gap-4 bg-surface-base p-4">
      <Sidebar role={role} />

      <main className="min-w-0 flex-1">
        <header className="glass mb-6 flex flex-wrap items-center justify-between gap-4 rounded-topbar px-6 py-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-medium">{title}</h1>
            {subtitle && <p className="text-sm text-content-secondary">{subtitle}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {aksi}
            <ThemeToggle />
            <UserMenu name={name} role={role} />
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
