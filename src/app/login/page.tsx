import { Suspense } from 'react';
import { LoginForm } from '@/components/LoginForm';

/**
 * Pembungkus Suspense diperlukan karena form membaca `?next=` lewat
 * useSearchParams(). Tanpa batas Suspense, Next.js menolak melakukan
 * prerender halaman ini saat build.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-surface-base">
          <p className="text-content-secondary">Memuat…</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
