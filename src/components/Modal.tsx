'use client';

import { useEffect, useRef } from 'react';

/**
 * Dialog modal yang dapat diakses keyboard dan pembaca layar.
 *
 * Sebelumnya kedua modal di aplikasi ini hanya `div` biasa: tidak diumumkan
 * sebagai dialog, fokus keyboard tetap berkeliaran di halaman di belakangnya,
 * dan Esc tidak selalu menutup. Bagi operator yang bekerja dengan keyboard,
 * modal seperti itu praktis menjebak — Tab terus berjalan ke elemen yang
 * tertutup lapisan gelap dan tidak terlihat.
 *
 * Yang ditangani di sini:
 *   - role="dialog" + aria-modal + aria-labelledby, sehingga pembaca layar
 *     mengumumkan judulnya dan tahu isi di belakang sedang tidak aktif
 *   - fokus dipindahkan ke dalam dialog saat terbuka
 *   - Tab dilingkarkan di dalam dialog (focus trap)
 *   - Esc menutup, dan fokus dikembalikan ke elemen pemicu
 *   - gulir halaman latar dikunci selama modal terbuka
 */
export function Modal({
  judul,
  onClose,
  lebar = 'max-w-3xl',
  children,
}: {
  judul: string;
  onClose: () => void;
  lebar?: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const pemicu = useRef<Element | null>(null);
  const judulId = useRef(`modal-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    pemicu.current = document.activeElement;

    // Kunci gulir latar. Tanpa ini, menggulir di dalam modal akan menyeret
    // halaman di belakangnya begitu isi modal habis.
    const gulirAsli = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Fokus ke elemen pertama yang bisa difokus, atau ke panelnya sendiri.
    const fokusPertama = () => {
      const target =
        panel.current?.querySelector<HTMLElement>(FOKUSABLE) ?? panel.current;
      target?.focus();
    };
    const t = setTimeout(fokusPertama, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !panel.current) return;

      const bisa = [...panel.current.querySelectorAll<HTMLElement>(FOKUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (bisa.length === 0) return;

      const pertama = bisa[0];
      const terakhir = bisa[bisa.length - 1];

      // Lingkarkan fokus: dari elemen terakhir Tab kembali ke yang pertama,
      // dan Shift+Tab dari yang pertama kembali ke yang terakhir.
      if (!e.shiftKey && document.activeElement === terakhir) {
        e.preventDefault();
        pertama.focus();
      } else if (e.shiftKey && document.activeElement === pertama) {
        e.preventDefault();
        terakhir.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);

    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = gulirAsli;
      // Kembalikan fokus ke tombol yang membuka modal, supaya pengguna keyboard
      // tidak terlempar ke awal halaman.
      (pemicu.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={judulId.current}
        tabIndex={-1}
        // Klik di dalam panel tidak boleh ikut menutup modal.
        onClick={(e) => e.stopPropagation()}
        className={`glass max-h-[88vh] w-full ${lebar} overflow-y-auto rounded-card p-6`}
      >
        {/* Judul selalu ada di DOM untuk pembaca layar, meski secara visual
            komponen anak menampilkannya dengan gaya sendiri. */}
        <h2 id={judulId.current} className="sr-only">
          {judul}
        </h2>
        {children}
      </div>
    </div>
  );
}

const FOKUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
