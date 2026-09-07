'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export interface JenisAlert {
  id: string;
  notif_value: string;
  alert_type: string | null;
  label: string | null;
  severity: string | null;
  is_active: boolean;
  auto_discovered: boolean;
  seen_count: number;
  last_seen_at: string;
  notes: string | null;
  sample_payload: any;
}

/**
 * Pengelolaan master jenis notifikasi (PRD §2.2 — konfigurasi lewat UI).
 *
 * Inilah tempat pemetaan seperti fatigue driving diselesaikan tanpa menyentuh
 * kode: isi kode alert-nya, pilih severity, aktifkan. Jenis yang ditemukan
 * poller muncul sendiri di sini dalam keadaan nonaktif.
 */
export function JenisAlertTable({ rows }: { rows: JenisAlert[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<JenisAlert>>({});
  const [lihatContoh, setLihatContoh] = useState<string | null>(null);

  async function simpan(id: string) {
    setBusy(id);
    setError(null);

    const patch = {
      alert_type: draft.alert_type?.trim() || null,
      label: draft.label?.trim() || null,
      severity: draft.severity || null,
      notes: draft.notes?.trim() || null,
    };

    // Penjagaan yang sengaja ada di sini, bukan hanya di database: mengaktifkan
    // jenis tanpa alert_type akan membuat poller melewatinya diam-diam, dan
    // orang yang mengaktifkannya akan mengira sudah beres.
    if (draft.is_active && !patch.alert_type) {
      setError('Kode alert wajib diisi sebelum jenis ini bisa diaktifkan.');
      setBusy(null);
      return;
    }

    const { error } = await createClient()
      .from('alert_type_master')
      .update({ ...patch, is_active: draft.is_active ?? false })
      .eq('id', id);

    setBusy(null);
    if (error) { setError(error.message); return; }

    setEditing(null);
    router.refresh();
  }

  async function toggleAktif(r: JenisAlert) {
    if (!r.alert_type && !r.is_active) {
      setError(`"${r.notif_value}" belum punya kode alert. Isi dulu lewat tombol Ubah.`);
      return;
    }
    setBusy(r.id);
    setError(null);
    const { error } = await createClient()
      .from('alert_type_master')
      .update({ is_active: !r.is_active })
      .eq('id', r.id);
    setBusy(null);
    if (error) { setError(error.message); return; }
    router.refresh();
  }

  const belumDipetakan = rows.filter((r) => !r.alert_type);

  return (
    <div>
      {error && (
        <p role="alert" className="mb-4 rounded-input bg-severity-critical px-4 py-3 text-sm text-white">
          {error}
        </p>
      )}

      {belumDipetakan.length > 0 && (
        <div className="mb-6 rounded-card border-l-4 border-l-severity-warning bg-surface-elevated p-4">
          <p className="font-medium">
            {belumDipetakan.length} jenis terdeteksi tapi belum dipetakan
          </p>
          <p className="mt-1 text-sm text-content-secondary">
            Poller mencatatnya otomatis dari response API dan sengaja tidak
            memprosesnya sampai ada yang meninjau. Isi kode alert lalu aktifkan
            kalau jenis itu memang perlu masuk dashboard.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-card bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-content-secondary">
            <tr>
              <Th>Nilai dari API</Th>
              <Th>Kode alert ACM</Th>
              <Th>Label</Th>
              <Th>Severity</Th>
              <Th>Muncul</Th>
              <Th>Status</Th>
              <Th>Aksi</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isEdit = editing === r.id;
              return (
                <>
                  <tr key={r.id} className="border-b border-line last:border-0 align-top">
                    <Td>
                      <span className="font-mono">{r.notif_value}</span>
                      {r.auto_discovered && (
                        <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-content-secondary">
                          terdeteksi otomatis
                        </span>
                      )}
                      {r.notes && !isEdit && (
                        <p className="mt-1 max-w-md text-xs text-content-secondary">{r.notes}</p>
                      )}
                    </Td>

                    <Td>
                      {isEdit ? (
                        <input
                          value={draft.alert_type ?? ''}
                          onChange={(e) => setDraft({ ...draft, alert_type: e.target.value })}
                          placeholder="mis. fatigue_driving"
                          className="w-44 rounded-input border border-line bg-surface-base px-2 py-1 font-mono"
                        />
                      ) : (
                        <span className={r.alert_type ? 'font-mono' : 'text-content-secondary'}>
                          {r.alert_type ?? 'belum dipetakan'}
                        </span>
                      )}
                    </Td>

                    <Td>
                      {isEdit ? (
                        <input
                          value={draft.label ?? ''}
                          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                          className="w-40 rounded-input border border-line bg-surface-base px-2 py-1"
                        />
                      ) : (
                        r.label ?? '—'
                      )}
                    </Td>

                    <Td>
                      {isEdit ? (
                        <select
                          value={draft.severity ?? ''}
                          onChange={(e) => setDraft({ ...draft, severity: e.target.value })}
                          className="rounded-input border border-line bg-surface-base px-2 py-1"
                        >
                          <option value="">(turunkan otomatis)</option>
                          <option value="critical">critical</option>
                          <option value="warning">warning</option>
                          <option value="info">info</option>
                        </select>
                      ) : (
                        <span className={SEV[r.severity ?? ''] ?? 'text-content-secondary'}>
                          {r.severity ?? 'otomatis'}
                        </span>
                      )}
                    </Td>

                    <Td mono>{r.seen_count.toLocaleString('id-ID')}×</Td>

                    <Td>
                      <span className={r.is_active ? 'text-severity-info' : 'text-content-secondary'}>
                        {r.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </Td>

                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {isEdit ? (
                          <>
                            <label className="flex items-center gap-1.5 text-xs">
                              <input
                                type="checkbox"
                                checked={draft.is_active ?? false}
                                onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                              />
                              Aktif
                            </label>
                            <Btn onClick={() => simpan(r.id)} disabled={busy === r.id} primary>
                              {busy === r.id ? '…' : 'Simpan'}
                            </Btn>
                            <Btn onClick={() => setEditing(null)}>Batal</Btn>
                          </>
                        ) : (
                          <>
                            <Btn
                              onClick={() => {
                                setEditing(r.id);
                                setError(null);
                                setDraft({
                                  alert_type: r.alert_type ?? '',
                                  label: r.label ?? '',
                                  severity: r.severity ?? '',
                                  notes: r.notes ?? '',
                                  is_active: r.is_active,
                                });
                              }}
                            >
                              Ubah
                            </Btn>
                            <Btn onClick={() => toggleAktif(r)} disabled={busy === r.id}>
                              {r.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                            </Btn>
                            {r.sample_payload && (
                              <Btn onClick={() => setLihatContoh(lihatContoh === r.id ? null : r.id)}>
                                Contoh
                              </Btn>
                            )}
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>

                  {isEdit && (
                    <tr key={r.id + '-catatan'} className="border-b border-line">
                      <td colSpan={7} className="px-4 pb-3">
                        <label className="mb-1 block text-xs text-content-secondary">Catatan</label>
                        <input
                          value={draft.notes ?? ''}
                          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                          placeholder="Alasan keputusan, mis. kenapa jenis ini dinonaktifkan"
                          className="w-full rounded-input border border-line bg-surface-base px-2 py-1.5"
                        />
                      </td>
                    </tr>
                  )}

                  {lihatContoh === r.id && (
                    <tr key={r.id + '-contoh'} className="border-b border-line">
                      <td colSpan={7} className="px-4 pb-4">
                        {/* Contoh payload asli: dasar untuk menilai apakah jenis
                            ini layak diaktifkan dan severity apa yang pantas. */}
                        <pre className="max-h-64 overflow-auto rounded-input bg-surface-base p-3 text-xs">
                          {JSON.stringify(r.sample_payload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SEV: Record<string, string> = {
  critical: 'text-severity-critical',
  warning: 'text-severity-warning',
  info: 'text-severity-info',
};

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 font-medium">{children}</th>;
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-4 py-3 ${mono ? 'font-mono' : ''}`}>{children}</td>;
}

function Btn({
  children, onClick, disabled, primary,
}: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-btn px-3 py-1 text-xs transition-colors disabled:opacity-60 ${
        primary
          ? 'bg-brand font-medium text-white hover:bg-brand-hover'
          : 'border border-line text-content-secondary hover:border-brand hover:text-content-primary'
      }`}
    >
      {children}
    </button>
  );
}
