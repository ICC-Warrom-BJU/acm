'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Alert } from './AlertFeed';
import { formatHour, BUSINESS_TZ_LABEL } from '@/lib/time';

/**
 * Grafik tren event per jam (UIUX §7 kiri).
 *
 * Warna batang mengikuti warna severity, bukan warna acak — mata yang sudah
 * terlatih membaca "merah = kritis" tidak boleh dibingungkan oleh palet
 * dekoratif (UIUX §7, §10).
 */

const SEVERITY_COLOR = {
  critical: '#E24B4A',
  warning: '#EF9F27',
  info: '#1D9E75',
} as const;

export function EventChart({ alerts, wall = false }: { alerts: Alert[]; wall?: boolean }) {
  const buckets = new Map<string, { hour: string; critical: number; warning: number; info: number }>();

  // 12 jam terakhir, selalu ditampilkan penuh — termasuk jam yang nol kejadian.
  // Kalau jam kosong dihilangkan, sumbu waktu jadi tidak rata dan lonjakan
  // terlihat lebih landai dari kenyataannya.
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600_000);
    const label = formatHour(d);
    buckets.set(label, { hour: label, critical: 0, warning: 0, info: 0 });
  }

  for (const a of alerts) {
    const label = formatHour(a.last_seen_at);
    const b = buckets.get(label);
    if (b) b[a.severity] = (b[a.severity] ?? 0) + a.occurrence_count;
  }

  const data = Array.from(buckets.values());
  const fontSize = wall ? 20 : 12;

  return (
    // Latar solid, bukan glass: sumbu, label, dan garis data harus tetap
    // terbaca dari jarak jauh (UIUX §4).
    <section className="flex h-full flex-col rounded-card bg-surface-elevated p-5">
      <h2 className={`mb-4 font-medium ${wall ? 'text-3xl' : 'text-xl'}`}>
        Event per Jam · 12 Jam Terakhir ({BUSINESS_TZ_LABEL})
      </h2>

      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
            <XAxis
              dataKey="hour"
              stroke="var(--text-secondary)"
              tick={{ fontSize }}
              tickLine={false}
            />
            <YAxis
              stroke="var(--text-secondary)"
              tick={{ fontSize }}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 12,
                color: 'var(--text-primary)',
                fontSize,
              }}
              cursor={{ fill: 'var(--brand-primary-soft)' }}
            />
            <Legend wrapperStyle={{ fontSize }} />
            {/* Ditumpuk, bukan berdampingan: yang perlu dibaca sekilas dari
                jauh adalah total beban per jam, dengan komposisi severity
                sebagai informasi kedua. */}
            <Bar dataKey="critical" stackId="s" fill={SEVERITY_COLOR.critical} name="Kritis" />
            <Bar dataKey="warning" stackId="s" fill={SEVERITY_COLOR.warning} name="Peringatan" />
            <Bar
              dataKey="info"
              stackId="s"
              fill={SEVERITY_COLOR.info}
              name="Info"
              radius={[6, 6, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
