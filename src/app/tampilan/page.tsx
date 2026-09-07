import { redirect } from 'next/navigation';
import { getCurrentUser, isStaff, createServerSupabase } from '@/lib/supabase/server';
import { PageShell } from '@/components/PageShell';
import { TampilanMatrix } from '@/components/TampilanMatrix';
import type { KonfigCabang } from '@/lib/visibility';

export const dynamic = 'force-dynamic';

export default async function TampilanPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!isStaff(user.role)) redirect('/');

  const supabase = createServerSupabase();

  const [{ data: unit }, { data: jenisRows }, { data: konfig, error }] = await Promise.all([
    // Cabang diambil dari master data, bukan dari alert yang kebetulan sudah
    // masuk — supaya cabang yang belum pernah punya alert tetap bisa diatur
    // sebelum alertnya muncul.
    supabase.from('master_vehicles').select('cabang').not('cabang', 'is', null).limit(2000),
    supabase.from('alert_type_master').select('alert_type').eq('is_active', true).not('alert_type', 'is', null),
    supabase.from('branch_alert_config').select('cabang, alert_types'),
  ]);

  const cabangList = [...new Set((unit ?? []).map((u: any) => u.cabang))].sort() as string[];

  // Jenis alert dikumpulkan dari master data DAN dari sumber yang berdiri
  // sendiri (speed_flag tidak punya baris master karena bukan dari endpoint
  // berbagi), supaya tidak ada jenis yang luput dari matriks.
  const { data: sumber } = await supabase
    .from('alert_sources')
    .select('alert_type, discriminator_path')
    .is('deleted_at', null);

  const jenisList = [
    ...new Set([
      ...(jenisRows ?? []).map((j: any) => j.alert_type as string),
      ...(sumber ?? [])
        .filter((s: any) => !s.discriminator_path)
        .map((s: any) => s.alert_type as string),
    ]),
  ].sort();

  return (
    <PageShell
      title="Konfigurasi Tampilan"
      subtitle="Jenis alert yang tampil di dashboard, per cabang"
      name={user.fullName}
      role={user.role}
    >
      <div className="mb-6 rounded-card bg-surface-elevated p-5">
        <p className="max-w-3xl text-sm text-content-secondary">
          Centang jenis alert yang perlu tampil di dashboard untuk tiap cabang.
          Contoh: kalau MKS1 dan JKT1 hanya perlu memantau Speed Flag, biarkan
          Speed Flag tercentang dan hilangkan centang jenis lainnya pada kedua
          baris itu.
        </p>
        <p className="mt-3 max-w-3xl text-sm text-content-secondary">
          <strong>Ini hanya menyaring tampilan.</strong> Alert yang tidak
          dicentang tetap dipolling, tetap tersimpan, tetap masuk Antrian,
          Ringkasan, Heatmap, dan hasil ekspor. Yang berubah hanya apa yang
          muncul di dashboard. Perbedaan ini disengaja — menyaring saat polling
          akan membuang data secara permanen, sedangkan menyaring di tampilan
          bisa dibatalkan kapan saja.
        </p>
        <p className="mt-3 max-w-3xl text-sm text-content-secondary">
          Cabang yang belum pernah diatur menampilkan semua jenis. Alert dari
          unit yang belum terdaftar di master data selalu tampil, karena
          cabangnya belum diketahui dan justru itu yang perlu ketahuan.
        </p>
      </div>

      {error ? (
        <p className="rounded-card bg-severity-critical p-4 text-white">
          Gagal memuat: {error.message}
          <span className="mt-2 block text-sm">
            Kalau tabelnya belum ada, jalankan migrasi{' '}
            <code className="font-mono">supabase/migrations/0009_branch_visibility.sql</code>.
          </span>
        </p>
      ) : cabangList.length === 0 || jenisList.length === 0 ? (
        <p className="rounded-card bg-surface-elevated p-6 text-content-secondary">
          Belum ada cabang atau jenis alert yang bisa dikonfigurasi.
        </p>
      ) : (
        <TampilanMatrix
          cabangList={cabangList}
          jenisList={jenisList}
          konfigAwal={(konfig ?? []) as KonfigCabang[]}
        />
      )}
    </PageShell>
  );
}
