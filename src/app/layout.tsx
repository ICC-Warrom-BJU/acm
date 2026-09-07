import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ACM — Alert Centre Monitoring',
  description: 'Konsolidasi alert armada TMS EASYGO — PT. Bumi Jasa Utama',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dark mode adalah default: dashboard wall display menyala berjam-jam,
    // dan warna severity lebih menonjol di latar gelap (UIUX §6).
    <html lang="id" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
