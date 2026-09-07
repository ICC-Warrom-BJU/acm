'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AlertFeed, type Alert } from './AlertFeed';
import { EventChart } from './EventChart';
import { UserMenu } from './UserMenu';

/**
 * Dashboard Wall Display (UIUX §7).
 *
 * Grafik di kiri, feed realtime di kanan, topbar glass mengambang.
 * Route ini selalu gelap tanpa toggle — supaya operator tidak tidak sengaja
 * mengubah mode di layar bersama (UIUX §6).
 */
export function Dashboard({
  name,
  role,
  isStaff,
}: {
  name: string;
  role: string;
  isStaff: boolean;
}) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    // Muatan awal. Realtime hanya mengirim perubahan sejak saat berlangganan,
    // jadi tanpa ini layar kosong sampai kebetulan ada alert baru.
    supabase
      .from('alerts')
      .select(
        // raw_payload->speed: satu field saja, bukan seluruh payload.
        'id, vhcid, alert_type, severity, no_plat, cabang, group_project, occurrence_count, last_seen_at, status, speed:raw_payload->speed',
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
      <header className="glass flex items-center justify-between gap-6 rounded-topbar px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-medium">Alert Centre Monitoring</h1>
          <p className="text-sm text-content-secondary">PT. Bumi Jasa Utama</p>
        </div>

        <div className="flex items-center gap-8">
          <Stat label="Alert aktif" value={alerts.length} />
          <Stat label="Kejadian hari ini" value={totalEvents} />
          <Stat label="Unit terdampak" value={units} />
          <Stat label="Kritis" value={critical} tone="critical" />
        </div>

        <div className="flex items-center gap-4">
          {/* Modul konfigurasi tidak ditampilkan sama sekali untuk Management —
              mereka memang tidak punya akses (PRD §4), jadi menampilkan tautan
              yang pasti ditolak hanya membingungkan. */}
          <nav className="flex gap-1 text-sm">
            <NavLink href="/antrian">Antrian</NavLink>
            <NavLink href="/ringkasan">Ringkasan</NavLink>
            <NavLink href="/heatmap">Heatmap</NavLink>
            <NavLink href="/master-unit">Master Unit</NavLink>
            {isStaff && (
              <>
                <NavLink href="/kesehatan">Kesehatan API</NavLink>
                <NavLink href="/sumber">Sumber</NavLink>
                <NavLink href="/jenis-alert">Jenis Alert</NavLink>
              </>
            )}
          </nav>
          <UserMenu name={name} role={role} />
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

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-btn px-3 py-1.5 text-content-secondary transition-colors hover:bg-brand-soft hover:text-content-primary"
    >
      {children}
    </Link>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'critical' }) {
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
