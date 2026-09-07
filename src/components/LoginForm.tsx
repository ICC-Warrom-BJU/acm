'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Halaman masuk (PRD §4 — seluruh akses memerlukan sesi terautentikasi).
 *
 * Glass dipakai di sini karena kartu form termasuk "furnitur", bukan teks
 * kritikal yang harus terbaca dari jarak jauh (UIUX §4).
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Pesan Supabase berbahasa Inggris dan generik; diterjemahkan seperlunya
      // tanpa membocorkan apakah email-nya terdaftar atau tidak.
      setError(
        /invalid login/i.test(error.message)
          ? 'Email atau kata sandi salah.'
          : error.message,
      );
      setBusy(false);
      return;
    }

    // refresh() supaya middleware dan Server Component membaca cookie sesi yang
    // baru; push() saja akan menampilkan halaman dari cache tanpa sesi.
    router.replace(next);
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-base p-6">
      <div className="glass w-full max-w-sm rounded-card p-8">
        <h1 className="text-2xl font-medium">Alert Centre Monitoring</h1>
        <p className="mt-1 text-sm text-content-secondary">PT. Bumi Jasa Utama</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm text-content-secondary">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-input border border-line bg-surface-elevated px-3 py-2.5 outline-none focus:border-brand"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm text-content-secondary">
              Kata sandi
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-input border border-line bg-surface-elevated px-3 py-2.5 outline-none focus:border-brand"
            />
          </div>

          {error && (
            // Solid, bukan glass: pesan galat harus terbaca instan (UIUX §4).
            <p className="rounded-input bg-severity-critical px-3 py-2 text-sm text-white">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-btn bg-brand px-4 py-2.5 font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
          >
            {busy ? 'Memproses…' : 'Masuk'}
          </button>
        </form>

        <p className="mt-6 text-xs text-content-secondary">
          Belum punya akun? Hubungi Super Admin — pendaftaran mandiri sengaja
          tidak dibuka.
        </p>
      </div>
    </main>
  );
}
