'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from './Modal';
import { formatClock, BUSINESS_TZ_LABEL } from '@/lib/time';

export interface Pengguna {
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  cabang_scope: string[] | null;
  last_sign_in_at: string | null;
  created_at: string;
  nonaktif: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  staff_it: 'Staff IT',
  management: 'Management',
};

const ROLE_KETERANGAN: Record<string, string> = {
  super_admin: 'Akses penuh termasuk mengelola pengguna. Tidak pernah dibatasi cabang.',
  staff_it: 'Menangani alert, konfigurasi sumber, dan master data.',
  management: 'Hanya melihat. Tidak bisa menutup alert atau mengubah konfigurasi.',
};

const SANDI_MIN = 10;

/**
 * Manajemen pengguna (PRD §4 — hanya Super Admin).
 *
 * Seluruh perubahan melewati route API, bukan langsung ke Supabase: pembuatan
 * akun dan pengubahan sandi menuntut service role yang hanya ada di server.
 */
export function PenggunaTable({
  rows,
  cabangList,
  saya,
}: {
  rows: Pengguna[];
  cabangList: string[];
  saya: string;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<null | { mode: 'baru' } | { mode: 'ubah' | 'sandi' | 'hapus'; u: Pengguna }>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasil, setHasil] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function kirim(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(j.error ?? 'Gagal'); return false; }
    router.refresh();
    return true;
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-4 rounded-input bg-severity-critical px-4 py-3 text-sm text-white">
          {error}
        </p>
      )}
      {hasil && (
        <p role="status" className="mb-4 rounded-input border-l-4 border-l-severity-info bg-surface-elevated px-4 py-3 text-sm">
          {hasil}
        </p>
      )}

      <div className="mb-4">
        <button onClick={() => { setModal({ mode: 'baru' }); setError(null); setHasil(null); }} className="btn-primary px-4 py-2 text-sm">
          Tambah Pengguna
        </button>
      </div>

      <div className="overflow-x-auto rounded-card bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-content-secondary">
            <tr>
              <Th>Nama</Th><Th>Email</Th><Th>Role</Th><Th>Cabang</Th>
              <Th>Terakhir masuk</Th><Th>Status</Th><Th>Aksi</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.user_id} className="border-b border-line last:border-0">
                <Td>
                  {u.full_name || <span className="text-content-secondary">tanpa nama</span>}
                  {u.user_id === saya && (
                    <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs">Anda</span>
                  )}
                </Td>
                <Td mono>{u.email}</Td>
                <Td>
                  <span className={u.role === 'super_admin' ? 'font-medium text-brand' : ''}>
                    {ROLE_LABEL[u.role] ?? u.role}
                  </span>
                </Td>
                <Td>
                  {u.role === 'super_admin' ? (
                    // Super Admin tidak pernah dibatasi cabang; menampilkan
                    // scope-nya akan menyesatkan meski datanya terisi.
                    <span className="text-content-secondary">seluruh cabang</span>
                  ) : u.cabang_scope?.length ? (
                    <span className="font-mono text-xs">{u.cabang_scope.join(', ')}</span>
                  ) : (
                    <span className="text-content-secondary">seluruh cabang</span>
                  )}
                </Td>
                <Td mono>
                  {u.last_sign_in_at
                    ? `${u.last_sign_in_at.slice(0, 10)} ${formatClock(u.last_sign_in_at)}`
                    : <span className="font-sans text-content-secondary">belum pernah</span>}
                </Td>
                <Td>
                  {u.nonaktif
                    ? <span className="text-severity-critical">Nonaktif</span>
                    : <span className="text-severity-info">Aktif</span>}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    <Btn onClick={() => { setModal({ mode: 'ubah', u }); setError(null); setHasil(null); }}>Ubah</Btn>
                    <Btn onClick={() => { setModal({ mode: 'sandi', u }); setError(null); setHasil(null); }}>Sandi</Btn>
                    {u.user_id !== saya && (
                      <>
                        <Btn onClick={() => kirim(`/api/users/${u.user_id}`, 'PATCH', { nonaktif: !u.nonaktif })} disabled={busy}>
                          {u.nonaktif ? 'Aktifkan' : 'Nonaktifkan'}
                        </Btn>
                        <Btn onClick={() => { setModal({ mode: 'hapus', u }); setError(null); }} bahaya>Hapus</Btn>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal?.mode === 'baru' && (
        <FormPengguna
          judul="Tambah Pengguna"
          cabangList={cabangList}
          busy={busy}
          onBatal={() => setModal(null)}
          onSimpan={async (d) => {
            if (await kirim('/api/users', 'POST', d)) {
              setModal(null);
              setHasil(`Akun ${d.email} dibuat. Sampaikan kata sandinya lewat jalur aman, dan minta penggunanya segera mengganti.`);
            }
          }}
        />
      )}

      {modal?.mode === 'ubah' && (
        <FormPengguna
          judul={`Ubah ${modal.u.full_name || modal.u.email}`}
          cabangList={cabangList}
          awal={modal.u}
          diriSendiri={modal.u.user_id === saya}
          busy={busy}
          onBatal={() => setModal(null)}
          onSimpan={async (d) => {
            if (await kirim(`/api/users/${modal.u.user_id}`, 'PATCH', {
              full_name: d.full_name, role: d.role, cabang_scope: d.cabang_scope,
            })) { setModal(null); setHasil('Perubahan tersimpan.'); }
          }}
        />
      )}

      {modal?.mode === 'sandi' && (
        <FormSandi
          u={modal.u}
          diriSendiri={modal.u.user_id === saya}
          busy={busy}
          onBatal={() => setModal(null)}
          onSimpan={async (d) => {
            if (await kirim(`/api/users/${modal.u.user_id}/password`, 'POST', d)) {
              setModal(null);
              setHasil('Kata sandi diperbarui.');
            }
          }}
        />
      )}

      {modal?.mode === 'hapus' && (
        <Modal judul="Hapus pengguna" onClose={() => setModal(null)} lebar="max-w-md">
          <>
            <p className="text-xl font-medium">Hapus akun ini?</p>
            <p className="mt-2 text-sm">
              <span className="font-mono">{modal.u.email}</span>
            </p>
            <p className="mt-3 rounded-input border-l-4 border-l-severity-warning bg-surface-elevated p-3 text-sm text-content-secondary">
              Penghapusan bersifat permanen dan akunnya tidak bisa dipulihkan. Kalau
              tujuannya hanya mencabut akses sementara, pakai <strong>Nonaktifkan</strong> —
              riwayat penanganan alert tetap tercatat atas namanya dan akunnya bisa
              dihidupkan lagi kapan saja.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="btn-ghost px-4 py-2 text-sm">Batal</button>
              <button
                onClick={async () => { if (await kirim(`/api/users/${modal.u.user_id}`, 'DELETE')) { setModal(null); setHasil('Akun dihapus.'); } }}
                disabled={busy}
                className="btn rounded-btn bg-severity-critical px-4 py-2 text-sm text-white"
              >
                {busy ? 'Menghapus…' : 'Hapus permanen'}
              </button>
            </div>
          </>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface DataForm {
  email: string;
  password: string;
  full_name: string;
  role: string;
  cabang_scope: string[] | null;
}

function FormPengguna({
  judul, cabangList, awal, diriSendiri, busy, onBatal, onSimpan,
}: {
  judul: string;
  cabangList: string[];
  awal?: Pengguna;
  diriSendiri?: boolean;
  busy: boolean;
  onBatal: () => void;
  onSimpan: (d: DataForm) => void;
}) {
  const baru = !awal;
  const [email, setEmail] = useState(awal?.email ?? '');
  const [password, setPassword] = useState('');
  const [nama, setNama] = useState(awal?.full_name ?? '');
  const [role, setRole] = useState(awal?.role ?? 'staff_it');
  const [scope, setScope] = useState<string[]>(awal?.cabang_scope ?? []);
  const [lihat, setLihat] = useState(false);

  // Super Admin tidak pernah dibatasi cabang, jadi pilihannya disembunyikan
  // supaya tidak ada yang mengira sudah membatasinya padahal tidak berlaku.
  const scopeBerlaku = role !== 'super_admin';

  return (
    <Modal judul={judul} onClose={onBatal} lebar="max-w-2xl">
      <>
        <p className="text-xl font-medium">{judul}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="u-email" className="mb-1 block text-sm text-content-secondary">Email</label>
            <input
              id="u-email" type="email" value={email} disabled={!baru}
              onChange={(e) => setEmail(e.target.value)}
              className="field font-mono text-sm"
              autoComplete="off"
            />
            {!baru && <p className="mt-1 text-xs text-content-secondary">Email tidak bisa diubah.</p>}
          </div>

          <div>
            <label htmlFor="u-nama" className="mb-1 block text-sm text-content-secondary">Nama lengkap</label>
            <input id="u-nama" value={nama} onChange={(e) => setNama(e.target.value)} className="field" />
          </div>

          {baru && (
            <div className="sm:col-span-2">
              <label htmlFor="u-sandi" className="mb-1 block text-sm text-content-secondary">
                Kata sandi awal
              </label>
              <div className="flex gap-2">
                <input
                  id="u-sandi" type={lihat ? 'text' : 'password'} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field font-mono text-sm" autoComplete="new-password"
                />
                <button type="button" onClick={() => setLihat((v) => !v)} className="btn-ghost shrink-0 px-3 py-2 text-xs">
                  {lihat ? 'Sembunyikan' : 'Lihat'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Dibangkitkan acak, bukan pola yang bisa ditebak. Ditampilkan
                    // langsung karena Super Admin harus menyampaikannya ke
                    // penggunanya — sandi yang tidak terbaca tidak bisa diserahkan.
                    const abjad = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
                    const acak = crypto.getRandomValues(new Uint32Array(14));
                    setPassword([...acak].map((n) => abjad[n % abjad.length]).join(''));
                    setLihat(true);
                  }}
                  className="btn-ghost shrink-0 px-3 py-2 text-xs"
                >
                  Buatkan
                </button>
              </div>
              <p className="mt-1 text-xs text-content-secondary">
                Minimal {SANDI_MIN} karakter. Sampaikan lewat jalur aman dan minta
                penggunanya segera mengganti.
              </p>
            </div>
          )}

          <div className="sm:col-span-2">
            <label htmlFor="u-role" className="mb-1 block text-sm text-content-secondary">Role</label>
            <select
              id="u-role" value={role} onChange={(e) => setRole(e.target.value)}
              disabled={diriSendiri}
              className="field"
            >
              <option value="super_admin">Super Admin</option>
              <option value="staff_it">Staff IT</option>
              <option value="management">Management</option>
            </select>
            <p className="mt-1 text-xs text-content-secondary">
              {diriSendiri
                ? 'Role akun sendiri tidak bisa diubah — minta Super Admin lain melakukannya.'
                : ROLE_KETERANGAN[role]}
            </p>
          </div>

          {scopeBerlaku && (
            <div className="sm:col-span-2">
              <span className="mb-1 block text-sm text-content-secondary">Batasi ke cabang</span>
              <div className="flex flex-wrap gap-2 rounded-input border border-line bg-surface-base p-3">
                {cabangList.map((c) => (
                  <label key={c} className="flex cursor-pointer items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={scope.includes(c)}
                      onChange={() => setScope((s) => s.includes(c) ? s.filter((x) => x !== c) : [...s, c])}
                      className="h-4 w-4 accent-[var(--brand-primary)]"
                    />
                    <span className="font-mono">{c}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-content-secondary">
                {scope.length === 0
                  ? 'Tidak ada yang dicentang = melihat SELURUH cabang.'
                  : `Hanya melihat alert dan unit dari ${scope.length} cabang terpilih. Alert dari unit yang belum terdaftar tetap terlihat.`}
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onBatal} className="btn-ghost px-4 py-2 text-sm">Batal</button>
          <button
            onClick={() => onSimpan({
              email, password, full_name: nama, role,
              cabang_scope: scopeBerlaku && scope.length ? scope : null,
            })}
            disabled={busy || !nama.trim() || (baru && (!email.trim() || password.length < SANDI_MIN))}
            className="btn-primary px-4 py-2 text-sm"
          >
            {busy ? 'Menyimpan…' : baru ? 'Buat akun' : 'Simpan'}
          </button>
        </div>
      </>
    </Modal>
  );
}

function FormSandi({
  u, diriSendiri, busy, onBatal, onSimpan,
}: {
  u: Pengguna;
  diriSendiri: boolean;
  busy: boolean;
  onBatal: () => void;
  onSimpan: (d: { password: string; password_lama?: string }) => void;
}) {
  const [lama, setLama] = useState('');
  const [baru, setBaru] = useState('');
  const [lihat, setLihat] = useState(false);

  return (
    <Modal judul="Ubah kata sandi" onClose={onBatal} lebar="max-w-md">
      <>
        <p className="text-xl font-medium">Ubah kata sandi</p>
        <p className="mt-1 font-mono text-sm text-content-secondary">{u.email}</p>

        {diriSendiri && (
          <div className="mt-4">
            <label htmlFor="s-lama" className="mb-1 block text-sm text-content-secondary">
              Kata sandi lama
            </label>
            <input
              id="s-lama" type="password" value={lama} onChange={(e) => setLama(e.target.value)}
              className="field" autoComplete="current-password"
            />
            <p className="mt-1 text-xs text-content-secondary">
              Diminta karena Anda mengubah sandi akun sendiri — supaya perangkat yang
              tertinggal dalam keadaan login tidak bisa dipakai mengambil alih akun.
            </p>
          </div>
        )}

        <div className="mt-4">
          <label htmlFor="s-baru" className="mb-1 block text-sm text-content-secondary">
            Kata sandi baru
          </label>
          <div className="flex gap-2">
            <input
              id="s-baru" type={lihat ? 'text' : 'password'} value={baru}
              onChange={(e) => setBaru(e.target.value)}
              className="field font-mono text-sm" autoComplete="new-password"
            />
            <button type="button" onClick={() => setLihat((v) => !v)} className="btn-ghost shrink-0 px-3 py-2 text-xs">
              {lihat ? 'Sembunyikan' : 'Lihat'}
            </button>
          </div>
          <p className="mt-1 text-xs text-content-secondary">Minimal {SANDI_MIN} karakter.</p>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onBatal} className="btn-ghost px-4 py-2 text-sm">Batal</button>
          <button
            onClick={() => onSimpan(diriSendiri ? { password: baru, password_lama: lama } : { password: baru })}
            disabled={busy || baru.length < SANDI_MIN || (diriSendiri && !lama)}
            className="btn-primary px-4 py-2 text-sm"
          >
            {busy ? 'Menyimpan…' : 'Ubah sandi'}
          </button>
        </div>
      </>
    </Modal>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 font-medium">{children}</th>;
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-4 py-3 ${mono ? 'font-mono text-xs' : ''}`}>{children}</td>;
}

function Btn({
  children, onClick, disabled, bahaya,
}: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; bahaya?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-btn border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
        bahaya
          ? 'border-severity-critical text-severity-critical hover:bg-severity-critical hover:text-white'
          : 'border-line text-content-secondary hover:border-brand hover:text-content-primary'
      }`}
    >
      {children}
    </button>
  );
}
