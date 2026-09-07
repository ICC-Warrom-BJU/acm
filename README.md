# ACM — Alert Centre Monitoring

Konsolidasi alert armada dari API TMS EASYGO ke satu dashboard realtime untuk control room BJU.

Dokumen sumber ada di [docs/](docs/). Baca [docs/FINDINGS_API_M0.md](docs/FINDINGS_API_M0.md) lebih dulu — isinya hasil investigasi API sungguhan yang mengoreksi beberapa asumsi di PRD dan API_LIST.

---

## Yang sudah jadi

| Bagian | Status |
|---|---|
| Investigasi API (TASKS Milestone 0) | Selesai, terverifikasi terhadap API produksi |
| Skema database + index + dedup harian | Selesai (`supabase/migrations/`) |
| RLS 3 role + scope cabang | Selesai |
| Scheduler `pg_cron` + reschedule otomatis | Selesai |
| Endpoint polling generik + normalisasi | Selesai |
| Master data jenis notifikasi + penemuan otomatis | Selesai (backend; halaman UI-nya menyusul di Milestone 2) |
| Dashboard wall display (feed + grafik realtime) | Selesai |
| Konfigurasi sumber lewat UI, master data, bulk close, heatmap, summary, export | Belum (Milestone 2–4) |

## Setup

### 1. Database

Jalankan berkas di `supabase/migrations/` **berurutan** lewat SQL Editor Supabase:

```
0001_schema.sql        tabel inti
0002_indexes.sql       index + unique index dedup harian
0003_rls.sql           RLS policy per role
0004_scheduler.sql     pg_cron, pg_net, reschedule, rollup, purge
0005_upsert_alerts.sql dedup atomik
0006_alert_type_master.sql master data jenis notifikasi + penemuan otomatis
```

Lalu isi dua pengaturan runtime:

```sql
update public.app_settings set value = 'https://<domain-vercel-anda>' where key = 'app_base_url';
update public.app_settings set value = '<nilai ACM_INTERNAL_SECRET>'   where key = 'internal_secret';
```

`internal_secret` harus **sama persis** dengan env `ACM_INTERNAL_SECRET` — itulah yang dipakai `pg_cron` untuk memanggil endpoint internal.

Aktifkan Realtime untuk tabel `alerts` (Database → Replication), tanpa itu feed tidak akan bergerak.

### 2. Environment

```bash
cp .env.example .env.local
```

Isi nilainya. Untuk dua rahasia:

```bash
openssl rand -base64 32   # ACM_ENCRYPTION_KEY
openssl rand -hex 32      # ACM_INTERNAL_SECRET
```

> `ACM_ENCRYPTION_KEY` tidak boleh berubah setelah ada token tersimpan — token lama tidak akan bisa didekripsi lagi dan setiap sumber harus dikonfigurasi ulang.

### 3. Seed sumber alert

```bash
node --env-file=.env.local scripts/seed-sources.mjs
```

Trigger `reschedule_alert_source` otomatis membuat job `pg_cron`-nya. Tidak ada langkah manual tambahan — mengubah interval atau menonaktifkan sumber lewat UI nanti juga langsung berlaku.

### 4. Jalankan

```bash
npm run dev
```

## Memverifikasi pipeline tanpa database

```bash
node scripts/verify-pipeline.mjs
```

Memanggil API EASYGO sungguhan dan menjalankan logika normalisasi yang sama persis dengan yang dipakai poller. Berguna saat menambah sumber baru atau saat curiga ada perubahan di sisi API.

## Catatan arsitektur yang tidak terlihat dari kode

**Window polling sengaja tumpang tindih.** Interval 300 detik dengan lookback 900 detik. Tanpa tumpang tindih, kejadian yang tercatat di API tepat setelah satu polling selesai akan lolos dari polling berikutnya. Duplikat yang timbul diserap oleh dedup harian di database, jadi biayanya nyaris nol.

**Dedup dijamin oleh unique index, bukan oleh kode aplikasi.** Karena window tumpang tindih, dua siklus bisa memproses kejadian yang sama nyaris bersamaan. Pola "cek dulu, lalu insert" punya lubang balapan di situ.

**Zona waktu window request berbeda per endpoint.** `speed_flag` membaca UTC, `Notifikasi/Operation` membaca WIB. Offset yang salah tidak menghasilkan error — API tetap menjawab `success` untuk rentang yang keliru. Karena itu `time_window_offset_hours` dikonfigurasi per sumber. Lihat FINDINGS §3.1.

**Keberhasilan polling dinilai dari `ResponseCode`, bukan status HTTP.** API EASYGO selalu menjawab HTTP 200, termasuk saat token ditolak.

**Ada tiga zona waktu berbeda di sistem ini, dan ketiganya sengaja dipisah.** Penyimpanan selalu UTC. Zona waktu window request milik masing-masing API (`alert_sources.time_window_offset_hours`), bukan milik BJU. Zona waktu bisnis — jam di layar dan batas hari untuk dedup — adalah WITA, terpusat di `src/lib/time.ts`. Tidak ada fungsi waktu yang punya offset default: `parseTimestamp` dan `formatEasygoTime` mewajibkan offset diisi eksplisit, karena default di sini akan menyembunyikan kesalahan alih-alih mencegahnya.

## Menambah atau mengubah jenis notifikasi

Jenis alert dari endpoint berbagi (`Notifikasi/Operation`) dipetakan lewat tabel `alert_type_master`, bukan lewat kode.

Setiap polling mencatat setiap nilai `tipe_notif` yang muncul. Jenis yang belum dikenal otomatis masuk sebagai baris **nonaktif tanpa `alert_type`**, lengkap dengan contoh payload dan hitungan kemunculan. Untuk mengaktifkannya, isi `alert_type` lalu set `is_active = true`.

```sql
-- Jenis yang terdeteksi tapi belum ditangani
select notif_value, seen_count, last_seen_at, sample_payload
  from public.unmapped_notif_types;
```

Praktisnya untuk fatigue driving: begitu pihak EASYGO memastikan jenis mana yang mewakilinya — atau begitu mereka menambahkan jenis baru — jenis itu akan muncul sendiri di daftar di atas. Cukup beri `alert_type = 'fatigue_driving'` dan aktifkan. Tidak ada perubahan kode, tidak ada deploy ulang.

Polling tidak pernah menimpa kolom yang diisi manusia (`alert_type`, `is_active`, `label`, `severity`, `notes`) — ia hanya memperbarui statistik kemunculan.

## Yang masih menunggu keputusan

Lihat tabel status di [FINDINGS §8](docs/FINDINGS_API_M0.md). Tidak ada lagi yang memblokir Milestone 3: pemetaan jenis kini berupa master data, jadi nama jenis fatigue yang belum pasti bisa diselesaikan lewat UI kapan pun tanpa menyentuh kode. Yang tersisa bersifat penyetelan — ambang severity untuk `speed_flag`, dan apakah 4 jenis di luar lingkup akan diaktifkan.
