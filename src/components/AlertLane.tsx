'use client';

import { AlertCard } from './AlertCard';
import { labelJenis, type Alert } from '@/lib/alert';

/**
 * Satu lajur feed untuk SATU jenis alert.
 *
 * Sebelumnya semua jenis bercampur dalam satu daftar, sehingga speed_flag yang
 * jauh lebih sering muncul menenggelamkan jenis lain — fatigue driving yang
 * hanya muncul sekali sehari praktis tidak akan pernah terlihat di layar.
 * Dengan lajur terpisah, tiap jenis punya ruangnya sendiri dan volume satu
 * jenis tidak lagi menutupi jenis lain.
 *
 * Tiap lajur bergulir sendiri: lonjakan pada satu jenis tidak menggeser
 * posisi baca operator di jenis lain.
 */
export function AlertLane({
  jenis,
  alerts,
  wall,
  onDetail,
}: {
  jenis: string;
  alerts: Alert[];
  wall: boolean;
  onDetail: (id: string) => void;
}) {
  const kritis = alerts.filter((a) => a.severity === 'critical').length;
  const kejadian = alerts.reduce((n, a) => n + a.occurrence_count, 0);

  const s = wall
    ? { judul: 'text-2xl', angka: 'text-2xl', meta: 'text-base', jarak: 'space-y-2' }
    : { judul: 'text-sm', angka: 'text-base', meta: 'text-[11px]', jarak: 'space-y-1.5' };

  return (
    <section className="flex min-h-0 flex-col rounded-card bg-surface-base">
      {/* Judul lajur menempel di atas saat digulir, supaya operator tidak
          kehilangan konteks jenis alert saat menyusuri daftar panjang. */}
      <header className="sticky top-0 z-10 flex items-baseline justify-between gap-2 rounded-t-card bg-surface-base px-1 pb-1.5">
        <h3 className={`truncate font-medium ${s.judul}`}>{labelJenis(jenis)}</h3>
        <div className={`flex shrink-0 items-baseline gap-2 ${s.meta}`}>
          {kritis > 0 && (
            <span className="rounded-full bg-severity-critical px-2 py-0.5 font-medium text-white">
              {kritis} kritis
            </span>
          )}
          <span className={`font-mono font-medium ${s.angka}`}>{alerts.length}</span>
          <span className="text-content-secondary">unit · {kejadian}×</span>
        </div>
      </header>

      <div className={`min-h-0 flex-1 overflow-y-auto pr-1 ${s.jarak}`}>
        {alerts.length === 0 ? (
          <p className={`px-1 py-3 text-content-secondary ${s.meta}`}>Tidak ada alert aktif.</p>
        ) : (
          alerts.map((a) => <AlertCard key={a.id} a={a} wall={wall} onDetail={onDetail} />)
        )}
      </div>
    </section>
  );
}
