'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { AlertFeed, type Alert } from '@/components/AlertFeed';
import { EventChart } from '@/components/EventChart';

/**
 * Dashboard Wall Display (UIUX §7).
 *
 * Tata letak: grafik di kiri, feed realtime di kanan, topbar glass mengambang.
 * Tanpa toggle dark/light — route ini selalu gelap supaya operator tidak
 * tidak sengaja mengubah mode di layar bersama (UIUX §6).
 */

export default function DashboardPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    // Muatan awal. Realtime hanya mengirim perubahan sejak saat berlangganan,
    // jadi tanpa ini layar akan kosong sampai kebetulan ada alert baru.
    supabase
      .from('alerts')
      .select(
        'id, vhcid, alert_type, severity, no_plat, cabang, group_project, occurrence_count, last_seen_at, status',
      )
      .neq('status', 'closed')
      .order('last_seen_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setAlerts((data as Alert[]) ?? []);
        setLoading(false);
      });
  }, []);

  const critical = alerts.filter((a) => a.severity === 'critical').length;
  const totalEvents = alerts.reduce((n, a) => n + a.occurrence_count, 0);
  const units = new Set(alerts.map((a) => a.vhcid).filter(Boolean)).size;

  return (
    // Safe zone: banyak TV komersial meng-crop tepi layar (UIUX §8).
    <main className="wall-safe flex h-screen flex-col gap-4 bg-surface-base">
      <header className="glass flex items-center justify-between rounded-topbar px-6 py-4">
        <div>
          <h1 className="text-2xl font-medium">Alert Centre Monitoring</h1>
          <p className="text-sm text-content-secondary">PT. Bumi Jasa Utama</p>
        </div>

        <div className="flex gap-8">
          <Stat label="Alert aktif" value={alerts.length} />
          <Stat label="Kejadian hari ini" value={totalEvents} />
          <Stat label="Unit terdampak" value={units} />
          <Stat label="Kritis" value={critical} tone="critical" />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <EventChart alerts={alerts} />

        <div className="min-h-0 rounded-card bg-surface-base">
          {loading ? (
            <p className="p-4 text-content-secondary">Memuat…</p>
          ) : (
            <AlertFeed initial={alerts} />
          )}
        </div>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'critical';
}) {
  return (
    <div className="text-right">
      <p
        className={`font-mono text-3xl font-medium ${
          tone === 'critical' && value > 0 ? 'text-severity-critical' : ''
        }`}
      >
        {value}
      </p>
      <p className="text-xs text-content-secondary">{label}</p>
    </div>
  );
}
