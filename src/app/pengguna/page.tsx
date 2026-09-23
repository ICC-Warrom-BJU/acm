import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { PageShell } from '@/components/PageShell';
import { PenggunaTable, type Pengguna } from '@/components/PenggunaTable';

export const dynamic = 'force-dynamic';

/**
 * Manajemen pengguna — hanya Super Admin (PRD §4).
 *
 * Daftar diambil lewat route API, bukan langsung dari database, karena email
 * dan waktu login terakhir ada di `auth.users` yang tidak terjangkau PostgREST.
 */
export default async function PenggunaPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Lapis pertama. Route API dan fungsi list_users() memeriksanya lagi.
  if (user.role !== 'super_admin') redirect('/');

  const h = headers();
  const asal = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;

  const res = await fetch(`${asal}/api/users`, {
    headers: { cookie: h.get('cookie') ?? '' },
    cache: 'no-store',
  });
  const j = await res.json().catch(() => ({}));

  const supabase = createServerSupabase();
  const { data: unit } = await supabase
    .from('master_vehicles')
    .select('cabang')
    .not('cabang', 'is', null)
    .limit(2000);
  const cabangList = [...new Set((unit ?? []).map((u: any) => u.cabang))].sort() as string[];

  return (
    <PageShell
      title="Manajemen Pengguna"
      subtitle={`${j.users?.length ?? 0} akun`}
      name={user.fullName}
      role={user.role}
    >
      <div className="mb-6 rounded-card bg-surface-elevated p-5">
        <p className="max-w-3xl text-sm text-content-secondary">
          Halaman ini hanya bisa dibuka Super Admin. Pendaftaran mandiri sengaja
          tidak dibuka — setiap akun dibuat di sini, supaya kenaikan hak akses
          selalu merupakan tindakan sadar seseorang.
        </p>
        <p className="mt-3 max-w-3xl text-sm text-content-secondary">
          <strong>Batasan cabang</strong> berlaku untuk Staff IT dan Management:
          akun yang dibatasi hanya melihat alert, unit, dan laporan dari cabang
          terpilih. Super Admin tidak pernah dibatasi. Alert dari unit yang belum
          terdaftar di master data selalu terlihat oleh semua orang, karena
          cabangnya belum diketahui dan justru itu yang perlu ketahuan.
        </p>
        <p className="mt-3 max-w-3xl text-sm text-content-secondary">
          Untuk mencabut akses sementara gunakan <strong>Nonaktifkan</strong>,
          bukan Hapus — riwayat penanganan alert tetap tercatat atas nama orang
          itu dan akunnya bisa dihidupkan lagi.
        </p>
      </div>

      {!res.ok ? (
        <p role="alert" className="rounded-card bg-severity-critical p-4 text-white">
          Gagal memuat daftar pengguna: {j.error ?? res.statusText}
          <span className="mt-2 block text-sm">
            Kalau fungsi <code className="font-mono">list_users()</code> belum ada, jalankan
            migrasi <code className="font-mono">supabase/migrations/0011_user_management.sql</code>.
          </span>
        </p>
      ) : (
        <PenggunaTable
          rows={(j.users ?? []) as Pengguna[]}
          cabangList={cabangList}
          saya={user.id}
        />
      )}
    </PageShell>
  );
}
