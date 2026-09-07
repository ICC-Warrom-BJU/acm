'use client';

import { useEffect, useState } from 'react';

/**
 * Toggle mode terang/gelap (UIUX §6).
 *
 * Dark mode adalah default. Route wall display tidak pernah merender komponen
 * ini — di layar bersama, operator tidak boleh tidak sengaja mengubah mode.
 *
 * CATATAN: UIUX §6 meminta preferensi disimpan per PENGGUNA, bukan per
 * perangkat. Saat ini disimpan di localStorage, jadi masih per perangkat.
 * Menyimpannya per pengguna butuh kolom `theme` di `user_profiles` — perubahan
 * skema yang sengaja belum saya lakukan agar tidak menambah migrasi tertunda.
 */
export function ThemeToggle() {
  const [gelap, setGelap] = useState(true);

  useEffect(() => {
    setGelap(document.documentElement.classList.contains('dark'));
  }, []);

  function ubah() {
    const baru = !gelap;
    setGelap(baru);
    document.documentElement.classList.toggle('dark', baru);
    try {
      localStorage.setItem('acm-theme', baru ? 'dark' : 'light');
    } catch {
      // Peramban yang memblokir penyimpanan situs tidak boleh menggagalkan
      // pergantian mode itu sendiri.
    }
  }

  return (
    <button
      onClick={ubah}
      title={gelap ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
      aria-label={gelap ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
      className="rounded-btn border border-line p-2 text-content-secondary transition-colors hover:border-brand hover:text-content-primary"
    >
      {gelap ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
