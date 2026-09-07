'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatClock, BUSINESS_TZ_LABEL } from '@/lib/time';
import { AlertDetail } from './AlertDetail';

/**
 * Feed alert realtime (UIUX §7 kanan, §9 "Item Feed Alert").
 *
 * Latar item SOLID, bukan glass. Ini bukan pilihan gaya: dari 2-4 meter,
 * transparansi + blur menurunkan kontras cukup jauh untuk membuat operator
 * salah membaca VHCID atau angka waktu (UIUX §4).
 */

export interface Alert {
  id: string;
  vhcid: string | null;
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  no_plat: string | null;
  cabang: string | null;
  group_project: string | null;
  occurrence_count: number;
  last_seen_at: string;
  status: string;
}

const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-l-severity-critical',
  warning: 'border-l-severity-warning',
  info: 'border-l-severity-info',
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-severity-critical text-white',
  warning: 'bg-severity-warning text-black',
  info: 'bg-severity-info text-white',
};

export function AlertFeed({ wall = false, initial = [] }: { wall?: boolean; initial?: Alert[] }) {
  const [alerts, setAlerts] = useState<Alert[]>(initial);
  const [live, setLive] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set(initial.map((a) => a.id)));

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    const handleRow = (payload: { new: unknown }) => {
      const row = payload.new as Alert;
      if (!row?.id) return;

      setAlerts((prev) => {
        const idx = prev.findIndex((a) => a.id === row.id);
        // Alert yang ter-dedup datang sebagai UPDATE, bukan INSERT. Ia
        // diperbarui di tempat lalu diangkat ke atas — bukan digandakan,
        // supaya feed tidak dibanjiri kejadian berulang dari unit yang sama.
        const next = idx >= 0 ? prev.filter((a) => a.id !== row.id) : prev;
        return [row, ...next].slice(0, 100);
      });
    };

    /**
     * Token sesi WAJIB didorong ke socket Realtime secara eksplisit.
     *
     * Socket-nya tidak mewarisi sesi begitu saja — tanpa setAuth ia tersambung
     * memakai anon key, lalu RLS pada `alerts` memblokir seluruh event.
     * Kegagalannya senyap total: channel tetap melaporkan SUBSCRIBED, tidak ada
     * error di mana pun, feed hanya diam selamanya. Terverifikasi langsung pada
     * project Supabase BJU, 2026-09-07.
     */
    const start = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      const token = data.session?.access_token;
      if (!token) {
        // Belum login: jangan berlangganan sama sekali. Berlangganan tanpa sesi
        // hanya menghasilkan indikator "Live" yang berbohong.
        setLive(false);
        setNeedsAuth(true);
        return;
      }

      setNeedsAuth(false);
      await supabase.realtime.setAuth(token);

      channel = supabase
        .channel('alerts-feed')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, handleRow)
        .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    };

    start();

    /**
     * Token akses Supabase kedaluwarsa dalam hitungan jam, sedangkan layar wall
     * display menyala berhari-hari. Tanpa mendorong token baru ke socket, feed
     * akan mati diam-diam di tengah malam saat token pertama habis.
     */
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
        if (!channel) start();
      }
      if (event === 'SIGNED_OUT') {
        setLive(false);
        setNeedsAuth(true);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // Audio cue untuk critical: tidak semua orang di ruangan menatap layar
  // terus-menerus, jadi visual saja tidak cukup (UIUX §8, PRD §9).
  const lastCritical = useRef<string | null>(null);
  useEffect(() => {
    const top = alerts[0];
    if (!top || top.severity !== 'critical' || top.id === lastCritical.current) return;
    if (seen.current.has(top.id)) return;
    seen.current.add(top.id);
    lastCritical.current = top.id;

    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // Browser memblokir audio sampai ada interaksi pengguna. Wall display
      // tanpa perangkat input memang tidak akan pernah berbunyi — itu bukan
      // alasan untuk menggagalkan render feed-nya.
    }
  }, [alerts]);

  const scale = wall
    ? { vhcid: 'text-4xl', type: 'text-2xl', meta: 'text-xl', badge: 'text-xl' }
    : { vhcid: 'text-2xl', type: 'text-base', meta: 'text-sm', badge: 'text-sm' };

  return (
    <section className="flex h-full flex-col gap-3 overflow-hidden">
      <header className="flex items-center justify-between px-1">
        <h2 className={`font-medium ${wall ? 'text-3xl' : 'text-xl'}`}>Alert Realtime</h2>
        <span className={`flex items-center gap-2 ${scale.meta} text-content-secondary`}>
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              live ? 'bg-severity-info' : needsAuth ? 'bg-severity-warning' : 'bg-severity-critical'
            }`}
          />
          {live ? 'Live' : needsAuth ? 'Belum login' : 'Terputus'}
        </span>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {alerts.length === 0 && (
          <p className={`px-1 py-8 text-content-secondary ${scale.meta}`}>
            Belum ada alert masuk.
          </p>
        )}

        {alerts.map((a) => (
          <article
            key={a.id}
            className={`alert-enter rounded-alert border-l-4 bg-surface-elevated p-4 ${
              SEVERITY_BORDER[a.severity] ?? 'border-l-severity-unknown'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/* VHCID & no. plat monospace: mata operator langsung
                    membedakan data identitas dari teks naratif (UIUX §3). */}
                <p className={`font-mono font-medium ${scale.vhcid} leading-tight`}>
                  {a.no_plat ?? a.vhcid ?? '—'}
                </p>
                <p className={`font-mono ${scale.meta} text-content-secondary`}>
                  {a.vhcid ?? 'VHCID tidak diketahui'}
                </p>
              </div>

              <span
                className={`shrink-0 rounded-full px-3 py-1 font-medium ${scale.badge} ${
                  SEVERITY_BADGE[a.severity] ?? 'bg-severity-unknown text-white'
                }`}
              >
                {a.severity}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className={`font-medium ${scale.type}`}>
                {a.alert_type.replace(/_/g, ' ')}
              </span>
              {a.occurrence_count > 1 && (
                <span className={`${scale.meta} text-content-secondary`}>
                  {a.occurrence_count}× hari ini
                </span>
              )}
              <span className={`font-mono ${scale.meta} text-content-secondary`}>
                {formatClock(a.last_seen_at)} {BUSINESS_TZ_LABEL}
              </span>

              {/* Opsional, bukan wajib: wall display murni tanpa perangkat
                  input tetap berfungsi penuh tanpa pernah menekan ini
                  (UIUX §8). */}
              <button
                onClick={() => setDetail(a.id)}
                className={`ml-auto rounded-btn border border-line px-2.5 py-0.5 ${scale.meta} text-content-secondary transition-colors hover:border-brand hover:text-content-primary`}
              >
                Detail
              </button>
            </div>

            <div className={`mt-1 ${scale.meta} text-content-secondary`}>
              {a.cabang || a.group_project ? (
                [a.cabang, a.group_project].filter(Boolean).join(' · ')
              ) : (
                // Unit belum terdaftar tetap tampil — operasional tidak boleh
                // terhambat oleh kelengkapan master data (PRD §7.3).
                <span className="rounded-full bg-severity-unknown/20 px-2 py-0.5 text-severity-unknown">
                  Unit belum terdaftar
                </span>
              )}
            </div>
          </article>
        ))}
      </div>

      {detail && <AlertDetail alertId={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}
