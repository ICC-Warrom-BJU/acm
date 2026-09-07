import { redirect } from 'next/navigation';
import { getCurrentUser, isStaff, createServerSupabase } from '@/lib/supabase/server';
import { PageShell } from '@/components/PageShell';
import { JenisAlertTable, type JenisAlert } from '@/components/JenisAlertTable';

export const dynamic = 'force-dynamic';

export default async function JenisAlertPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!isStaff(user.role)) redirect('/');

  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from('alert_type_master')
    .select('id, notif_value, alert_type, label, severity, is_active, auto_discovered, seen_count, last_seen_at, notes, sample_payload, source_id')
    .order('is_active', { ascending: false })
    .order('seen_count', { ascending: false });

  const { data: sources } = await supabase.from('alert_sources').select('id, name');
  const nama = Object.fromEntries((sources ?? []).map((s) => [s.id, s.name]));

  return (
    <PageShell
      title="Master Jenis Alert"
      subtitle="Pemetaan nilai notifikasi dari API ke jenis alert ACM"
      name={user.fullName}
      role={user.role}
      active="/jenis-alert"
    >
      <div className="mb-6 rounded-card bg-surface-elevated p-5">
        <h2 className="font-medium">Cara kerjanya</h2>
        <p className="mt-2 max-w-3xl text-sm text-content-secondary">
          Satu endpoint API bisa mengirim banyak jenis kejadian sekaligus. Poller
          memisahkannya berdasarkan tabel ini — bukan berdasarkan kode program.
          Setiap nilai baru yang muncul di response otomatis tercatat di sini
          dalam keadaan <strong>nonaktif dan belum dipetakan</strong>, lengkap
          dengan contoh payloadnya.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-content-secondary">
          Artinya kalau TMS EASYGO kelak mengirim jenis <em>fatigue driving</em>,
          ia akan muncul sendiri di daftar ini. Cukup isi kode alertnya lalu
          aktifkan — tanpa perubahan kode dan tanpa deploy ulang.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-content-secondary">
          Polling tidak pernah menimpa isian manusia. Ia hanya memperbarui
          hitungan kemunculan.
        </p>
      </div>

      {error ? (
        <p className="rounded-card bg-severity-critical p-4 text-white">
          Gagal memuat: {error.message}
        </p>
      ) : (
        <>
          {sources && sources.length > 1 && (
            <p className="mb-3 text-sm text-content-secondary">
              Sumber: {Object.values(nama).join(', ')}
            </p>
          )}
          <JenisAlertTable rows={(data ?? []) as JenisAlert[]} />
        </>
      )}
    </PageShell>
  );
}
