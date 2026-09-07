import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isStaff, createServerSupabase } from '@/lib/supabase/server';
import { PageShell } from '@/components/PageShell';
import { MasterUnitTable, type Unit } from '@/components/MasterUnitTable';
import { UnitFilter } from '@/components/UnitFilter';

export const dynamic = 'force-dynamic';

// 50 baris per halaman. PRD §10 mewajibkan tabel ini paginated — dengan 517
// unit sekarang dan 1000+ yang diantisipasi, memuat semuanya sekaligus akan
// membuat halaman berat dan boros kuota.
const PER_HAL = 50;

export default async function MasterUnitPage({
  searchParams,
}: {
  searchParams: { q?: string; cabang?: string; project?: string; hal?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Management boleh melihat (view only), jadi tidak ada redirect di sini —
  // yang dibatasi hanya kemampuan menyuntingnya (PRD §4).

  const supabase = createServerSupabase();
  const hal = Math.max(1, Number(searchParams.hal ?? 1) || 1);
  const dari = (hal - 1) * PER_HAL;

  let query = supabase
    .from('master_vehicles')
    .select('vhcid, no_plat, no_rangka, cabang, group_project, vendor, jenis_gps, fitur, updated_at',
            { count: 'exact' });

  const q = searchParams.q?.trim();
  if (q) {
    // Pencarian lintas tiga kolom identitas. Di-escape seadanya: koma dan
    // tanda kurung punya arti khusus di sintaks filter PostgREST.
    const aman = q.replace(/[,()]/g, ' ');
    query = query.or(`vhcid.ilike.%${aman}%,no_plat.ilike.%${aman}%,no_rangka.ilike.%${aman}%`);
  }
  if (searchParams.cabang) query = query.eq('cabang', searchParams.cabang);
  if (searchParams.project) query = query.eq('group_project', searchParams.project);

  const { data, count, error } = await query
    .order('vhcid')
    .range(dari, dari + PER_HAL - 1);

  // Daftar pilihan filter diambil dari data sungguhan, bukan dari daftar tetap
  // di kode — supaya cabang atau project baru muncul sendiri setelah import.
  const { data: semua } = await supabase
    .from('master_vehicles')
    .select('cabang, group_project')
    .limit(2000);

  const cabangList = [...new Set((semua ?? []).map((r) => r.cabang).filter(Boolean))].sort() as string[];
  const projectList = [...new Set((semua ?? []).map((r) => r.group_project).filter(Boolean))].sort() as string[];

  const total = count ?? 0;
  const totalHal = Math.max(1, Math.ceil(total / PER_HAL));

  return (
    <PageShell
      title="Master Data VHCID"
      subtitle={`${total.toLocaleString('id-ID')} unit${
        searchParams.q || searchParams.cabang || searchParams.project ? ' (terfilter)' : ''
      }`}
      name={user.fullName}
      role={user.role}
      active="/master-unit"
    >
      <div className="mb-6 rounded-card bg-surface-elevated p-5">
        <p className="max-w-3xl text-sm text-content-secondary">
          Data ini yang memperkaya setiap alert dengan cabang dan project.
          Unit yang tidak terdaftar di sini tetap menghasilkan alert — operasional
          tidak dihambat oleh kelengkapan master data (PRD §7.3) — tapi alertnya
          muncul tanpa cabang, sehingga tidak terlihat oleh Management yang
          dibatasi <span className="font-mono">cabang_scope</span>.
        </p>
        {!isStaff(user.role) && (
          <p className="mt-3 text-sm text-severity-warning">
            Anda masuk sebagai Management — halaman ini hanya bisa dilihat, tidak bisa diubah.
          </p>
        )}
        <p className="mt-3 text-sm text-content-secondary">
          Import massal dari Excel dijalankan lewat{' '}
          <code className="font-mono">npm run import:vehicles</code>, yang
          menampilkan pratinjau lebih dulu sebelum menulis apa pun.
        </p>
      </div>

      <UnitFilter cabangList={cabangList} projectList={projectList} />

      {error ? (
        <p className="rounded-card bg-severity-critical p-4 text-white">
          Gagal memuat: {error.message}
        </p>
      ) : (
        <>
          <MasterUnitTable
            rows={(data ?? []) as Unit[]}
            canEdit={isStaff(user.role)}
            userId={user.id}
          />

          <nav className="mt-4 flex items-center justify-between text-sm">
            <p className="text-content-secondary">
              Menampilkan {total === 0 ? 0 : dari + 1}–{Math.min(dari + PER_HAL, total)} dari{' '}
              {total.toLocaleString('id-ID')} unit
            </p>
            <div className="flex items-center gap-2">
              <HalLink params={searchParams} hal={hal - 1} disabled={hal <= 1}>
                Sebelumnya
              </HalLink>
              <span className="px-2 font-mono text-content-secondary">
                {hal} / {totalHal}
              </span>
              <HalLink params={searchParams} hal={hal + 1} disabled={hal >= totalHal}>
                Berikutnya
              </HalLink>
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
  params: Record<string, string | undefined>;
  hal: number;
  disabled: boolean;
  children: React.ReactNode;
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
      href={`/master-unit?${sp.toString()}`}
      className="rounded-btn border border-line px-3 py-1.5 text-content-secondary transition-colors hover:border-brand hover:text-content-primary"
    >
      {children}
    </Link>
  );
}
