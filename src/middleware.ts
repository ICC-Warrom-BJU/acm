import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Menyegarkan sesi Supabase dan menjaga rute yang butuh login.
 *
 * Penyegaran sesi harus terjadi di middleware, bukan di halaman: Server
 * Component tidak boleh menulis cookie, jadi token yang kedaluwarsa tidak akan
 * pernah diperbarui dari sana. Untuk wall display yang menyala berhari-hari,
 * ini bukan detail kecil — tanpa penyegaran, sesi mati dan feed ikut diam.
 */

const PUBLIC_PATHS = ['/login', '/auth'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(list: { name: string; value: string; options: CookieOptions }[]) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Memanggil getUser() di sini punya efek samping yang justru diinginkan:
  // ia menyegarkan token yang hampir kedaluwarsa dan menuliskannya kembali
  // ke cookie lewat setAll di atas.
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Simpan tujuan semula supaya setelah login pengguna kembali ke halaman
    // yang tadi dituju, bukan selalu terlempar ke dashboard.
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
      Semua rute KECUALI aset statis dan endpoint internal.

      `api/internal` sengaja dikecualikan: ia dipanggil pg_cron dengan rahasia
      bersama, bukan dengan sesi pengguna. Kalau ikut dijaga middleware, seluruh
      polling akan dialihkan ke halaman login dan berhenti bekerja.
    */
    '/((?!_next/static|_next/image|favicon.ico|api/internal|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
