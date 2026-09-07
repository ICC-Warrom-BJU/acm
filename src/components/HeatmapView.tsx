'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

export interface Titik {
  lat: number;
  long: number;
  bobot: number;
}

/**
 * Heatmap pelanggaran (PRD §9, UIUX).
 *
 * Leaflet + leaflet.heat: ringan dan tanpa API key berbayar (PRD §5.1).
 *
 * Diimpor secara dinamis di sisi klien karena Leaflet menyentuh `window` saat
 * modulnya dimuat — mengimpornya di tingkat atas akan menggagalkan build
 * Next.js pada tahap prerender.
 */
export function HeatmapView({ titik }: { titik: Titik[] }) {
  const wadah = useRef<HTMLDivElement>(null);
  const peta = useRef<any>(null);
  const layer = useRef<any>(null);

  useEffect(() => {
    let batal = false;

    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet.heat');
      if (batal || !wadah.current) return;

      if (!peta.current) {
        peta.current = L.map(wadah.current, {
          // Pusat awal di Sulawesi Selatan — sebagian besar armada BJU ada di
          // sana. Kalau ada data, peta langsung disesuaikan ke sebarannya.
          center: [-4.0, 119.5],
          zoom: 6,
          scrollWheelZoom: true,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
          maxZoom: 18,
        }).addTo(peta.current);
      }

      if (layer.current) {
        peta.current.removeLayer(layer.current);
        layer.current = null;
      }

      if (titik.length === 0) return;

      const data = titik.map((t) => [t.lat, t.long, t.bobot]);
      layer.current = (L as any).heatLayer(data, {
        radius: 22,
        blur: 18,
        maxZoom: 12,
        // Gradien mengikuti makna severity: hijau aman, kuning peringatan,
        // merah kritis. Bukan palet acak (UIUX §10).
        gradient: { 0.2: '#1D9E75', 0.5: '#EF9F27', 0.9: '#E24B4A' },
      }).addTo(peta.current);

      // Sesuaikan pandangan ke sebaran data. Tanpa ini, kejadian yang semuanya
      // di Kalimantan akan tampak kosong karena peta terpaku di Sulawesi.
      const bounds = L.latLngBounds(titik.map((t) => [t.lat, t.long] as [number, number]));
      if (bounds.isValid()) peta.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
    })();

    return () => { batal = true; };
  }, [titik]);

  useEffect(() => {
    return () => {
      if (peta.current) {
        peta.current.remove();
        peta.current = null;
      }
    };
  }, []);

  return (
    <div className="relative">
      {/* Latar solid di balik peta: ubin peta butuh waktu memuat, dan area
          transparan sementara terlihat seperti halaman rusak. */}
      <div ref={wadah} className="h-[70vh] w-full rounded-card bg-surface-elevated" />
      {titik.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-card bg-surface-elevated px-6 py-4 text-content-secondary">
            Tidak ada kejadian berkoordinat pada rentang ini.
          </p>
        </div>
      )}
    </div>
  );
}
