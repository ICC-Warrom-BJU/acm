# TASKS — ACM Fase 1 (Mulai dari Speed Flag)

Referensi: `PRD_ACM.md`, `API_LIST_ACM.md`, `FINDINGS_API_M0.md`

> **Status 2026-09-07:** Milestone 0, 1, dan 2 selesai dan berjalan di produksi.
> Rantai `pg_cron` → `pg_net` → Vercel → EASYGO → Supabase → Realtime sudah
> terbukti ujung ke ujung. Temuan investigasi API ada di `FINDINGS_API_M0.md`;
> langkah deploy dan diagnosisnya di `DEPLOY_ACM.md`.
>
> Berikutnya: Milestone 3 (aktivasi 3 jenis dari endpoint berbagi) dan
> Milestone 4 (bulk close, summary, heatmap, export).

Urutan di bawah disusun supaya **Speed Flag jadi vertical slice pertama yang jalan end-to-end** (dari polling sampai tampil di dashboard), sebelum menambah 3 API yang berbagi endpoint (`Notifikasi/Operation`).

---

## Milestone 0 — Investigasi & Setup Dasar

- [x] Uji panggilan langsung ke `POST /api/report/speed_flag` (Speed Flag) dengan token & body yang diberikan, untuk mendapatkan contoh response asli
- [x] Konfirmasi cara pengiriman token: header `Authorization`, header custom, atau bagian body/query
- [x] Dari contoh response Speed Flag, identifikasi nama field: VHCID, lat, long, waktu kejadian, severity (jika ada)
- [x] Konfirmasi apakah `start_time`/`stop_time` bisa dipakai untuk window pendek (mis. 5 menit terakhir) untuk kebutuhan polling berkala, bukan cuma rentang laporan panjang
- [x] Uji panggilan langsung ke `POST /api/Notifikasi/Operation` (Parking/Idle/Fatigue) untuk mendapatkan contoh response dan menemukan field pembeda 3 jenis notifikasi
- [x] Berdasarkan hasil di atas, putuskan: 1 config sumber dengan pemecahan alert_type di Node.js, atau pendekatan lain (lihat catatan di `API_LIST_ACM.md`)
- [x] Setup project Supabase (aktifkan ekstensi `pg_cron` dan `pg_net`)
- [x] Setup project Vercel + inisialisasi Next.js — ter-deploy di https://acm-iota-beige.vercel.app
- [x] Buat migrasi skema database sesuai PRD §6 (`master_vehicles`, `alert_sources`, `alerts`, `alert_daily_summary`, `polling_logs`, `user_profiles`)
- [x] Setup Supabase Auth + tabel `user_profiles` dengan 3 role (super_admin, staff_it, management)

## Milestone 1 — Speed Flag End-to-End (Vertical Slice Pertama)

- [x] Insert konfigurasi `alert_sources` untuk Speed Flag — sudah di-seed ke Supabase produksi
- [x] Bangun endpoint internal `POST /api/internal/poll/:source_id` (generik, tidak hardcode untuk Speed Flag saja) — ambil config dari DB, panggil API eksternal, ekstrak field sesuai `field_mapping`
- [x] Implementasikan logika deduplikasi harian (PRD §7.1) di endpoint internal ini
- [x] Implementasikan update `last_success_at` / `last_error` / `consecutive_failures` pada `alert_sources` setiap eksekusi
- [x] Buat fungsi `reschedule_alert_source()` + trigger di Postgres untuk auto-schedule `pg_cron` saat config berubah
- [x] Bangun halaman dashboard minimal: feed alert (kanan) + grafik jumlah event (kiri), subscribe ke Supabase Realtime untuk tabel `alerts`
- [x] Jadwalkan `pg_cron` untuk source Speed Flag dan verifikasi job berjalan sesuai interval
- [x] Verifikasi end-to-end: Realtime terbukti mengirim event ke klien (`npm run verify:realtime`); polling otomatis terbukti lewat `npm run verify:cron`

## Milestone 2 — Modul Pendukung Dasar

- [x] Halaman konfigurasi sumber API (`/sumber`) dengan token selalu masked setelah disimpan
- [x] Tombol "Test Sekarang" per sumber (`POST /api/alert-sources/:id/test`, diautentikasi sesi + role)
- [x] Modul kesehatan API (`/kesehatan`) — kartu status per sumber, log polling, **plus deteksi kebasian dan kegagalan transport `net._http_response`** (lihat DEPLOY_ACM.md: `polling_logs` saja tidak cukup)
- [x] Modul Master Data VHCID (`/master-unit`) — tabel paginated + pencarian + filter cabang/project, edit untuk staf, view-only untuk Management. Import massal sudah ada lebih dulu lewat `npm run import:vehicles` (517 unit terimpor)
- [x] RBAC ditegakkan dua lapis sesuai PRD §4 — RLS Postgres (`0003_rls.sql`) + pengecekan role di API layer (`getCurrentUser`/`isStaff` di setiap halaman & route)

## Milestone 3 — Tambah 3 API Berbagi Endpoint (Parking/Idle/Fatigue)

- [x] Mekanisme pemecahan satu endpoint jadi banyak alert_type — lewat `discriminator_path` + master data `alert_type_master`
- [x] Konfigurasi Parking Overtime, Idle Overtime, Fatigue Driving — plus Forbidden Driving. `fatigue_driving` ternyata dieja `FATIQUE` di API dan ditemukan otomatis oleh poller (FINDINGS §6.1)
- [x] Verifikasi lewat `npm run verify:split`: SATU panggilan endpoint (605 record) menghasilkan 4 alert_type sekaligus — fatigue_driving, forbidden_driving, idle_overtime, parking_overtime — tanpa jenis nonaktif yang bocor

## Milestone 4 — Modul Lanjutan

- [x] Antrian alert (`/antrian`) + acknowledge/close, termasuk bulk close berbasis filter. Baris yang sudah tertutup tidak pernah disentuh ulang agar jejak audit tidak tertimpa
- [x] Job `alert_daily_summary` — `rollup_daily()` dijadwalkan tiap jam (bukan sekali tengah malam), idempoten lewat `uq_daily_summary`
- [x] Summary Dashboard (`/ringkasan`) — tren harian, per jenis, per cabang, dan 15 unit teratas. Sumbernya `alert_daily_summary` yang permanen, bukan raw yang hanya 90 hari
- [x] Modul heatmap (`/heatmap`) — Leaflet + leaflet.heat, bobot titik memperhitungkan severity dan kejadian berulang
- [x] Export Excel/JSON (`/api/alerts/export`) dengan filter. Management dibatasi ke data ringkasan saja (PRD §4); timestamp dikonversi ke WITA karena Excel tidak menyimpan zona waktu
- [x] Import massal Master Data VHCID — `npm run import:vehicles`, pratinjau dulu sebelum `--commit`. 517 unit sudah terimpor
- [x] Job pembersihan raw > 90 hari — `purge_old_data()` harian; agregat harian sengaja tidak ikut terhapus

## Tindak Lanjut Terbuka (di luar milestone)

- [ ] **Verifikasi VHCID terhadap TMS EASYGO** — pastikan `vehicle_id` di `master_vehicles` sama persis dengan yang dipakai API. Hanya 3 dari 18 unit LJKT muncul di API dalam 12 jam; belum bisa dipastikan apakah unitnya memang tidak beroperasi atau ID-nya tidak cocok. Lihat `FINDINGS_API_M0.md` §9
- [ ] Setelah VHCID terverifikasi: pertimbangkan laporan cakupan unit per cabang (unit yang tidak mengirim data selama N hari)

## Milestone 5 — Kesiapan Rilis

- [ ] Review keamanan: enkripsi token, RLS policy per role, HTTPS enforced
- [ ] Uji beban dasar dengan volume mendekati skala nyata (1000+ unit) pada tabel `alerts` dan `master_vehicles`
- [ ] Setup job ping berkala agar proyek Supabase gratis tidak auto-pause
- [ ] Dokumentasi singkat cara menambah sumber API baru lewat UI (untuk staf non-developer)
- [ ] Go-live Fase 1 dengan 4 API: Speed Flag, Parking Overtime, Idle Overtime, Fatigue Driving

---

## Catatan

Milestone 0 adalah **blocker** untuk hampir semua milestone berikutnya — tanpa contoh response asli dari kedua endpoint, `field_mapping` dan keputusan arsitektur untuk 3 API berbagi endpoint tidak bisa difinalkan. Prioritaskan ini sebelum mulai coding modul lain.
