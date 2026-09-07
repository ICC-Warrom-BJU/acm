'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatClock, BUSINESS_TZ_LABEL } from '@/lib/time';
import { AlertDetail } from './AlertDetail';

export interface AlertRow {
  id: string;
  vhcid: string | null;
  no_plat: string | null;
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  cabang: string | null;
  group_project: string | null;
  status: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

const SEV_BADGE: Record<string, string> = {
  critical: 'bg-severity-critical text-white',
  warning: 'bg-severity-warning text-black',
  info: 'bg-severity-info text-white',
};

/**
 * Antrian alert + bulk close (PRD §7.2, §9).
 *
 * Dua mode penutupan yang sengaja dibedakan tegas di UI:
 *   - centang baris  -> menutup persis yang terlihat dipilih
 *   - "semua sesuai filter" -> menutup SELURUH baris yang cocok, termasuk yang
 *     ada di halaman lain dan tidak terlihat di layar
 * Mode kedua jauh lebih berbahaya, jadi jumlahnya selalu disebut eksplisit di
 * dialog konfirmasi sebelum apa pun dieksekusi.
 */
export function AntrianTable({
  rows,
  total,
  filter,
  canClose,
}: {
  rows: AlertRow[];
  total: number;
  filter: Record<string, string | undefined>;
  canClose: boolean;
}) {
  const router = useRouter();
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<null | { mode: 'terpilih' | 'filter'; jumlah: number }>(null);
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasil, setHasil] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const semuaTerpilih = rows.length > 0 && rows.every((r) => pilih.has(r.id));

  function toggleSemua() {
    setPilih(semuaTerpilih ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function toggle(id: string) {
    const n = new Set(pilih);
    n.has(id) ? n.delete(id) : n.add(id);
    setPilih(n);
  }

  async function jalankan(aksi: 'close' | 'acknowledge') {
    setBusy(true);
    setError(null);

    const body: Record<string, unknown> = { action: aksi };
    if (modal?.mode === 'terpilih') body.ids = [...pilih];
    else body.filter = bersihkan(filter);
    if (aksi === 'close' && catatan.trim()) body.close_note = catatan.trim();

    const res = await fetch('/api/alerts/bulk-close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    setBusy(false);

    if (!res.ok) { setError(j.error ?? 'Gagal'); return; }

    setHasil(`${j.affected} alert ${aksi === 'close' ? 'ditutup' : 'di-acknowledge'}.`);
    setModal(null);
    setPilih(new Set());
    setCatatan('');
    router.refresh();
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-input bg-severity-critical px-4 py-3 text-sm text-white">{error}</p>
      )}
      {hasil && (
        <p className="mb-4 rounded-input border-l-4 border-l-severity-info bg-surface-elevated px-4 py-3 text-sm">
          {hasil}
        </p>
      )}

      {canClose && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setModal({ mode: 'terpilih', jumlah: pilih.size })}
            disabled={pilih.size === 0}
            className="rounded-btn bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-40"
          >
            Tutup {pilih.size} terpilih
          </button>

          <button
            onClick={() => setModal({ mode: 'filter', jumlah: total })}
            disabled={total === 0}
            className="rounded-btn border border-severity-warning px-4 py-2 text-sm text-severity-warning transition-colors hover:bg-severity-warning hover:text-black disabled:opacity-40"
          >
            Pilih semua sesuai filter ({total.toLocaleString('id-ID')})
          </button>

          {pilih.size > 0 && (
            <button
              onClick={() => setPilih(new Set())}
              className="text-sm text-content-secondary underline"
            >
              Batalkan pilihan
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-card bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-content-secondary">
            <tr>
              {canClose && (
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" checked={semuaTerpilih} onChange={toggleSemua} />
                </th>
              )}
              <Th>Severity</Th><Th>Unit</Th><Th>Jenis</Th><Th>Cabang / Project</Th>
              <Th>Kejadian</Th><Th>Terakhir</Th><Th>Status</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={canClose ? 9 : 8} className="px-4 py-8 text-content-secondary">
                  Tidak ada alert yang cocok dengan filter ini.
                </td>
              </tr>
            )}

            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                {canClose && (
                  <td className="px-4 py-2.5">
                    <input type="checkbox" checked={pilih.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                )}
                <Td>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${SEV_BADGE[r.severity]}`}>
                    {r.severity}
                  </span>
                </Td>
                <Td>
                  <span className="block font-mono">{r.no_plat ?? '—'}</span>
                  <span className="block font-mono text-xs text-content-secondary">
                    {r.vhcid ?? 'tidak terdaftar'}
                  </span>
                </Td>
                <Td>{r.alert_type.replace(/_/g, ' ')}</Td>
                <Td>
                  {r.cabang || r.group_project ? (
                    <>
                      <span className="block">{r.cabang ?? '—'}</span>
                      <span className="block text-xs text-content-secondary line-clamp-1">
                        {r.group_project ?? ''}
                      </span>
                    </>
                  ) : (
                    <span className="text-severity-unknown">Unit belum terdaftar</span>
                  )}
                </Td>
                <Td mono>{r.occurrence_count}×</Td>
                <Td mono>{formatClock(r.last_seen_at)} {BUSINESS_TZ_LABEL}</Td>
                <Td>
                  <span className={r.status === 'active' ? '' : 'text-content-secondary'}>
                    {r.status}
                  </span>
                </Td>
                <Td>
                  <button
                    onClick={() => setDetail(r.id)}
                    className="rounded-btn border border-line px-2.5 py-1 text-xs text-content-secondary transition-colors hover:border-brand hover:text-content-primary"
                  >
                    Detail
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && <AlertDetail alertId={detail} onClose={() => setDetail(null)} />}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass w-full max-w-lg rounded-card p-6">
            <h2 className="text-xl font-medium">
              {modal.mode === 'filter' ? 'Tutup semua sesuai filter' : 'Tutup alert terpilih'}
            </h2>

            {modal.mode === 'filter' ? (
              <div className="mt-3 rounded-input border-l-4 border-l-severity-warning bg-surface-elevated p-3 text-sm">
                <p className="font-medium text-severity-warning">
                  {modal.jumlah.toLocaleString('id-ID')} alert akan ditutup
                </p>
                <p className="mt-1 text-content-secondary">
                  Termasuk baris di halaman lain yang tidak terlihat di layar sekarang.
                  Hanya alert yang belum tertutup yang terpengaruh — penutupan sebelumnya
                  beserta catatannya tidak ditimpa.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-content-secondary">
                {modal.jumlah} alert yang Anda centang akan ditutup.
              </p>
            )}

            <label className="mt-4 block text-sm text-content-secondary">
              Catatan penutupan (opsional)
            </label>
            <input
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="mis. sudah dikonfirmasi ke driver"
              className="mt-1 w-full rounded-input border border-line bg-surface-elevated px-3 py-2 outline-none focus:border-brand"
            />

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                className="rounded-btn border border-line px-4 py-2 text-sm text-content-secondary"
              >
                Batal
              </button>
              <button
                onClick={() => jalankan('acknowledge')}
                disabled={busy}
                className="rounded-btn border border-line px-4 py-2 text-sm transition-colors hover:border-brand disabled:opacity-60"
              >
                Acknowledge saja
              </button>
              <button
                onClick={() => jalankan('close')}
                disabled={busy}
                className="rounded-btn bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
              >
                {busy ? 'Memproses…' : 'Tutup alert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function bersihkan(f: Record<string, string | undefined>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v) out[k] = v;
  return out;
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 font-medium">{children}</th>;
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-4 py-2.5 ${mono ? 'font-mono text-xs' : ''}`}>{children}</td>;
}
