import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { PageShell } from '@/components/PageShell';
import { TrenHarian, PerJenis, PerCabang } from '@/components/SummaryCharts';
import { BUSINESS_TIMEZONE } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Summary Dashboard (PRD §9, untuk Management).
 *
 * Sumbernya `alert_daily_summary`, BUKAN tabel `alerts`. Ini disengaja: raw
 * hanya bertahan 90 hari (PRD §7.4) sedangkan agregasi harian permanen, jadi
 * laporan jangka panjang tetap utuh setelah pembersihan. Sekaligus menjaga
 * halaman ini tetap ringan — ia membaca ribuan baris agregat, bukan jutaan
 * baris kejadian.
 */

function tanggalBisnisHariIni() {
  return new Date().toLocaleDateString('en-CA', { timeZone: BUSINESS_TIMEZONE });
}

function mundur(hari: number) {
  const d = new Date(Date.now() - hari * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: BUSINESS_TIMEZONE });
}

const PERIODE: Record<string, { label: string; hari: number }> = {
  weekly: { label: 'Mingguan (7 hari)', hari: 7 },
  monthly: { label: 'Bulanan (30 hari)', hari: 30 },
  quarterly: { label: '90 hari', hari: 90 },
};

export default async function RingkasanPage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string; cabang?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const periodKey = searchParams.period && PERIODE[searchParams.period] ? searchParams.period : 'monthly';
  const from = searchParams.from || mundur(PERIODE[periodKey].hari - 1);
  const to = searchParams.to || tanggalBisnisHariIni();

  const supabase = createServerSupabase();

  let q = supabase
    .from('alert_daily_summary')
    .select('summary_date, vhcid, alert_type, cabang, group_project, occurrence_count, alert_count, critical_count, warning_count')
    .gte('summary_date', from)
    .lte('summary_date', to)
    .order('summary_date');

  if (searchParams.cabang) q = q.eq('cabang', searchParams.cabang);

  // Batas tinggi tapi tetap ada: tanpa batas, rentang panjang pada armada 1000+
  // unit bisa menarik ratusan ribu baris ke dalam memori fungsi serverless.
  const { data, error } = await q.limit(20000);
  const rows = data ?? [];

  // Agregasi dilakukan di sini, bukan lewat SQL GROUP BY, karena PostgREST
  // tidak menyediakannya. Untuk volume agregat harian ini biayanya kecil.
  const perHari = new Map<string, { kritis: number; peringatan: number; total: number }>();
  const perJenis = new Map<string, number>();
  const perCabang = new Map<string, number>();
  const perUnit = new Map<string, { vhcid: string; jumlah: number; cabang: string | null }>();

  let totalKejadian = 0;
  let totalKritis = 0;

  for (const r of rows) {
    totalKejadian += r.occurrence_count;
    totalKritis += r.critical_count;

    const h = perHari.get(r.summary_date) ?? { kritis: 0, peringatan: 0, total: 0 };
    h.total += r.occurrence_count;
    h.kritis += r.critical_count;
    h.peringatan += r.warning_count;
    perHari.set(r.summary_date, h);

    perJenis.set(r.alert_type, (perJenis.get(r.alert_type) ?? 0) + r.occurrence_count);
    if (r.cabang) perCabang.set(r.cabang, (perCabang.get(r.cabang) ?? 0) + r.occurrence_count);

    if (r.vhcid) {
      const u = perUnit.get(r.vhcid) ?? { vhcid: r.vhcid, jumlah: 0, cabang: r.cabang };
      u.jumlah += r.occurrence_count;
      perUnit.set(r.vhcid, u);
    }
  }

  const tren = [...perHari.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tanggal, v]) => ({ tanggal: tanggal.slice(5), ...v }));

  const jenisData = [...perJenis.entries()]
    .map(([nama, jumlah]) => ({ nama, jumlah }))
    .sort((a, b) => b.jumlah - a.jumlah)
    .slice(0, 10);

  const cabangData = [...perCabang.entries()]
    .map(([nama, jumlah]) => ({ nama, jumlah }))
    .sort((a, b) => b.jumlah - a.jumlah);

  const topUnit = [...perUnit.values()].sort((a, b) => b.jumlah - a.jumlah).slice(0, 15);

  const unitTerdampak = perUnit.size;
  const qs = new URLSearchParams({ from, to, format: 'xlsx' });
  if (searchParams.cabang) qs.set('cabang', searchParams.cabang);

  return (
    <PageShell
      title="Summary Dashboard"
      subtitle={`${from} sampai ${to}`}
      name={user.fullName}
      role={user.role}
      active="/ringkasan"
    >
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <nav className="flex gap-1">
          {Object.entries(PERIODE).map(([k, v]) => (
            <Link
              key={k}
              href={`/ringkasan?period=${k}${searchParams.cabang ? `&cabang=${searchParams.cabang}` : ''}`}
              className={`rounded-btn px-3 py-2 text-sm transition-colors ${
                periodKey === k && !searchParams.from
                  ? 'bg-brand-soft font-medium text-content-primary'
                  : 'text-content-secondary hover:bg-brand-soft'
              }`}
            >
              {v.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto">
          <a
            href={`/api/alerts/export?${qs.toString()}`}
            className="rounded-btn bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
          >
            Export Excel
          </a>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kartu label="Total kejadian" nilai={totalKejadian} />
        <Kartu label="Kejadian kritis" nilai={totalKritis} tone={totalKritis > 0 ? 'critical' : undefined} />
        <Kartu label="Unit terdampak" nilai={unitTerdampak} />
        <Kartu label="Hari tercakup" nilai={perHari.size} />
      </div>

      {error ? (
        <p className="rounded-card bg-severity-critical p-4 text-white">Gagal memuat: {error.message}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-card bg-surface-elevated p-8">
          <p className="font-medium">Belum ada data agregat untuk rentang ini.</p>
          <p className="mt-2 max-w-2xl text-sm text-content-secondary">
            Ringkasan harian dihitung oleh job <code className="font-mono">rollup_daily</code>{' '}
            yang berjalan tiap jam. Kalau sistem baru saja dipasang, tunggu satu
            siklus atau jalankan <code className="font-mono">select public.rollup_daily();</code>{' '}
            di SQL Editor.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <TrenHarian data={tren} />

          <div className="grid gap-6 lg:grid-cols-2">
            <PerJenis data={jenisData} />
            {cabangData.length > 0 && <PerCabang data={cabangData} />}
          </div>

          <section className="rounded-card bg-surface-elevated p-5">
            <h2 className="mb-1 text-lg font-medium">Unit dengan Kejadian Terbanyak</h2>
            <p className="mb-4 text-sm text-content-secondary">
              15 teratas pada rentang ini — kandidat pertama untuk pembinaan pengemudi.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-content-secondary">
                  <tr><Th>#</Th><Th>VHCID</Th><Th>Cabang</Th><Th>Kejadian</Th></tr>
                </thead>
                <tbody>
                  {topUnit.map((u, i) => (
                    <tr key={u.vhcid} className="border-b border-line last:border-0">
                      <Td mono>{i + 1}</Td>
                      <Td mono>{u.vhcid}</Td>
                      <Td>{u.cabang ?? '—'}</Td>
                      <Td mono>{u.jumlah.toLocaleString('id-ID')}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </PageShell>
  );
}

function Kartu({ label, nilai, tone }: { label: string; nilai: number; tone?: 'critical' }) {
  return (
    // Kartu statistik boleh glass — ini "furnitur", bukan teks kritikal
    // yang harus terbaca dari jarak jauh (UIUX §4).
    <div className="glass rounded-card p-5">
      <p className={`font-mono text-3xl font-medium ${tone === 'critical' ? 'text-severity-critical' : ''}`}>
        {nilai.toLocaleString('id-ID')}
      </p>
      <p className="mt-1 text-sm text-content-secondary">{label}</p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-medium">{children}</th>;
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-4 py-2 ${mono ? 'font-mono text-xs' : ''}`}>{children}</td>;
}
