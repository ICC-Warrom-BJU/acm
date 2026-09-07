import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isStaff, createServerSupabase } from '@/lib/supabase/server';
import { PageShell } from '@/components/PageShell';
import { AntrianTable, type AlertRow } from '@/components/AntrianTable';
import { AlertFilter } from '@/components/AlertFilter';

export const dynamic = 'force-dynamic';

const PER_HAL = 50;

export default async function AntrianPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = createServerSupabase();
  const hal = Math.max(1, Number(searchParams.hal ?? 1) || 1);
  const dari = (hal - 1) * PER_HAL;

  const kolom =
    'id, vhcid, no_plat, alert_type, severity, cabang, group_project, status, occurrence_count, first_seen_at, last_seen_at, acknowledged_by_name, closed_by_name, close_note';

  let q = supabase.from('alerts').select(kolom, { count: 'exact' });

  // Default menyembunyikan yang sudah tertutup — antrian adalah daftar kerja,
  // bukan arsip. Yang tertutup tetap bisa dilihat dengan memilih statusnya.
  if (searchParams.status) q = q.eq('status', searchParams.status);
  else q = q.neq('status', 'closed');

  if (searchParams.cabang) q = q.eq('cabang', searchParams.cabang);
  if (searchParams.alert_type) q = q.eq('alert_type', searchParams.alert_type);
  if (searchParams.severity) q = q.eq('severity', searchParams.severity);
  if (searchParams.vhcid) q = q.eq('vhcid', searchParams.vhcid);
  if (searchParams.from) q = q.gte('occurrence_date', searchParams.from);
  if (searchParams.to) q = q.lte('occurrence_date', searchParams.to);

  const { data, count, error } = await q
    .order('last_seen_at', { ascending: false })
    .range(dari, dari + PER_HAL - 1);

  // Pilihan filter diambil dari data yang benar-benar ada, bukan daftar tetap.
  const [{ data: cabangRows }, { data: typeRows }] = await Promise.all([
    supabase.from('alerts').select('cabang').not('cabang', 'is', null).limit(2000),
    supabase.from('alerts').select('alert_type').limit(2000),
  ]);

  const cabangList = [...new Set((cabangRows ?? []).map((r: any) => r.cabang))].sort() as string[];
  const typeList = [...new Set((typeRows ?? []).map((r: any) => r.alert_type))].sort() as string[];

  const total = count ?? 0;
  const totalHal = Math.max(1, Math.ceil(total / PER_HAL));

  // Filter yang diteruskan ke "tutup semua sesuai filter" harus SAMA PERSIS
  // dengan yang membentuk daftar di layar. Kalau berbeda, operator akan
  // menutup baris yang tidak pernah ia lihat.
  const filterAktif = {
    status: searchParams.status,
    cabang: searchParams.cabang,
    alert_type: searchParams.alert_type,
    severity: searchParams.severity,
    vhcid: searchParams.vhcid,
    from: searchParams.from,
    to: searchParams.to,
  };

  return (
    <PageShell
      title="Antrian Alert"
      subtitle={`${total.toLocaleString('id-ID')} alert${searchParams.status ? '' : ' belum tertutup'}`}
      name={user.fullName}
      role={user.role}
      active="/antrian"
    >
      <AlertFilter cabangList={cabangList} typeList={typeList} />

      {!isStaff(user.role) && (
        <p className="mb-4 rounded-card bg-surface-elevated p-4 text-sm text-severity-warning">
          Anda masuk sebagai Management — alert hanya bisa dilihat, tidak bisa ditutup (PRD §4).
        </p>
      )}

      {error ? (
        <p className="rounded-card bg-severity-critical p-4 text-white">
          Gagal memuat: {error.message}
        </p>
      ) : (
        <>
          <AntrianTable
            rows={(data ?? []) as unknown as AlertRow[]}
            total={total}
            filter={filterAktif}
            canClose={isStaff(user.role)}
          />

          <nav className="mt-4 flex items-center justify-between text-sm">
            <p className="text-content-secondary">
              Menampilkan {total === 0 ? 0 : dari + 1}–{Math.min(dari + PER_HAL, total)} dari{' '}
              {total.toLocaleString('id-ID')}
            </p>
            <div className="flex items-center gap-2">
              <HalLink params={searchParams} hal={hal - 1} disabled={hal <= 1}>Sebelumnya</HalLink>
              <span className="px-2 font-mono text-content-secondary">{hal} / {totalHal}</span>
              <HalLink params={searchParams} hal={hal + 1} disabled={hal >= totalHal}>Berikutnya</HalLink>
            </div>
          </nav>
        </>
      )}
    </PageShell>
  );
}

function HalLink({
  params, hal, disabled, children,
}: {
  params: Record<string, string | undefined>; hal: number; disabled: boolean; children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="rounded-btn border border-line px-3 py-1.5 text-content-secondary opacity-40">
        {children}
      </span>
    );
  }
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== 'hal') sp.set(k, v);
  sp.set('hal', String(hal));
  return (
    <Link
      href={`/antrian?${sp.toString()}`}
      className="rounded-btn border border-line px-3 py-1.5 text-content-secondary transition-colors hover:border-brand hover:text-content-primary"
    >
      {children}
    </Link>
  );
}
