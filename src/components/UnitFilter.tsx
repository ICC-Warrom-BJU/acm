'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

/**
 * Filter & pencarian Master Data VHCID.
 *
 * Nilainya disimpan di query string, bukan di state komponen, supaya hasil
 * pencarian bisa di-bookmark dan dibagikan — dan supaya tombol kembali di
 * peramban berperilaku seperti yang diharapkan.
 */
export function UnitFilter({
  cabangList,
  projectList,
}: {
  cabangList: string[];
  projectList: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  function terapkan(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    // Setiap perubahan filter mengembalikan ke halaman 1. Tanpa ini, filter
    // baru yang hasilnya sedikit akan tampil kosong karena masih di halaman 7.
    next.delete('hal');
    router.push(`/master-unit?${next.toString()}`);
  }

  const cabangAktif = params.get('cabang') ?? '';
  const projectAktif = params.get('project') ?? '';

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <form
        onSubmit={(e) => { e.preventDefault(); terapkan({ q }); }}
        className="flex items-end gap-2"
      >
        <div>
          <label className="mb-1 block text-xs text-content-secondary">
            Cari VHCID, no. polisi, atau no. rangka
          </label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="mis. VEH0174682 atau DA 8893"
            className="w-72 rounded-input border border-line bg-surface-elevated px-3 py-2"
          />
        </div>
        <button
          type="submit"
          className="rounded-btn bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
        >
          Cari
        </button>
      </form>

      <div>
        <label className="mb-1 block text-xs text-content-secondary">Cabang</label>
        <select
          value={cabangAktif}
          onChange={(e) => terapkan({ cabang: e.target.value })}
          className="rounded-input border border-line bg-surface-elevated px-3 py-2"
        >
          <option value="">Semua cabang</option>
          {cabangList.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-content-secondary">Project</label>
        <select
          value={projectAktif}
          onChange={(e) => terapkan({ project: e.target.value })}
          className="max-w-xs rounded-input border border-line bg-surface-elevated px-3 py-2"
        >
          <option value="">Semua project</option>
          {projectList.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {(q || cabangAktif || projectAktif) && (
        <button
          onClick={() => { setQ(''); router.push('/master-unit'); }}
          className="rounded-btn border border-line px-3 py-2 text-sm text-content-secondary transition-colors hover:border-brand hover:text-content-primary"
        >
          Reset
        </button>
      )}
    </div>
  );
}
