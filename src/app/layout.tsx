import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ACM — Alert Centre Monitoring',
  description: 'Konsolidasi alert armada TMS EASYGO — PT. Bumi Jasa Utama',
};

/**
 * Menerapkan tema tersimpan SEBELUM React sempat merender.
 *
 * Kalau tema baru dipasang di dalam komponen, halaman sempat tampil gelap satu
 * frame lalu berkedip jadi terang. Di ruang kontrol yang menyala berjam-jam,
 * kedipan seperti itu mengganggu, jadi skrip ini dijalankan lebih dulu.
 *
 * Default tetap gelap (UIUX §6) — mode terang hanya dipakai kalau pengguna
 * memilihnya secara sadar.
 */
const TEMA_AWAL = `
try {
  var t = localStorage.getItem('acm-theme');
  document.documentElement.classList.toggle('dark', t !== 'light');
} catch (e) {
  document.documentElement.classList.add('dark');
}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: TEMA_AWAL }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
