'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatClock, BUSINESS_TZ_LABEL, BUSINESS_TIMEZONE } from '@/lib/time';
import { Modal } from './Modal';

/**
 * Detail satu alert, termasuk payload asli dari API sumber.
 *
 * `raw_payload` sengaja TIDAK ikut dimuat bersama feed. Isinya objek JSON penuh
 * per alert, dan feed menyimpan 100 baris sekaligus — memuat semuanya di awal
 * akan memperberat wall display demi data yang hampir tidak pernah dibuka.
 * Karena itu diambil saat dibutuhkan saja.
 */

export function AlertDetail({ alertId, onClose }: { alertId: string; onClose: () => void }) {
  const [row, setRow] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .from('alerts')
      .select('*')
      .eq('id', alertId)
      .single()
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setRow(data);
      });
  }, [alertId]);

  const raw = (row?.raw_payload ?? {}) as Record<string, any>;

  // Koordinat dari kolom ternormalisasi lebih dulu; payload asli jadi cadangan
  // kalau normalisasi gagal menemukannya.
  const lat = num(row?.lat) ?? num(raw.lat);
  const long = num(row?.long) ?? num(raw.lon) ?? num(raw.long);

  const namaUnit = row?.no_plat ?? row?.vhcid ?? 'alert';

  return (
    <Modal judul={`Detail alert ${namaUnit}`} onClose={onClose}>
      <>
        {/* role=alert supaya pembaca layar mengumumkan kegagalan, bukan hanya
            memperlihatkannya (UX §8 aria-live-errors). */}
        {error && (
          <p role="alert" className="rounded-input bg-severity-critical p-3 text-white">
            {error}
          </p>
        )}

        {!row && !error && (
          <div className="space-y-3" aria-live="polite" aria-busy="true">
            <span className="sr-only">Memuat detail alert…</span>
            <div className="skeleton h-8 w-56" />
            <div className="skeleton h-4 w-40" />
            <div className="skeleton h-24 w-full" />
          </div>
        )}

        {row && (
          <>
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-2xl font-medium">{row.no_plat ?? row.vhcid ?? '—'}</p>
                <p className="font-mono text-sm text-content-secondary">
                  {row.vhcid ?? 'VHCID tidak diketahui'}
                </p>
                <p className="mt-1 font-medium">{String(row.alert_type).replace(/_/g, ' ')}</p>
              </div>

              <div className="flex items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-sm font-medium ${SEV[row.severity] ?? 'bg-severity-unknown text-white'}`}>
                  {row.severity}
                </span>
                <button
                  onClick={onClose}
                  className="rounded-btn border border-line px-3 py-1.5 text-sm text-content-secondary hover:border-brand hover:text-content-primary"
                >
                  Tutup
                </button>
              </div>
            </header>

            {/* Nilai yang paling dicari operator, diangkat ke atas supaya tidak
                perlu menyisir JSON mentah di bawah. */}
            <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Merah dan diperbesar: kecepatan adalah pelanggarannya
                  sendiri, bukan detail pendukung. Konsisten dengan tampilan
                  di feed. */}
              <Item label="Kecepatan" nilai={raw.speed != null ? `${raw.speed} km/jam` : null} tekan kritis />
              <Item label="Ambang batas" nilai={raw.speed_flag_value != null ? `${raw.speed_flag_value} km/jam` : null} />
              <Item label="Keterangan" nilai={raw.event_text ?? raw.ket_notif} />
              <Item label="Arah" nilai={raw.direction} />
              <Item label="Durasi bergerak" nilai={raw.durasi_moving} />
              <Item label="Durasi berhenti" nilai={raw.durasi_stop} />
              <Item label="Pengemudi" nilai={raw.driver_nm} />
              <Item label="Perusahaan" nilai={raw.company_nm} />
              <Item label="Nomor GPS" nilai={raw.gps_sn} mono />
            </section>

            <section className="mt-6 rounded-input bg-surface-elevated p-4">
              <h3 className="mb-2 text-sm font-medium text-content-secondary">Lokasi Kejadian</h3>

              {raw.addr && <p className="mb-3">{raw.addr}</p>}
              {raw.geo_location_nm && (
                <p className="mb-3 text-sm text-content-secondary">Geofence: {raw.geo_location_nm}</p>
              )}

              {lat != null && long != null ? (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${lat},${long}`}
                  target="_blank"
                  // noopener wajib: tanpa itu, halaman tujuan bisa mengakses
                  // window.opener dan mengarahkan ulang tab dashboard.
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-btn bg-brand px-4 py-2 font-mono text-sm font-medium text-white transition-colors hover:bg-brand-hover"
                >
                  {lat.toFixed(6)}, {long.toFixed(6)}
                  <span aria-hidden>↗</span>
                  <span className="sr-only">Buka di Google Maps (tab baru)</span>
                </a>
              ) : (
                <p className="text-content-secondary">Koordinat tidak tersedia pada kejadian ini.</p>
              )}
            </section>

            <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Item label="Status" nilai={row.status} />
              <Item label="Jumlah kejadian" nilai={`${row.occurrence_count}× hari ini`} />
              <Item label="Cabang" nilai={row.cabang ?? 'unit belum terdaftar'} />
              <Item label="Project" nilai={row.group_project} />
              <Item label={`Pertama terlihat (${BUSINESS_TZ_LABEL})`} nilai={formatClock(row.first_seen_at)} mono />
              <Item label={`Terakhir terlihat (${BUSINESS_TZ_LABEL})`} nilai={formatClock(row.last_seen_at)} mono />
              <Item label="Waktu kejadian di API" nilai={raw.gps_time} mono />
              <Item label="Tanggal dedup harian" nilai={row.occurrence_date} mono />
            </section>

            {row.close_note && (
              <p className="mt-4 rounded-input bg-surface-elevated p-3 text-sm">
                <span className="text-content-secondary">Catatan penutupan: </span>
                {row.close_note}
              </p>
            )}

            {/* Payload asli disimpan apa adanya untuk audit (PRD §6.3). Ditaruh
                paling bawah dan terlipat: berguna saat menelusuri masalah,
                tapi bukan yang dicari saat menangani alert. */}
            <details className="mt-6">
              <summary className="cursor-pointer text-sm text-content-secondary">
                Payload asli dari API sumber
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-input bg-surface-elevated p-3 text-xs">
                {JSON.stringify(raw, null, 2)}
              </pre>
            </details>

            <p className="mt-4 text-xs text-content-secondary">
              Seluruh waktu ditampilkan dalam {BUSINESS_TZ_LABEL} ({BUSINESS_TIMEZONE}).
            </p>
          </>
        )}
      </>
    </Modal>
  );
}

const SEV: Record<string, string> = {
  critical: 'bg-severity-critical text-white',
  warning: 'bg-severity-warning text-black',
  info: 'bg-severity-info text-white',
};

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Field yang kosong disembunyikan — kolom API berbeda-beda per jenis alert. */
function Item({
  label, nilai, mono, tekan, kritis,
}: {
  label: string; nilai: unknown; mono?: boolean; tekan?: boolean; kritis?: boolean;
}) {
  if (nilai == null || nilai === '') return null;
  return (
    <div>
      <p className="text-xs text-content-secondary">{label}</p>
      <p
        className={`${mono ? 'font-mono text-sm' : ''} ${tekan ? 'text-2xl font-medium' : ''} ${
          kritis ? 'font-mono text-severity-critical' : ''
        }`}
      >
        {String(nilai)}
      </p>
    </div>
  );
}
