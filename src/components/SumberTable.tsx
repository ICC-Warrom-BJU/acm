'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface Sumber {
  id: string;
  name: string;
  alert_type: string;
  endpoint_url: string;
  method: string;
  auth_type: string;
  auth_header_name: string;
  polling_interval_seconds: number;
  time_window_lookback_seconds: number;
  time_window_offset_hours: number;
  discriminator_path: string | null;
  data_path: string;
  is_active: boolean;
  field_mapping: Record<string, string>;
  token_masked: string | null;
}

interface HasilTest {
  success: boolean;
  responseCode: number | null;
  durationMs: number;
  recordsFetched: number;
  recordsNew: number;
  recordsDeduped: number;
  recordsSkipped: number;
  unmappedTypes: string[];
  error: string | null;
}

export function SumberTable({ rows }: { rows: Sumber[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasil, setHasil] = useState<Record<string, HasilTest>>({});

  async function simpan(id: string) {
    setBusy(id + '-save');
    setError(null);
    const res = await fetch(`/api/alert-sources/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const j = await res.json();
    setBusy(null);
    if (!res.ok) { setError(j.error ?? 'Gagal menyimpan'); return; }
    setEditing(null);
    router.refresh();
  }

  async function test(id: string) {
    setBusy(id + '-test');
    setError(null);
    const res = await fetch(`/api/alert-sources/${id}/test`, { method: 'POST' });
    const j = await res.json();
    setBusy(null);
    if (!res.ok) { setError(j.error ?? 'Gagal menguji'); return; }
    setHasil({ ...hasil, [id]: j });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-input bg-severity-critical px-4 py-3 text-sm text-white">{error}</p>
      )}

      {rows.map((r) => {
        const isEdit = editing === r.id;
        const h = hasil[r.id];

        return (
          <article key={r.id} className="rounded-card bg-surface-elevated p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-medium">
                  {r.name}
                  {!r.is_active && (
                    <span className="ml-2 rounded-full bg-severity-unknown/20 px-2 py-0.5 text-xs text-severity-unknown">
                      nonaktif
                    </span>
                  )}
                </h2>
                <p className="font-mono text-xs text-content-secondary">{r.alert_type}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {isEdit ? (
                  <>
                    <Btn primary onClick={() => simpan(r.id)} disabled={busy === r.id + '-save'}>
                      {busy === r.id + '-save' ? 'Menyimpan…' : 'Simpan'}
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
                          name: r.name,
                          endpoint_url: r.endpoint_url,
                          polling_interval_seconds: r.polling_interval_seconds,
                          time_window_lookback_seconds: r.time_window_lookback_seconds,
                          time_window_offset_hours: r.time_window_offset_hours,
                          auth_header_name: r.auth_header_name,
                          is_active: r.is_active,
                          token: '',
                        });
                      }}
                    >
                      Ubah
                    </Btn>
                    <Btn primary onClick={() => test(r.id)} disabled={busy === r.id + '-test'}>
                      {busy === r.id + '-test' ? 'Menguji…' : 'Test Sekarang'}
                    </Btn>
                  </>
                )}
              </div>
            </div>

            {isEdit ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="Nama">
                  <Input value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
                </Field>
                <Field label="Endpoint URL">
                  <Input value={draft.endpoint_url} onChange={(v) => setDraft({ ...draft, endpoint_url: v })} mono />
                </Field>
                <Field label="Interval polling (detik)" hint="Minimal 60. pg_cron membulatkan ke menit terdekat.">
                  <Input type="number" value={draft.polling_interval_seconds}
                    onChange={(v) => setDraft({ ...draft, polling_interval_seconds: Number(v) })} mono />
                </Field>
                <Field label="Lookback window (detik)" hint="Sengaja lebih besar dari interval agar window tumpang tindih dan tidak ada kejadian yang lolos.">
                  <Input type="number" value={draft.time_window_lookback_seconds}
                    onChange={(v) => setDraft({ ...draft, time_window_lookback_seconds: Number(v) })} mono />
                </Field>
                <Field label="Offset zona waktu window (jam)" hint="Zona waktu yang dipakai API untuk membaca start_time/stop_time. speed_flag = 0 (UTC), Notifikasi = 7 (WIB). Salah offset tidak menghasilkan error — hanya data yang kosong.">
                  <Input type="number" value={draft.time_window_offset_hours}
                    onChange={(v) => setDraft({ ...draft, time_window_offset_hours: Number(v) })} mono />
                </Field>
                <Field label="Nama header token">
                  <Input value={draft.auth_header_name} onChange={(v) => setDraft({ ...draft, auth_header_name: v })} mono />
                </Field>
                <Field label="Token baru" hint="Biarkan kosong untuk mempertahankan token yang tersimpan. Token tidak pernah ditampilkan utuh.">
                  <Input type="password" value={draft.token} placeholder="•••• (tidak diubah)"
                    onChange={(v) => setDraft({ ...draft, token: v })} mono />
                </Field>
                <Field label="Status">
                  <label className="flex items-center gap-2 py-2 text-sm">
                    <input type="checkbox" checked={draft.is_active}
                      onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
                    Aktif — menonaktifkan juga menghapus jadwal pg_cron-nya
                  </label>
                </Field>
              </div>
            ) : (
              <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <Baris label="Endpoint" value={r.endpoint_url} mono wrap />
                <Baris label="Token" value={r.token_masked ?? 'belum diisi'} mono />
                <Baris label="Interval" value={`${r.polling_interval_seconds} detik`} mono />
                <Baris label="Lookback" value={`${r.time_window_lookback_seconds} detik`} mono />
                <Baris label="Offset window" value={`+${r.time_window_offset_hours} jam`} mono />
                <Baris label="Header auth" value={r.auth_header_name} mono />
                <Baris label="Pembeda jenis" value={r.discriminator_path ?? 'satu jenis saja'} mono />
                <Baris label="Jalur data" value={r.data_path} mono />
              </dl>
            )}

            {h && (
              <div
                className={`mt-4 rounded-input border-l-4 p-4 text-sm ${
                  h.success ? 'border-l-severity-info bg-surface-base' : 'border-l-severity-critical bg-surface-base'
                }`}
              >
                <p className="font-medium">
                  {h.success ? 'Uji berhasil' : 'Uji gagal'}
                  <span className="ml-2 font-mono text-xs text-content-secondary">
                    {h.durationMs} ms · ResponseCode {h.responseCode ?? '—'}
                  </span>
                </p>
                {h.error ? (
                  <p className="mt-1 text-severity-critical">{h.error}</p>
                ) : (
                  <p className="mt-1 text-content-secondary">
                    {h.recordsFetched} record diambil · {h.recordsNew} baris baru ·{' '}
                    {h.recordsDeduped} ter-dedup · {h.recordsSkipped} dilewati
                  </p>
                )}
                {h.unmappedTypes?.length > 0 && (
                  <p className="mt-2 text-severity-warning">
                    Jenis belum dipetakan: {h.unmappedTypes.join(', ')} — atur di halaman Jenis Alert.
                  </p>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm text-content-secondary">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-content-secondary">{hint}</p>}
    </div>
  );
}

function Input({
  value, onChange, type = 'text', mono, placeholder,
}: {
  value: any; onChange: (v: string) => void; type?: string; mono?: boolean; placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-input border border-line bg-surface-base px-3 py-2 outline-none focus:border-brand ${mono ? 'font-mono text-sm' : ''}`}
    />
  );
}

function Baris({ label, value, mono, wrap }: { label: string; value: string; mono?: boolean; wrap?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-content-secondary">{label}</dt>
      <dd className={`${mono ? 'font-mono text-xs' : ''} ${wrap ? 'break-all' : 'truncate'}`}>{value}</dd>
    </div>
  );
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
      className={`rounded-btn px-4 py-1.5 text-sm transition-colors disabled:opacity-60 ${
        primary
          ? 'bg-brand font-medium text-white hover:bg-brand-hover'
          : 'border border-line text-content-secondary hover:border-brand hover:text-content-primary'
      }`}
    >
      {children}
    </button>
  );
}
