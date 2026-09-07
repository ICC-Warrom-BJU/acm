import { redirect } from 'next/navigation';
import { getCurrentUser, isStaff } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { maskToken } from '@/lib/crypto';
import { PageShell } from '@/components/PageShell';
import { SumberTable, type Sumber } from '@/components/SumberTable';

export const dynamic = 'force-dynamic';

export default async function SumberPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!isStaff(user.role)) redirect('/');

  /*
    Klien service-role dipakai di sini SETELAH role diperiksa di atas, karena
    hanya server yang bisa mendekripsi token untuk membuat bentuk masked-nya.
    Yang dikirim ke klien hanyalah 4 digit terakhir — token utuh tidak pernah
    meninggalkan server (PRD §10).
  */
  const { data, error } = await createAdminClient()
    .from('alert_sources')
    .select('*')
    .is('deleted_at', null)
    .order('name');

  const rows: Sumber[] = (data ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    alert_type: s.alert_type,
    endpoint_url: s.endpoint_url,
    method: s.method,
    auth_type: s.auth_type,
    auth_header_name: s.auth_header_name,
    polling_interval_seconds: s.polling_interval_seconds,
    time_window_lookback_seconds: s.time_window_lookback_seconds,
    time_window_offset_hours: s.time_window_offset_hours,
    discriminator_path: s.discriminator_path,
    data_path: s.data_path,
    is_active: s.is_active,
    field_mapping: s.field_mapping ?? {},
    token_masked: maskToken(s.token_encrypted),
  }));

  return (
    <PageShell
      title="Sumber API Alert"
      subtitle="Konfigurasi endpoint, token, dan interval polling"
      name={user.fullName}
      role={user.role}
      active="/sumber"
    >
      <div className="mb-6 rounded-card bg-surface-elevated p-5">
        <p className="max-w-3xl text-sm text-content-secondary">
          Perubahan interval atau status aktif langsung menjadwal ulang{' '}
          <code className="font-mono">pg_cron</code> lewat trigger database —
          tidak ada langkah manual dan tidak perlu deploy ulang. Token disimpan
          terenkripsi dan tidak pernah ditampilkan utuh; mengosongkan kolom token
          saat menyimpan berarti mempertahankan yang lama.
        </p>
      </div>

      {error ? (
        <p className="rounded-card bg-severity-critical p-4 text-white">
          Gagal memuat: {error.message}
        </p>
      ) : (
        <SumberTable rows={rows} />
      )}
    </PageShell>
  );
}
