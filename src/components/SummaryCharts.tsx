'use client';

import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

/**
 * Grafik Summary Dashboard (PRD §9).
 *
 * Warna mengikuti makna severity, bukan palet dekoratif — mata yang terlatih
 * membaca merah sebagai kritis tidak boleh dibingungkan (UIUX §7, §10).
 */

const WARNA = {
  critical: '#E24B4A',
  warning: '#EF9F27',
  brand: '#1D9E75',
};

// Latar solid, bukan glass: sumbu dan label harus tetap terbaca (UIUX §4).
function Panel({ judul, anak }: { judul: string; anak: React.ReactNode }) {
  return (
    <section className="rounded-card bg-surface-elevated p-5">
      <h2 className="mb-4 text-lg font-medium">{judul}</h2>
      <div className="h-72">{anak}</div>
    </section>
  );
}

const sumbu = {
  stroke: 'var(--text-secondary)',
  tick: { fontSize: 12 },
  tickLine: false,
};

const tooltip = {
  background: 'var(--surface-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 12,
  color: 'var(--text-primary)',
  fontSize: 13,
};

export function TrenHarian({ data }: { data: { tanggal: string; kritis: number; peringatan: number; total: number }[] }) {
  return (
    <Panel
      judul="Tren Harian"
      anak={
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
            <XAxis dataKey="tanggal" {...sumbu} />
            <YAxis {...sumbu} allowDecimals={false} />
            <Tooltip contentStyle={tooltip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="total" name="Total kejadian" stroke={WARNA.brand} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="kritis" name="Kritis" stroke={WARNA.critical} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="peringatan" name="Peringatan" stroke={WARNA.warning} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      }
    />
  );
}

export function PerJenis({ data }: { data: { nama: string; jumlah: number }[] }) {
  return (
    <Panel
      judul="Kejadian per Jenis Alert"
      anak={
        <ResponsiveContainer width="100%" height="100%">
          {/* Batang horizontal: nama jenis panjang dan akan saling tumpang
              tindih kalau ditaruh di sumbu X. */}
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 40, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" horizontal={false} />
            <XAxis type="number" {...sumbu} allowDecimals={false} />
            <YAxis type="category" dataKey="nama" {...sumbu} width={130} />
            <Tooltip contentStyle={tooltip} cursor={{ fill: 'var(--brand-primary-soft)' }} />
            <Bar dataKey="jumlah" name="Kejadian" radius={[0, 6, 6, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={
                    /speed|overspeed|fatigue|fuel_theft/.test(d.nama)
                      ? WARNA.critical
                      : /idle|parking/.test(d.nama)
                      ? WARNA.warning
                      : WARNA.brand
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      }
    />
  );
}

export function PerCabang({ data }: { data: { nama: string; jumlah: number }[] }) {
  return (
    <Panel
      judul="Kejadian per Cabang"
      anak={
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
            <XAxis dataKey="nama" {...sumbu} />
            <YAxis {...sumbu} allowDecimals={false} />
            <Tooltip contentStyle={tooltip} cursor={{ fill: 'var(--brand-primary-soft)' }} />
            <Bar dataKey="jumlah" name="Kejadian" fill={WARNA.brand} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      }
    />
  );
}
