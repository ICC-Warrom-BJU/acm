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

- [ ] Antrian alert + acknowledge/close (single & bulk close dengan filter)
- [ ] Job harian `alert_daily_summary` (PRD §7.1)
- [ ] Summary Dashboard (mingguan/bulanan) untuk Management
- [ ] Modul heatmap (menggunakan lat/long dari alert, per catatan bahwa tiap API sudah punya koordinat sendiri)
- [ ] Export raw data ke Excel/JSON dengan filter
- [ ] Import massal Master Data VHCID (dengan preview sebelum commit)
- [ ] Job pembersihan raw data > 90 hari (retensi Fase 1)

## Milestone 5 — Kesiapan Rilis

- [ ] Review keamanan: enkripsi token, RLS policy per role, HTTPS enforced
- [ ] Uji beban dasar dengan volume mendekati skala nyata (1000+ unit) pada tabel `alerts` dan `master_vehicles`
- [ ] Setup job ping berkala agar proyek Supabase gratis tidak auto-pause
- [ ] Dokumentasi singkat cara menambah sumber API baru lewat UI (untuk staf non-developer)
- [ ] Go-live Fase 1 dengan 4 API: Speed Flag, Parking Overtime, Idle Overtime, Fatigue Driving

---

## Catatan

Milestone 0 adalah **blocker** untuk hampir semua milestone berikutnya — tanpa contoh response asli dari kedua endpoint, `field_mapping` dan keputusan arsitektur untuk 3 API berbagi endpoint tidak bisa difinalkan. Prioritaskan ini sebelum mulai coding modul lain.
