# Deploy ACM ke Vercel & Mengaktifkan Scheduler

Tujuan dokumen ini satu: menutup bagian terakhir arsitektur yang belum berjalan — **`pg_cron` → `pg_net` → aplikasi**.

Semua bagian lain sudah terverifikasi berjalan pada project Supabase BJU: skema, RLS, dedup harian, polling, enrichment master data, dan Realtime. Yang belum hanyalah pemicunya, karena `pg_net` berjalan di server Supabase dan tidak bisa menjangkau `localhost` — jadi aplikasi memang harus punya alamat publik lebih dulu.

```
pg_cron  ──tiap 5 menit──►  pg_net  ──HTTPS──►  https://<domain>/api/internal/poll/<id>
   ▲                                                          │
   └── jadwal dibuat otomatis oleh trigger reschedule          ▼
       saat konfigurasi sumber berubah                   Node.js: ambil → normalisasi → dedup
```

Dua hal yang harus cocok agar rantai ini nyambung:

1. `app_settings.app_base_url` di database = domain Vercel Anda
2. `ACM_INTERNAL_SECRET` di Vercel = `app_settings.internal_secret` di database

Kalau salah satu meleset, `pg_cron` tetap memanggil setiap 5 menit **tanpa keluhan apa pun** — `pg_net` tidak melaporkan kegagalan ke tempat yang dilihat operator. Karena itu langkah 5 menguji dulu, baru menyimpan.

---

## Langkah 1 — Push repo ke GitHub

Repo git sudah diinisialisasi di folder ini, dan `.gitignore` sudah memastikan `.env.local` tidak ikut ter-commit.

```bash
git add -A
git commit -m "ACM Fase 1: skema, poller, dashboard realtime"
gh repo create acm-bju --private --source=. --push
```

Tanpa `gh` CLI: buat repo private lewat github.com, lalu

```bash
git remote add origin https://github.com/<akun>/<repo>.git
git branch -M main
git push -u origin main
```

> **Wajib private.** Repo ini memuat endpoint TMS EASYGO, struktur master data armada BJU, dan dokumen internal. Tidak ada token di dalamnya (sudah dibersihkan), tapi isinya tetap bukan konsumsi publik.

## Langkah 2 — Import ke Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → pilih repo tadi
2. Framework otomatis terdeteksi **Next.js** — biarkan semua setelan build apa adanya
3. **Jangan klik Deploy dulu.** Isi environment variable lebih dulu (langkah 3), supaya deploy pertama tidak langsung gagal.

## Langkah 3 — Environment Variables di Vercel

Buka **Settings → Environment Variables**, isi lima berikut untuk ketiga environment (Production, Preview, Development). Nilainya persis sama dengan `.env.local` di mesin Anda:

| Nama | Sumber nilai |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://jjcharnarhsvunfdcjzd.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key |
| `ACM_ENCRYPTION_KEY` | dari `.env.local` — **harus sama persis** |
| `ACM_INTERNAL_SECRET` | dari `.env.local` — **harus sama persis** |

Cara cepat menyalinnya (nilainya tidak perlu diketik ulang):

```bash
grep -E '^(ACM_ENCRYPTION_KEY|ACM_INTERNAL_SECRET)=' .env.local
```

> **`ACM_ENCRYPTION_KEY` tidak boleh berbeda dari yang dipakai saat seed.** Token EASYGO sudah tersimpan terenkripsi dengan kunci itu. Kunci yang berbeda berarti token tidak bisa didekripsi, dan setiap polling akan gagal dengan galat dekripsi — bukan dengan pesan "kunci salah" yang jelas.
>
> `EASYGO_TOKEN` **tidak perlu** dimasukkan ke Vercel. Aplikasi tidak pernah membacanya; ia hanya dipakai skrip seed di mesin lokal. Aplikasi membaca token dari database dalam bentuk terenkripsi.

Lalu klik **Deploy**. Catat domain produksinya, misalnya `https://acm-bju.vercel.app`.

## Langkah 4 — Matikan Deployment Protection

Ini penyebab kegagalan paling sering, dan gejalanya menyesatkan.

**Settings → Deployment Protection → Vercel Authentication → Disabled** (untuk Production).

Kalau dibiarkan menyala, setiap permintaan dari `pg_net` dijawab **halaman login HTML Vercel**, bukan endpoint kita. Aplikasi tidak pernah dipanggil, `polling_logs` tetap kosong, dan tidak ada satu pun pesan galat di mana pun — persis pola kegagalan senyap yang sama seperti tiga bug sebelumnya.

Endpoint internalnya sendiri tetap aman tanpa proteksi Vercel: ia mewajibkan header `x-acm-internal` yang dibandingkan dengan waktu tetap, dan langkah 5 secara khusus menguji bahwa permintaan tanpa rahasia memang ditolak 401.

## Langkah 5 — Arahkan pg_cron ke aplikasi

Dari mesin lokal, satu perintah:

```bash
npm run set:baseurl https://acm-bju.vercel.app
```

Skrip ini **menguji dulu, menyimpan belakangan**:

1. Memanggil endpoint **tanpa** rahasia → harus dijawab `401`
2. Memanggil **dengan** rahasia → harus dijawab `200` beserta hasil polling sungguhan
3. Baru kemudian menyimpan `app_base_url`

Kalau gagal, pesannya langsung menunjuk penyebabnya (Deployment Protection masih menyala, atau `ACM_INTERNAL_SECRET` di Vercel tidak sama).

## Langkah 6 — Buktikan scheduler benar-benar berjalan

Tunggu sekitar 6 menit **tanpa menjalankan `npm run poll`**, lalu:

```bash
npm run verify:cron
```

Skrip ini tidak sekadar mengecek ada tidaknya log. Ia melihat **jeda antar polling**: kalau ada baris `polling_logs` berjarak rapi ~300 detik padahal tidak ada yang menjalankan skrip manual, satu-satunya yang bisa membuatnya adalah `pg_cron`. Itulah buktinya.

---

## Kalau macet

**Cek job-nya sudah terbentuk** (SQL Editor):

```sql
select jobname, schedule, active from cron.job order by jobname;
```

Harus ada dua baris `poll_source_<uuid>` dengan jadwal `*/5 * * * *`, plus `acm_rollup_daily`, `acm_purge_old`, dan `acm_keepalive`.

**Lihat apa yang sebenarnya dijawab server** — ini tempat paling berguna saat rantainya diam:

```sql
select id, status_code, left(content, 300) as content, created
  from net._http_response
 order by created desc limit 10;
```

| Yang terlihat | Artinya |
|---|---|
| Tidak ada baris sama sekali | `pg_cron` belum jalan, atau `app_base_url` masih placeholder |
| `status_code` 401 + JSON | Rahasia di Vercel ≠ rahasia di database |
| HTML berisi "Authentication" | Deployment Protection masih menyala (langkah 4) |
| `status_code` 404 | Domain benar tapi path salah, atau deploy gagal |
| `status_code` NULL + `error_msg` "SSL connect error" | Kegagalan di lapis koneksi — lihat catatan di bawah |
| `status_code` 200 | Rantai nyambung — periksa `polling_logs` untuk hasilnya |

### "SSL connect error" — teramati di produksi, 2026-09-07

Pada dua siklus pertama setelah `app_base_url` diisi (04:00 dan 04:05 WIB), **keempat panggilan `pg_net` gagal** dengan `error_msg = 'SSL connect error'` dan `status_code` kosong. Mulai 04:10 semuanya normal, dan tetap normal sesudahnya — tanpa ada yang diubah.

Gagalnya terjadi **sebelum permintaan sampai ke Vercel**, jadi aplikasi tidak pernah dijalankan. Dugaan terkuat: sertifikat TLS domain Vercel yang baru dibuat belum sepenuhnya siap saat panggilan pertama terjadi.

Kalau ini muncul pada deploy baru, tunggu 10–15 menit sebelum menyimpulkan ada yang salah. Kalau masih berlanjut setelah itu, barulah periksa domain dan sertifikatnya.

### Yang membuat kejadian itu penting

Empat siklus polling gagal total, dan **ACM tidak mencatat apa pun**:

| Tempat yang biasa dicek | Isinya saat kejadian |
|---|---|
| `polling_logs` | Kosong — tidak ada baris untuk slot 04:00 dan 04:05 |
| `alert_sources.consecutive_failures` | `0` |
| `alert_sources.last_error` | `null` |
| Modul Kesehatan API (rancangan awal) | **Hijau sempurna** |

Sebabnya ada di desain: `polling_logs` ditulis oleh aplikasi, sehingga kegagalan yang terjadi **sebelum aplikasi berjalan** tidak mungkin tercatat di sana. Satu-satunya yang tahu adalah `net._http_response`.

Karena itu Modul Kesehatan API tidak boleh hanya membaca `polling_logs`. Ia wajib menambahkan dua hal:

1. **Deteksi kebasian** — sumber dinyatakan tidak sehat kalau `last_success_at` lebih tua dari sekitar 2,5× interval polling, terlepas dari `consecutive_failures`. Ambangnya jangan terlalu longgar: dengan ambang 3× interval (900 detik), gangguan dua siklus seperti di atas (600 detik) justru lolos tanpa terdeteksi.
2. **Membaca `net._http_response`** — inilah satu-satunya sumber kebenaran untuk kegagalan di lapis transport (TLS, DNS, timeout koneksi).

**Kalau alert masuk database tapi dashboard diam:** itu bukan soal scheduler. Realtime tunduk pada RLS, jadi dashboard wajib memakai sesi login. Jalankan `npm run verify:realtime` untuk memastikan jalur Realtime-nya sendiri sehat.

---

## Sesudah ini

`app_settings.internal_secret` sekarang memegang rahasia produksi. Kalau kelak diganti, ia harus diganti **di dua tempat sekaligus** — database dan environment variable Vercel — karena keduanya dibandingkan langsung. Mengganti salah satu saja akan menghentikan seluruh polling tanpa pesan galat.
