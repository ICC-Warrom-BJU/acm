'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from './Modal';
import { LABEL_KOLOM, type HasilBaris, type Masalah } from '@/lib/master-import';

/**
 * Import & update massal master unit.
 *
 * Alurnya sengaja dua langkah — pilih berkas, lihat pratinjau, baru simpan.
 * Tabel ini rujukan seluruh alert: satu berkas dengan kolom cabang yang salah
 * bisa memindahkan ratusan unit tanpa ada yang menyadarinya sampai laporan
 * bulanan tidak cocok. Pratinjau menunjukkan perubahan per kolom, bukan sekadar
 * jumlah baris, supaya yang keliru terlihat sebelum ditulis.
 */

type Pratinjau = {
  baris: HasilBaris[];
  masalah: Masalah[];
  takDisebut: number;
  kolomTerpakai: string[];
  kolomDiabaikan: string[];
};

type Selesai = { ditulis: number; baru: number; diubah: number; sama: number };

export function ImportMasterUnit() {
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [kosongkan, setKosongkan] = useState(false);
  const [pratinjau, setPratinjau] = useState<Pratinjau | null>(null);
  const [selesai, setSelesai] = useState<Selesai | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');

  function tutup() {
    setBuka(false);
    setFile(null);
    setPratinjau(null);
    setSelesai(null);
    setGalat('');
    setKosongkan(false);
  }

  async function kirim(commit: boolean) {
    if (!file) return;
    setSibuk(true);
    setGalat('');

    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', commit ? 'commit' : 'preview');
    fd.append('kosongkan', String(kosongkan));

    try {
      const res = await fetch('/api/master-vehicles/import', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) {
        setGalat(j.error ?? 'Gagal memproses berkas.');
      } else if (commit) {
        setSelesai(j);
        setPratinjau(null);
        router.refresh();
      } else {
        setPratinjau(j);
      }
    } catch {
      setGalat('Tidak bisa menghubungi server. Periksa koneksi, lalu coba lagi.');
    } finally {
      setSibuk(false);
    }
  }

  const baru = pratinjau?.baris.filter((b) => b.aksi === 'baru') ?? [];
  const ubah = pratinjau?.baris.filter((b) => b.aksi === 'ubah') ?? [];
  const sama = pratinjau?.baris.filter((b) => b.aksi === 'sama') ?? [];
  const rangka = ubah.filter((b) => b.gantiRangka);

  return (
    <>
      <button
        onClick={() => setBuka(true)}
        className="rounded-btn bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
      >
        Import / Update massal
      </button>

      {buka && (
        <Modal judul="Import &amp; update massal master unit" onClose={tutup} lebar="max-w-5xl">
          {selesai ? (
            <div className="space-y-4">
              <p className="rounded-input bg-surface-elevated px-4 py-3 text-sm">
                <span className="font-medium text-brand">Tersimpan.</span>{' '}
                {selesai.baru} unit baru ditambahkan, {selesai.diubah} unit diperbarui,{' '}
                {selesai.sama} baris tidak berubah sehingga tidak ditulis ulang.
              </p>
              <div className="flex justify-end">
                <button
                  onClick={tutup}
                  className="rounded-btn bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
                >
                  Selesai
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-input bg-surface-elevated px-4 py-3 text-sm text-content-secondary">
                <p>
                  Kuncinya <span className="font-mono text-content-primary">VHCID</span>. Baris
                  dengan VHCID yang sudah terdaftar akan diperbarui; yang belum ada akan
                  ditambahkan. Unit yang tidak disebut di berkas tidak akan tersentuh —
                  import tidak pernah menghapus unit.
                </p>
                <p className="mt-2">
                  <a
                    href="/api/master-vehicles/template"
                    className="text-brand underline underline-offset-2"
                  >
                    Unduh data sekarang (.xlsx)
                  </a>{' '}
                  untuk disunting lalu diunggah kembali, atau{' '}
                  <a
                    href="/api/master-vehicles/template?isi=kosong"
                    className="text-brand underline underline-offset-2"
                  >
                    template kosong
                  </a>
                  .
                </p>
              </div>

              <div>
                <label htmlFor="berkas" className="mb-1.5 block text-sm font-medium">
                  Berkas Excel atau CSV
                </label>
                <input
                  id="berkas"
                  type="file"
                  accept=".xlsx,.csv"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPratinjau(null);
                    setGalat('');
                  }}
                  className="w-full rounded-input border border-line bg-surface px-3 py-2 text-sm file:mr-3 file:rounded-btn file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-sm file:text-white"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={kosongkan}
                  onChange={(e) => {
                    setKosongkan(e.target.checked);
                    setPratinjau(null);
                  }}
                  className="mt-0.5"
                />
                <span>
                  Sel kosong berarti <span className="font-medium">hapus nilainya</span>
                  <span className="mt-0.5 block text-content-secondary">
                    Biarkan tidak tercentang bila berkas Anda hanya memuat sebagian kolom.
                    Bila dicentang, kolom yang kosong di berkas akan dikosongkan juga di
                    database.
                  </span>
                </span>
              </label>

              {galat && (
                <p
                  role="alert"
                  className="rounded-input bg-severity-critical px-4 py-3 text-sm text-white"
                >
                  {galat}
                </p>
              )}

              {pratinjau && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Angka label="Unit baru" nilai={baru.length} warna="text-brand" />
                    <Angka label="Diperbarui" nilai={ubah.length} warna="text-severity-warning" />
                    <Angka label="Tidak berubah" nilai={sama.length} />
                    <Angka
                      label="Bermasalah"
                      nilai={pratinjau.masalah.length}
                      warna={pratinjau.masalah.length ? 'text-severity-critical' : undefined}
                    />
                  </div>

                  <p className="text-xs text-content-secondary">
                    {pratinjau.takDisebut.toLocaleString('id-ID')} unit terdaftar tidak disebut
                    di berkas ini dan tidak akan berubah.
                    {pratinjau.kolomDiabaikan.length > 0 && (
                      <>
                        {' '}
                        Kolom yang tidak dikenali dan diabaikan:{' '}
                        {pratinjau.kolomDiabaikan.join(', ')}.
                      </>
                    )}
                  </p>

                  {rangka.length > 0 && (
                    <p className="rounded-input border border-severity-warning px-4 py-3 text-sm text-severity-warning">
                      {rangka.length} unit berganti nomor rangka padahal VHCID-nya sama. VHCID
                      adalah identitas perangkat GPS, jadi ini berarti perangkatnya dipindah ke
                      kendaraan lain — riwayat alert unit itu sebelumnya milik kendaraan yang
                      berbeda. Periksa dulu bila ini tidak disengaja.
                    </p>
                  )}

                  {pratinjau.masalah.length > 0 && (
                    <ul className="max-h-32 overflow-y-auto rounded-input bg-surface-elevated px-4 py-3 text-xs text-content-secondary">
                      {pratinjau.masalah.map((m, i) => (
                        <li key={i}>
                          {m.baris ? `Baris ${m.baris}: ` : ''}
                          {m.pesan}
                        </li>
                      ))}
                    </ul>
                  )}

                  {baru.length + ubah.length > 0 && (
                    <div className="max-h-72 overflow-auto rounded-card bg-surface-elevated">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 border-b border-line bg-surface-elevated text-left text-content-secondary">
                          <tr>
                            <th className="px-3 py-2 font-medium">VHCID</th>
                            <th className="px-3 py-2 font-medium">Aksi</th>
                            <th className="px-3 py-2 font-medium">Yang berubah</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...baru, ...ubah].slice(0, 200).map((b) => (
                            <tr key={b.vhcid} className="border-b border-line last:border-0">
                              <td className="whitespace-nowrap px-3 py-1.5 font-mono">
                                {b.vhcid}
                              </td>
                              <td className="whitespace-nowrap px-3 py-1.5">
                                <span
                                  className={
                                    b.aksi === 'baru' ? 'text-brand' : 'text-severity-warning'
                                  }
                                >
                                  {b.aksi === 'baru' ? 'baru' : 'ubah'}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-content-secondary">
                                {b.perubahan.map((p, i) => (
                                  <span key={p.kolom}>
                                    {i > 0 && ' · '}
                                    {LABEL_KOLOM[p.kolom]}:{' '}
                                    {b.aksi === 'ubah' && (
                                      <>
                                        <span className="line-through">{p.dari ?? '—'}</span>
                                        {' → '}
                                      </>
                                    )}
                                    <span className="text-content-primary">{p.ke ?? '—'}</span>
                                  </span>
                                ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {baru.length + ubah.length > 200 && (
                        <p className="px-3 py-2 text-xs text-content-secondary">
                          Menampilkan 200 dari {baru.length + ubah.length} baris yang akan
                          berubah.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={tutup}
                  className="rounded-btn border border-line px-4 py-2 text-sm text-content-secondary"
                >
                  Batal
                </button>
                {!pratinjau ? (
                  <button
                    onClick={() => kirim(false)}
                    disabled={!file || sibuk}
                    className="rounded-btn bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40"
                  >
                    {sibuk ? 'Memeriksa…' : 'Periksa berkas'}
                  </button>
                ) : (
                  <button
                    onClick={() => kirim(true)}
                    disabled={sibuk || baru.length + ubah.length === 0}
                    className="rounded-btn bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40"
                  >
                    {sibuk
                      ? 'Menyimpan…'
                      : baru.length + ubah.length === 0
                        ? 'Tidak ada yang perlu disimpan'
                        : `Simpan ${baru.length + ubah.length} perubahan`}
                  </button>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

function Angka({ label, nilai, warna }: { label: string; nilai: number; warna?: string }) {
  return (
    <div className="rounded-input bg-surface-elevated px-3 py-2">
      <p className="text-xs text-content-secondary">{label}</p>
      <p className={`font-mono text-lg ${warna ?? ''}`}>{nilai.toLocaleString('id-ID')}</p>
    </div>
  );
}
