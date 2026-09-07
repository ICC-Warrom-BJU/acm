'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { labelJenis } from '@/lib/alert';
import { ringkasKonfig, type KonfigCabang } from '@/lib/visibility';

/**
 * Matriks konfigurasi: cabang (baris) x jenis alert (kolom).
 *
 * Bentuk matriks dipilih supaya seluruh aturan terlihat sekaligus. Dengan
 * daftar per cabang yang harus dibuka satu per satu, mudah sekali ada cabang
 * yang tanpa sengaja dibisukan tanpa ada yang menyadarinya.
 */
export function TampilanMatrix({
  cabangList,
  jenisList,
  konfigAwal,
  kejadian,
}: {
  cabangList: string[];
  jenisList: string[];
  konfigAwal: KonfigCabang[];
  /** Kejadian 30 hari terakhir, kunci "cabang|jenis". */
  kejadian: Record<string, number>;
}) {
  const router = useRouter();

  // null = tanpa batasan (semua tampil). Array = daftar putih.
  const [konfig, setKonfig] = useState<Record<string, string[] | null>>(() => {
    const awal: Record<string, string[] | null> = {};
    for (const c of cabangList) awal[c] = null;
    for (const k of konfigAwal) awal[k.cabang] = k.alert_types;
    return awal;
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasil, setHasil] = useState<string | null>(null);
  const [berubah, setBerubah] = useState(false);

  function tampil(cabang: string, jenis: string) {
    const v = konfig[cabang];
    return v == null || v.includes(jenis);
  }

  function toggle(cabang: string, jenis: string) {
    setBerubah(true);
    setHasil(null);
    setKonfig((prev) => {
      const saatIni = prev[cabang];
      // Dari "tanpa batasan" ke daftar putih: mulai dari semua jenis, lalu
      // buang yang barusan dimatikan. Kalau mulai dari daftar kosong, satu klik
      // akan diam-diam menyembunyikan semua jenis lain.
      const dasar = saatIni == null ? [...jenisList] : [...saatIni];
      const baru = dasar.includes(jenis)
        ? dasar.filter((j) => j !== jenis)
        : [...dasar, jenis];
      return { ...prev, [cabang]: baru };
    });
  }

  function setBaris(cabang: string, semua: boolean) {
    setBerubah(true);
    setHasil(null);
    setKonfig((prev) => ({ ...prev, [cabang]: semua ? null : [] }));
  }

  async function simpan() {
    setBusy(true);
    setError(null);

    const baris = cabangList.map((c) => ({
      cabang: c,
      // Daftar putih yang memuat semua jenis disimpan sebagai NULL, bukan
      // sebagai array lengkap. Bedanya terasa nanti: dengan NULL, jenis alert
      // baru yang muncul dari master data otomatis ikut tampil, bukan diam-diam
      // tersembunyi karena tidak ada di daftar yang dibuat hari ini.
      alert_types:
        konfig[c] == null || konfig[c]!.length === jenisList.length ? null : konfig[c],
    }));

    const { error } = await createClient()
      .from('branch_alert_config')
      .upsert(baris, { onConflict: 'cabang' });

    setBusy(false);
    if (error) { setError(error.message); return; }

    setBerubah(false);
    setHasil('Konfigurasi tersimpan. Dashboard akan mengikutinya saat dimuat ulang.');
    router.refresh();
  }

  const dibisukan = cabangList.filter((c) => konfig[c]?.length === 0);

  // Peringatan paling berguna di layar ini: jenis yang dimatikan padahal
  // justru punya kejadian. Itu tanda seseorang menyembunyikan sesuatu yang
  // benar-benar terjadi, bukan sekadar merapikan jenis yang tidak relevan.
  const dimatikanPadahalAda = cabangList.flatMap((c) =>
    jenisList
      .filter((j) => !tampil(c, j) && (kejadian[`${c}|${j}`] ?? 0) > 0)
      .map((j) => `${c} / ${labelJenis(j)} (${kejadian[`${c}|${j}`]}×)`),
  );

  return (
    <div>
      {error && (
        <p role="alert" className="mb-4 rounded-input bg-severity-critical px-4 py-3 text-sm text-white">{error}</p>
      )}
      {hasil && (
        <p role="status" className="mb-4 rounded-input border-l-4 border-l-severity-info bg-surface-elevated px-4 py-3 text-sm">
          {hasil}
        </p>
      )}

      {dibisukan.length > 0 && (
        <p className="mb-4 rounded-input border-l-4 border-l-severity-warning bg-surface-elevated px-4 py-3 text-sm">
          <strong>{dibisukan.join(', ')}</strong> tidak akan menampilkan alert apa pun di
          dashboard. Datanya tetap tersimpan dan tetap masuk laporan.
        </p>
      )}

      {dimatikanPadahalAda.length > 0 && (
        <p className="mb-4 rounded-input border-l-4 border-l-severity-warning bg-surface-elevated px-4 py-3 text-sm">
          <strong>Jenis berikut dimatikan padahal punya kejadian 30 hari terakhir:</strong>{' '}
          {dimatikanPadahalAda.slice(0, 8).join(', ')}
          {dimatikanPadahalAda.length > 8 && `, dan ${dimatikanPadahalAda.length - 8} lainnya`}.
        </p>
      )}

      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={simpan}
          disabled={busy || !berubah}
          className="rounded-btn bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-40"
        >
          {busy ? 'Menyimpan…' : berubah ? 'Simpan perubahan' : 'Tidak ada perubahan'}
        </button>
        {berubah && (
          <span className="text-sm text-severity-warning">Ada perubahan yang belum disimpan.</span>
        )}
      </div>

      <div className="overflow-x-auto rounded-card bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-content-secondary">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Cabang</th>
              {jenisList.map((j) => (
                <th key={j} className="px-3 py-3 text-center font-medium">
                  <span className="block whitespace-nowrap">{labelJenis(j)}</span>
                </th>
              ))}
              <th className="px-4 py-3 text-left font-medium">Ringkasan</th>
            </tr>
          </thead>
          <tbody>
            {cabangList.map((c) => (
              <tr key={c} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <span className="font-mono font-medium">{c}</span>
                  <span className="ml-2 inline-flex gap-1">
                    <Mini onClick={() => setBaris(c, true)}>semua</Mini>
                    <Mini onClick={() => setBaris(c, false)}>tidak ada</Mini>
                  </span>
                </td>

                {jenisList.map((j) => {
                  const n = kejadian[`${c}|${j}`] ?? 0;
                  return (
                    <td key={j} className="px-3 py-2.5 text-center">
                      <label className="inline-flex cursor-pointer flex-col items-center gap-0.5">
                        <input
                          type="checkbox"
                          checked={tampil(c, j)}
                          onChange={() => toggle(c, j)}
                          aria-label={
                            n > 0
                              ? `${labelJenis(j)} di cabang ${c}, ${n} kejadian dalam 30 hari`
                              : `${labelJenis(j)} di cabang ${c}, belum pernah terjadi`
                          }
                          className="h-4 w-4 cursor-pointer accent-[var(--brand-primary)]"
                        />
                        {/* Angka kejadian nyata, bukan sekadar kotak kosong.
                            Yang nol diredupkan supaya jelas mencentangnya tidak
                            mengubah apa pun hari ini. */}
                        <span
                          className={`font-mono text-[10px] ${
                            n > 0 ? 'text-content-secondary' : 'text-content-secondary/40'
                          }`}
                        >
                          {n > 0 ? n.toLocaleString('id-ID') : '—'}
                        </span>
                      </label>
                    </td>
                  );
                })}

                <td className="px-4 py-2.5 text-content-secondary">
                  {ringkasKonfig({ cabang: c, alert_types: konfig[c] }, jenisList.length)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Mini({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-btn border border-line px-1.5 py-0 text-[10px] text-content-secondary transition-colors hover:border-brand hover:text-content-primary"
    >
      {children}
    </button>
  );
}
