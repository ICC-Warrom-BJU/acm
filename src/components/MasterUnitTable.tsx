'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export interface Unit {
  vhcid: string;
  no_plat: string | null;
  no_rangka: string | null;
  cabang: string | null;
  group_project: string | null;
  vendor: string | null;
  jenis_gps: string | null;
  fitur: string[] | null;
  updated_at: string;
}

/**
 * Tabel Master Data VHCID (PRD §9).
 *
 * Penyuntingan hanya untuk Staff IT & Super Admin; Management view only
 * (PRD §4). Tombolnya disembunyikan, dan RLS menolaknya lagi di database —
 * dua lapis, seperti seluruh sistem ini.
 */
export function MasterUnitTable({
  rows,
  canEdit,
  userId,
}: {
  rows: Unit[];
  canEdit: boolean;
  userId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function simpan(vhcid: string) {
    setBusy(true);
    setError(null);

    const { error } = await createClient()
      .from('master_vehicles')
      .update({
        no_plat: kosongJadiNull(draft.no_plat),
        no_rangka: kosongJadiNull(draft.no_rangka),
        cabang: kosongJadiNull(draft.cabang),
        group_project: kosongJadiNull(draft.group_project),
        vendor: kosongJadiNull(draft.vendor),
        jenis_gps: kosongJadiNull(draft.jenis_gps),
        // Fitur multi-nilai dipisah koma di UI, disimpan sebagai array (PRD §6.1).
        fitur: (draft.fitur ?? '')
          .split(',')
          .map((f: string) => f.trim())
          .filter(Boolean),
        // Auditability (PRD §10): setiap perubahan master data mencatat siapa.
        updated_by: userId,
      })
      .eq('vhcid', vhcid);

    setBusy(false);
    if (error) { setError(error.message); return; }
    setEditing(null);
    router.refresh();
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-input bg-severity-critical px-4 py-3 text-sm text-white">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-card bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-content-secondary">
            <tr>
              <Th>VHCID</Th>
              <Th>No. Polisi</Th>
              <Th>No. Rangka</Th>
              <Th>Cabang</Th>
              <Th>Project</Th>
              <Th>Vendor</Th>
              <Th>Jenis GPS</Th>
              {canEdit && <Th>Aksi</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 8 : 7} className="px-4 py-8 text-content-secondary">
                  Tidak ada unit yang cocok dengan filter ini.
                </td>
              </tr>
            )}

            {rows.map((u) => {
              const isEdit = editing === u.vhcid;
              return (
                <tr key={u.vhcid} className="border-b border-line last:border-0">
                  {/* VHCID tidak pernah bisa diubah: ia kunci utama yang diacu
                      seluruh alert. Menggantinya akan memutus riwayat unit. */}
                  <Td mono>{u.vhcid}</Td>

                  <Td mono>
                    {isEdit ? <Inp v={draft.no_plat} on={(x) => setDraft({ ...draft, no_plat: x })} />
                      : u.no_plat ?? <Kosong />}
                  </Td>
                  <Td mono>
                    {isEdit ? <Inp v={draft.no_rangka} on={(x) => setDraft({ ...draft, no_rangka: x })} />
                      : u.no_rangka ?? <Kosong />}
                  </Td>
                  <Td>
                    {isEdit ? <Inp v={draft.cabang} on={(x) => setDraft({ ...draft, cabang: x })} />
                      : u.cabang ?? <Kosong />}
                  </Td>
                  <Td>
                    {isEdit ? <Inp v={draft.group_project} on={(x) => setDraft({ ...draft, group_project: x })} wide />
                      : <span className="line-clamp-1">{u.group_project ?? <Kosong />}</span>}
                  </Td>
                  <Td>
                    {isEdit ? <Inp v={draft.vendor} on={(x) => setDraft({ ...draft, vendor: x })} />
                      : u.vendor ?? <Kosong />}
                  </Td>
                  <Td>
                    {isEdit ? <Inp v={draft.jenis_gps} on={(x) => setDraft({ ...draft, jenis_gps: x })} />
                      : u.jenis_gps ?? <Kosong />}
                  </Td>

                  {canEdit && (
                    <Td>
                      <div className="flex gap-2">
                        {isEdit ? (
                          <>
                            <Btn primary onClick={() => simpan(u.vhcid)} disabled={busy}>
                              {busy ? '…' : 'Simpan'}
                            </Btn>
                            <Btn onClick={() => setEditing(null)}>Batal</Btn>
                          </>
                        ) : (
                          <Btn
                            onClick={() => {
                              setEditing(u.vhcid);
                              setError(null);
                              setDraft({
                                no_plat: u.no_plat ?? '',
                                no_rangka: u.no_rangka ?? '',
                                cabang: u.cabang ?? '',
                                group_project: u.group_project ?? '',
                                vendor: u.vendor ?? '',
                                jenis_gps: u.jenis_gps ?? '',
                                fitur: (u.fitur ?? []).join(', '),
                              });
                            }}
                          >
                            Ubah
                          </Btn>
                        )}
                      </div>
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function kosongJadiNull(v: string | undefined) {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
}

function Kosong() {
  return <span className="text-content-secondary">—</span>;
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 font-medium">{children}</th>;
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-4 py-2.5 ${mono ? 'font-mono text-xs' : ''}`}>{children}</td>;
}

function Inp({ v, on, wide }: { v: any; on: (x: string) => void; wide?: boolean }) {
  return (
    <input
      value={v ?? ''}
      onChange={(e) => on(e.target.value)}
      className={`rounded-input border border-line bg-surface-base px-2 py-1 outline-none focus:border-brand ${wide ? 'w-56' : 'w-32'}`}
    />
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
