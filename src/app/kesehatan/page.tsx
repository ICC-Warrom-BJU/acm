import { redirect } from 'next/navigation';
import { getCurrentUser, isStaff, createServerSupabase } from '@/lib/supabase/server';
import { PageShell } from '@/components/PageShell';
import { formatClock, BUSINESS_TZ_LABEL } from '@/lib/time';

export const dynamic = 'force-dynamic';

interface Health {
  id: string;
  name: string;
  alert_type: string;
  is_active: boolean;
  polling_interval_seconds: number;
  last_success_at: string | null;
  seconds_since_success: number | null;
  staleness_limit_seconds: number;
  consecutive_failures: number;
  last_error: string | null;
  status: string;
  alasan: string;
}

const TONE: Record<string, { dot: string; text: string; label: string }> = {
  sehat: { dot: 'bg-severity-info', text: 'text-severity-info', label: 'Sehat' },
  basi: { dot: 'bg-severity-critical', text: 'text-severity-critical', label: 'Basi' },
  gagal: { dot: 'bg-severity-critical', text: 'text-severity-critical', label: 'Gagal' },
  'belum pernah': { dot: 'bg-severity-warning', text: 'text-severity-warning', label: 'Belum pernah' },
  nonaktif: { dot: 'bg-severity-unknown', text: 'text-severity-unknown', label: 'Nonaktif' },
};

function durasi(d: number | null) {
  if (d == null) return '—';
  if (d < 60) return `${d} detik`;
  if (d < 3600) return `${Math.floor(d / 60)} menit`;
  if (d < 86400) return `${Math.floor(d / 3600)} jam`;
  return `${Math.floor(d / 86400)} hari`;
}

export default async function KesehatanPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Management tidak punya akses ke modul ini (PRD §4). Ditegakkan di sini
  // sebagai lapis pertama; fungsi database menolaknya lagi sebagai lapis kedua.
  if (!isStaff(user.role)) redirect('/');

  const supabase = createServerSupabase();

  const [{ data: health, error: hErr }, { data: transport }, { data: logs }] = await Promise.all([
    supabase.rpc('source_health'),
    supabase.rpc('transport_failures', { p_minutes: 180 }),
    supabase
      .from('polling_logs')
      .select('source_id, executed_at, success, response_code, duration_ms, records_fetched, records_new, error_message')
      .order('executed_at', { ascending: false })
      .limit(25),
  ]);

  const rows = (health ?? []) as Health[];
  const namaSumber = Object.fromEntries(rows.map((r) => [r.id, r.name]));
  const bermasalah = rows.filter((r) => ['basi', 'gagal', 'belum pernah'].includes(r.status));

  return (
    <PageShell
      title="Kesehatan API"
      subtitle="Status polling tiap sumber alert"
      name={user.fullName}
      role={user.role}
      active="/kesehatan"
    >
      {hErr && (
        <div className="mb-6 rounded-card bg-severity-critical p-4 text-white">
          <p className="font-medium">Fungsi kesehatan belum tersedia</p>
          <p className="mt-1 text-sm">
            Jalankan migrasi <code>supabase/migrations/0008_health.sql</code> di SQL Editor
            Supabase. ({hErr.message})
          </p>
        </div>
      )}

      {bermasalah.length > 0 && (
        <div className="mb-6 rounded-card border-l-4 border-l-severity-critical bg-surface-elevated p-4">
          <p className="font-medium text-severity-critical">
            {bermasalah.length} sumber perlu perhatian
          </p>
          <p className="mt-1 text-sm text-content-secondary">
            {bermasalah.map((r) => r.name).join(', ')}
          </p>
        </div>
      )}

      {/* Kartu per sumber (PRD §9) — latar solid, bukan glass, karena ini
          status yang harus terbaca instan (UIUX §4). */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const tone = TONE[r.status] ?? TONE.nonaktif;
          return (
            <article key={r.id} className="rounded-card bg-surface-elevated p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-medium">{r.name}</h2>
                  <p className="font-mono text-xs text-content-secondary">{r.alert_type}</p>
                </div>
                <span className={`flex shrink-0 items-center gap-2 text-sm font-medium ${tone.text}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
                  {tone.label}
                </span>
              </div>

              <p className="mt-3 text-sm text-content-secondary">{r.alasan}</p>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Baris label="Interval" value={`${r.polling_interval_seconds} detik`} />
                <Baris label="Ambang basi" value={`${r.staleness_limit_seconds} detik`} />
                <Baris
                  label="Sukses terakhir"
                  value={
                    r.last_success_at
                      ? `${formatClock(r.last_success_at)} ${BUSINESS_TZ_LABEL}`
                      : 'belum pernah'
                  }
                />
                <Baris label="Selang" value={durasi(r.seconds_since_success)} />
              </dl>
            </article>
          );
        })}
      </div>

      {/* Kegagalan transport: satu-satunya jejak saat permintaan tidak pernah
          sampai ke aplikasi (galat TLS, DNS, Deployment Protection menyala). */}
      <section className="mt-8">
        <h2 className="mb-1 text-xl font-medium">Kegagalan Transport (pg_net)</h2>
        <p className="mb-4 text-sm text-content-secondary">
          3 jam terakhir. Kegagalan di sini terjadi <em>sebelum</em> aplikasi berjalan,
          sehingga tidak akan pernah muncul di log polling di bawah.
        </p>

        <div className="overflow-x-auto rounded-card bg-surface-elevated">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-content-secondary">
              <tr>
                <Th>Waktu</Th><Th>Status</Th><Th>Galat</Th><Th>Isi</Th>
              </tr>
            </thead>
            <tbody>
              {(transport ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-content-secondary">
                    Tidak ada kegagalan transport. Semua panggilan pg_net sampai ke aplikasi.
                  </td>
                </tr>
              ) : (
                (transport as any[]).map((t) => (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <Td mono>{formatClock(t.created)}</Td>
                    <Td>
                      <span className={t.status_code === 200 ? '' : 'text-severity-critical'}>
                        {t.status_code ?? 'gagal'}
                      </span>
                    </Td>
                    <Td>{t.error_msg ?? '—'}</Td>
                    <Td>
                      <span className="line-clamp-1 text-content-secondary">{t.content ?? '—'}</span>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-4 text-xl font-medium">Log Polling Terakhir</h2>
        <div className="overflow-x-auto rounded-card bg-surface-elevated">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-content-secondary">
              <tr>
                <Th>Waktu</Th><Th>Sumber</Th><Th>Hasil</Th><Th>Durasi</Th>
                <Th>Diambil</Th><Th>Baru</Th><Th>Galat</Th>
              </tr>
            </thead>
            <tbody>
              {(logs ?? []).map((l: any, i: number) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <Td mono>{formatClock(l.executed_at)}</Td>
                  <Td>{namaSumber[l.source_id] ?? '—'}</Td>
                  <Td>
                    <span className={l.success ? 'text-severity-info' : 'text-severity-critical'}>
                      {l.success ? 'sukses' : 'gagal'}
                    </span>
                  </Td>
                  <Td mono>{l.duration_ms} ms</Td>
                  <Td mono>{l.records_fetched}</Td>
                  <Td mono>{l.records_new}</Td>
                  <Td>
                    <span className="line-clamp-1">{l.error_message ?? '—'}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </PageShell>
  );
}

function Baris({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-content-secondary">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 font-medium">{children}</th>;
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-4 py-2.5 ${mono ? 'font-mono' : ''}`}>{children}</td>;
}
