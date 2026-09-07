'use client';

import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Filter antrian alert. Nilainya di query string supaya bisa di-bookmark, dan
 * supaya "tutup semua sesuai filter" mengacu ke penyaringan yang sama persis
 * dengan yang sedang dilihat operator.
 */
export function AlertFilter({
  cabangList,
  typeList,
  basePath = '/antrian',
  showStatus = true,
}: {
  cabangList: string[];
  typeList: string[];
  basePath?: string;
  showStatus?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function set(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('hal');
    router.push(`${basePath}?${next.toString()}`);
  }

  const g = (k: string) => params.get(k) ?? '';
  const adaFilter = ['status', 'cabang', 'alert_type', 'severity', 'from', 'to', 'vhcid']
    .some((k) => params.get(k));

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      {showStatus && (
        <Pilih label="Status" value={g('status')} onChange={(v) => set({ status: v })}
          options={[['', 'Semua kecuali tertutup'], ['active', 'Aktif'], ['acknowledged', 'Acknowledged'], ['closed', 'Tertutup']]} />
      )}

      <Pilih label="Severity" value={g('severity')} onChange={(v) => set({ severity: v })}
        options={[['', 'Semua'], ['critical', 'Kritis'], ['warning', 'Peringatan'], ['info', 'Info']]} />

      <Pilih label="Jenis alert" value={g('alert_type')} onChange={(v) => set({ alert_type: v })}
        options={[['', 'Semua jenis'], ...typeList.map((t) => [t, t.replace(/_/g, ' ')] as [string, string])]} />

      <Pilih label="Cabang" value={g('cabang')} onChange={(v) => set({ cabang: v })}
        options={[['', 'Semua cabang'], ...cabangList.map((c) => [c, c] as [string, string])]} />

      <Tanggal label="Dari tanggal" value={g('from')} onChange={(v) => set({ from: v })} />
      <Tanggal label="Sampai tanggal" value={g('to')} onChange={(v) => set({ to: v })} />

      {adaFilter && (
        <button
          onClick={() => router.push(basePath)}
          className="rounded-btn border border-line px-3 py-2 text-sm text-content-secondary transition-colors hover:border-brand hover:text-content-primary"
        >
          Reset
        </button>
      )}
    </div>
  );
}

function Pilih({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-content-secondary">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-input border border-line bg-surface-elevated px-3 py-2 text-sm"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function Tanggal({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-content-secondary">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-input border border-line bg-surface-elevated px-3 py-2 text-sm"
      />
    </div>
  );
}
