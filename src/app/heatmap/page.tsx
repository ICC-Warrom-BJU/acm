import dynamicImport from 'next/dynamic';
import { redirect } from 'next/navigation';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { PageShell } from '@/components/PageShell';
import { AlertFilter } from '@/components/AlertFilter';
import { BUSINESS_TIMEZONE } from '@/lib/time';
import type { Titik } from '@/components/HeatmapView';

export const dynamic = 'force-dynamic';

// ssr:false wajib — Leaflet menyentuh `window` saat modulnya dimuat.
const HeatmapView = dynamicImport(
  () => import('@/components/HeatmapView').then((m) => m.HeatmapView),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[70vh] items-center justify-center rounded-card bg-surface-elevated">
        <p className="text-content-secondary">Memuat peta…</p>
      </div>
    ),
  },
);

const MAKS_TITIK = 10_000;

function mundur(hari: number) {
  return new Date(Date.now() - hari * 86_400_000)
    .toLocaleDateString('en-CA', { timeZone: BUSINESS_TIMEZONE });
}

export default async function HeatmapPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const from = searchParams.from || mundur(6);
  const to = searchParams.to || new Date().toLocaleDateString('en-CA', { timeZone: BUSINESS_TIMEZONE });

  const supabase = createServerSupabase();

  let q = supabase
    .from('alerts')
    .select('lat, long, occurrence_count, severity')
    .not('lat', 'is', null)
    .not('long', 'is', null)
    .gte('occurrence_date', from)
    .lte('occurrence_date', to);

  if (searchParams.cabang) q = q.eq('cabang', searchParams.cabang);
  if (searchParams.alert_type) q = q.eq('alert_type', searchParams.alert_type);
  if (searchParams.severity) q = q.eq('severity', searchParams.severity);

  const { data, error } = await q.limit(MAKS_TITIK);

  // Bobot dinaikkan untuk kejadian kritis dan berulang, supaya titik panas
  // mencerminkan tingkat kegawatan — bukan sekadar berapa kali GPS mengirim
  // koordinat di lokasi itu.
  const titik: Titik[] = (data ?? []).map((r: any) => ({
    lat: Number(r.lat),
    long: Number(r.long),
    bobot: Math.min(
      (r.occurrence_count ?? 1) * (r.severity === 'critical' ? 3 : r.severity === 'warning' ? 2 : 1),
      30,
    ),
  }));

  const [{ data: cabangRows }, { data: typeRows }] = await Promise.all([
    supabase.from('alerts').select('cabang').not('cabang', 'is', null).limit(2000),
    supabase.from('alerts').select('alert_type').limit(2000),
  ]);

  const cabangList = [...new Set((cabangRows ?? []).map((r: any) => r.cabang))].sort() as string[];
  const typeList = [...new Set((typeRows ?? []).map((r: any) => r.alert_type))].sort() as string[];

  return (
    <PageShell
      title="Heatmap Pelanggaran"
      subtitle={`${titik.length.toLocaleString('id-ID')} titik · ${from} sampai ${to}`}
      name={user.fullName}
      role={user.role}
      active="/heatmap"
    >
      <AlertFilter
        cabangList={cabangList}
        typeList={typeList}
        basePath="/heatmap"
        showStatus={false}
      />

      {error ? (
        <p className="rounded-card bg-severity-critical p-4 text-white">
          Gagal memuat: {error.message}
        </p>
      ) : (
        <>
          <HeatmapView titik={titik} />

          <div className="mt-4 flex flex-wrap items-center gap-6 rounded-card bg-surface-elevated p-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-content-secondary">Kepadatan:</span>
              <span className="h-3 w-24 rounded-full"
                style={{ background: 'linear-gradient(90deg,#1D9E75,#EF9F27,#E24B4A)' }} />
              <span className="text-content-secondary">rendah → tinggi</span>
            </div>
            <p className="text-content-secondary">
              Bobot titik memperhitungkan severity dan jumlah kejadian berulang,
              bukan sekadar banyaknya baris.
            </p>
            {titik.length >= MAKS_TITIK && (
              <p className="text-severity-warning">
                Dibatasi {MAKS_TITIK.toLocaleString('id-ID')} titik — persempit rentang tanggalnya.
              </p>
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}
