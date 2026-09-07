'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AlertLane } from './AlertLane';
import { AlertDetail } from './AlertDetail';
import { EventChart } from './EventChart';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { KOLOM_ALERT, urutkanJenis, type Alert } from '@/lib/alert';
import { buatPenyaring, type KonfigCabang } from '@/lib/visibility';

/**
 * Dashboard (UIUX §7).
 *
 * Tata letak: sidebar kiri, topbar glass mengambang, grafik kiri, lajur alert
 * kanan — satu lajur per jenis alert.
 *
 * Langganan Realtime dipusatkan di sini, bukan di tiap lajur. Kalau setiap
 * lajur berlangganan sendiri, satu dashboard akan membuka lima koneksi ke
 * server Realtime dan setiap alert baru diproses berulang kali.
 */
export function Dashboard({
  name,
  role,
  wall = false,
}: {
  name: string;
  role: string;
  wall?: boolean;
}) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [perluLogin, setPerluLogin] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [cabang, setCabang] = useState('');
  const [konfig, setKonfig] = useState<KonfigCabang[]>([]);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let batal = false;

    supabase
      .from('alerts')
      .select(KOLOM_ALERT)
      .neq('status', 'closed')
      .order('last_seen_at', { ascending: false })
      .limit(300)
      .then(({ data }) => {
        if (!batal) {
          setAlerts((data as unknown as Alert[]) ?? []);
          setLoading(false);
        }
      });

    // Aturan tampilan per cabang. Dibaca sekali saat dashboard dibuka; kalau
    // konfigurasinya diubah, halaman perlu dimuat ulang — perubahan aturan
    // tampilan bukan sesuatu yang terjadi tiap menit.
    supabase
      .from('branch_alert_config')
      .select('cabang, alert_types')
      .then(({ data }) => {
        if (!batal && data) setKonfig(data as KonfigCabang[]);
      });

    const terima = (payload: { new: unknown }) => {
      const row = payload.new as Alert;
      if (!row?.id) return;
      setAlerts((prev) => {
        // Alert yang ter-dedup tiba sebagai UPDATE, bukan INSERT. Ia diperbarui
        // di tempat lalu diangkat ke atas — bukan digandakan, supaya lajur
        // tidak dibanjiri kejadian berulang dari unit yang sama.
        const sisa = prev.filter((a) => a.id !== row.id);
        if (row.status === 'closed') return sisa;
        return [row, ...sisa].slice(0, 300);
      });
    };

    /**
     * Token sesi WAJIB didorong ke socket Realtime secara eksplisit. Tanpa
     * setAuth, socket tersambung memakai anon key dan RLS memblokir seluruh
     * event — channel tetap melaporkan SUBSCRIBED dan tidak ada error di mana
     * pun. Terverifikasi pada project Supabase BJU, 2026-09-07.
     */
    const mulai = async () => {
      const { data } = await supabase.auth.getSession();
      if (batal) return;
      const token = data.session?.access_token;
      if (!token) { setLive(false); setPerluLogin(true); return; }

      setPerluLogin(false);
      await supabase.realtime.setAuth(token);

      channel = supabase
        .channel('alerts-dashboard')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, terima)
        .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    };

    mulai();

    // Token kedaluwarsa dalam hitungan jam sedangkan wall display menyala
    // berhari-hari. Tanpa mendorong token baru, feed mati diam-diam di tengah
    // malam saat token pertama habis.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
        if (!channel) mulai();
      }
      if (event === 'SIGNED_OUT') { setLive(false); setPerluLogin(true); }
    });

    return () => {
      batal = true;
      sub.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // Audio cue untuk critical: tidak semua orang di ruangan menatap layar terus,
  // jadi visual saja tidak cukup (UIUX §8).
  const sudah = useRef<Set<string>>(new Set());
  const pertama = useRef(true);
  useEffect(() => {
    if (loading) return;
    if (pertama.current) {
      // Muatan awal tidak boleh membunyikan alarm untuk alert lama.
      alerts.forEach((a) => sudah.current.add(a.id));
      pertama.current = false;
      return;
    }
    const baru = alerts.find((a) => a.severity === 'critical' && !sudah.current.has(a.id));
    alerts.forEach((a) => sudah.current.add(a.id));
    if (!baru) return;

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
      // Peramban memblokir audio sampai ada interaksi pengguna. Wall display
      // tanpa perangkat input memang tidak akan berbunyi — itu bukan alasan
      // untuk menggagalkan render.
    }
  }, [alerts, loading]);

  const daftarCabang = useMemo(
    () => [...new Set(alerts.map((a) => a.cabang).filter(Boolean))].sort() as string[],
    [alerts],
  );

  const terfilter = useMemo(() => {
    // Dua penyaringan berbeda peran: `penyaring` adalah aturan tetap dari
    // konfigurasi cabang, `cabang` adalah pilihan sesaat operator di topbar.
    const penyaring = buatPenyaring(konfig);
    const hasil = alerts.filter(penyaring);
    return cabang ? hasil.filter((a) => a.cabang === cabang) : hasil;
  }, [alerts, cabang, konfig]);

  // Berapa yang disembunyikan aturan tampilan. Ditampilkan supaya tidak ada
  // yang mengira dashboard sedang sepi padahal alertnya sengaja disaring.
  const disembunyikan = useMemo(() => {
    const penyaring = buatPenyaring(konfig);
    const dasar = cabang ? alerts.filter((a) => a.cabang === cabang) : alerts;
    return dasar.length - dasar.filter(penyaring).length;
  }, [alerts, cabang, konfig]);

  // Lajur dibentuk dari jenis yang benar-benar ada di data, bukan daftar tetap:
  // jenis alert bisa bertambah lewat master data tanpa sentuh kode.
  const lajur = useMemo(() => {
    const per = new Map<string, Alert[]>();
    for (const a of terfilter) {
      const list = per.get(a.alert_type) ?? [];
      list.push(a);
      per.set(a.alert_type, list);
    }
    return urutkanJenis([...per.keys()]).map((jenis) => ({ jenis, list: per.get(jenis)! }));
  }, [terfilter]);

  const kritis = terfilter.filter((a) => a.severity === 'critical').length;
  const kejadian = terfilter.reduce((n, a) => n + a.occurrence_count, 0);
  const unit = new Set(terfilter.map((a) => a.vhcid).filter(Boolean)).size;

  return (
    // Safe zone 5%: banyak TV komersial meng-crop tepi layar (UIUX §8).
    <div className={`flex h-screen gap-4 bg-surface-base ${wall ? 'wall-safe' : 'p-4'}`}>
      <Sidebar role={role} ciut={wall} />

      <main className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="glass flex flex-wrap items-center justify-between gap-4 rounded-topbar px-6 py-3">
          <div className="min-w-0">
            <h1 className={`font-medium ${wall ? 'text-3xl' : 'text-2xl'}`}>
              Alert Centre Monitoring
            </h1>
            <p className={`text-content-secondary ${wall ? 'text-base' : 'text-sm'}`}>
              PT. Bumi Jasa Utama
            </p>
          </div>

          <div className={`flex items-center ${wall ? 'gap-10' : 'gap-8'}`}>
            <Stat label="Alert aktif" value={terfilter.length} wall={wall} />
            <Stat label="Kejadian" value={kejadian} wall={wall} />
            <Stat label="Unit" value={unit} wall={wall} />
            <Stat label="Kritis" value={kritis} wall={wall} tone="critical" />
          </div>

          <div className="flex items-center gap-3">
            {/* Filter cepat cabang (UIUX §9). Disaring di sisi klien dari data
                yang sudah dimuat — tanpa permintaan ulang ke server, jadi wall
                display tidak berkedip saat filternya diganti. */}
            {daftarCabang.length > 1 && (
              <select
                value={cabang}
                onChange={(e) => setCabang(e.target.value)}
                className="rounded-input border border-line bg-surface-elevated px-3 py-1.5 text-sm outline-none focus:border-brand"
              >
                <option value="">Semua cabang</option>
                {daftarCabang.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}

            {/* Status koneksi realtime (UIUX §9). */}
            {disembunyikan > 0 && (
              <span
                className="text-sm text-content-secondary"
                title="Disembunyikan oleh Konfigurasi Tampilan. Datanya tetap tersimpan dan tetap masuk laporan."
              >
                {disembunyikan} disaring
              </span>
            )}

            <span className="flex items-center gap-2 text-sm text-content-secondary">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  live ? 'bg-severity-info' : perluLogin ? 'bg-severity-warning' : 'bg-severity-critical'
                }`}
              />
              {live ? 'Live' : perluLogin ? 'Belum login' : 'Terputus'}
            </span>

            {/* Toggle mode dan menu pengguna disembunyikan di wall display —
                operator tidak boleh tidak sengaja mengubah mode atau keluar
                dari sesi di layar bersama (UIUX §6). */}
            {!wall && (
              <>
                <ThemeToggle />
                <Link
                  href="/wall"
                  title="Buka mode wall display"
                  className="rounded-btn border border-line px-3 py-1.5 text-sm text-content-secondary transition-colors hover:border-brand hover:text-content-primary"
                >
                  Wall
                </Link>
                <UserMenu name={name} role={role} />
              </>
            )}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
          <EventChart alerts={terfilter} wall={wall} />

          {loading ? (
            <div className="rounded-card bg-surface-elevated p-6 text-content-secondary">Memuat…</div>
          ) : lajur.length === 0 ? (
            <div className="rounded-card bg-surface-elevated p-6 text-content-secondary">
              Belum ada alert aktif.
            </div>
          ) : (
            // Satu lajur per jenis alert, bukan satu daftar panjang bercampur:
            // jenis yang jarang muncul tetap punya ruangnya sendiri.
            <div
              className={`grid min-h-0 gap-4 ${
                lajur.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'
              } ${lajur.length > 4 ? 'xl:grid-cols-3' : ''}`}
            >
              {lajur.map(({ jenis, list }) => (
                <AlertLane key={jenis} jenis={jenis} alerts={list} wall={wall} onDetail={setDetail} />
              ))}
            </div>
          )}
        </div>
      </main>

      {detail && <AlertDetail alertId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function Stat({
  label, value, wall, tone,
}: {
  label: string; value: number; wall: boolean; tone?: 'critical';
}) {
  return (
    <div className="text-right">
      <p
        className={`font-mono font-medium ${wall ? 'text-4xl' : 'text-3xl'} ${
          tone === 'critical' && value > 0 ? 'text-severity-critical' : ''
        }`}
      >
        {value.toLocaleString('id-ID')}
      </p>
      <p className={`text-content-secondary ${wall ? 'text-sm' : 'text-xs'}`}>{label}</p>
    </div>
  );
}
