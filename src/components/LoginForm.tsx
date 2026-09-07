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
  const [lihatSandi, setLihatSandi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      /*
        Pesan galat menyebutkan sebab DAN langkah pemulihan (UX §8
        error-clarity, error-recovery). "Invalid login credentials" dari Supabase
        tidak memberi tahu apa pun tentang apa yang harus dilakukan berikutnya.

        Sengaja tidak membedakan "email tidak terdaftar" dari "sandi salah":
        membedakannya memberi tahu penyerang alamat mana yang punya akun.
      */
      setError(
        /invalid login/i.test(error.message)
          ? 'Email atau kata sandi salah. Periksa kembali, atau hubungi Super Admin bila lupa kata sandi.'
          : `Gagal masuk: ${error.message}`,
      );
      setBusy(false);
      // Kembalikan fokus ke field pertama supaya pengguna keyboard bisa langsung
      // mengoreksi tanpa menavigasi ulang (UX §8 focus-management).
      document.getElementById('email')?.focus();
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

        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm text-content-secondary">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="username"
              autoFocus
              inputMode="email"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'login-error' : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm text-content-secondary">
              Kata sandi
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={lihatSandi ? 'text' : 'password'}
                required
                autoComplete="current-password"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'login-error' : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field pr-20"
              />
              {/* Tombol lihat/sembunyikan sandi (UX §8 password-toggle).
                  Penting untuk kata sandi acak panjang seperti yang dibuat
                  skrip pembuatan akun — mengetiknya buta hampir pasti salah. */}
              <button
                type="button"
                onClick={() => setLihatSandi((v) => !v)}
                aria-pressed={lihatSandi}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-btn px-2.5 py-1.5 text-xs text-content-secondary transition-colors hover:text-content-primary"
              >
                {lihatSandi ? 'Sembunyikan' : 'Lihat'}
              </button>
            </div>
          </div>

          {error && (
            /*
              role="alert" membuat pembaca layar mengumumkan galat begitu
              muncul. Tanpa itu, pengguna non-visual menekan "Masuk" lalu tidak
              mendapat kabar apa pun — form seolah tidak merespons.
              Latar solid, bukan glass: pesan galat harus terbaca instan.
            */
            <p
              id="login-error"
              role="alert"
              className="rounded-input bg-severity-critical px-3 py-2 text-sm text-white"
            >
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full px-4 py-3">
            {busy && (
              <span
                aria-hidden
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
            )}
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
