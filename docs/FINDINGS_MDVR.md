# Hasil Investigasi — EasyGo MDVR Open API

**Tanggal uji:** 2026-09-15
**Status:** **DITAHAN** — menunggu akun/token yang cakupannya sesuai company BJU
**Belum diintegrasikan.** Tidak ada kode poller, sumber, atau migrasi untuk ini.

---

## 1. Ringkasan

API terpisah dari TMS EASYGO, khusus alarm AI dari perangkat MDVR (kamera dasbor):
ADAS (bahaya di depan), DMS (perilaku pengemudi), BSD (titik buta), dan manuver kasar.
Tiap alarm membawa bukti video/gambar.

| Item | Nilai |
|---|---|
| Base URL | `https://mdvr-openapi.easygo-gps.co.id` |
| Swagger | `/swagger/v1/swagger.json` (12 endpoint) |
| Auth | `POST /api/open/v1/auth/token` dengan `{ "api_key": "eg_live_..." }` |
| Token | JWT Bearer, **berlaku 60 menit** |
| Daftar jenis | `GET /api/open/v1/alarm-types` → 59 jenis |
| Query alarm | `POST /api/open/v1/alarms` |

API key disimpan sebagai `MDVR_API_KEY` di `.env.local` (tidak ikut repo).

## 2. Kenapa ditahan

**Cakupan device API key tidak sesuai armada BJU.** Dari 517 unit di `master_vehicles`:

| | Jumlah |
|---|---|
| Diizinkan | 455 |
| Ditolak (403 `device_not_allowed`) | 58 |
| Tidak dikenal (404 `device_not_found`) | 4 |

Lebih menentukan lagi: dari 455 unit berizin, **hanya 15 yang menghasilkan alarm** dalam 7 hari (3%), dan **440 unit diam total**. Enam cabang nol event sama sekali, termasuk LMKS dengan 137 unit berizin.

Belum bisa dipastikan apakah perangkat MDVR-nya memang belum terpasang, atau terpasang tapi tidak mengirim. Karena itu integrasinya ditahan sampai ada token yang cakupannya jelas.

## 3. Temuan yang menentukan desain integrasi nanti

### 3.1 Filter `alarm_type_id` TIDAK BERFUNGSI

Parameter ini ada di dokumentasi, tapi nilai apa pun mengembalikan nol hasil:

```
tanpa filter           -> 200 hasil (termasuk alarm_id 226)
alarm_type_id: [226]   -> 0 hasil
alarm_type_id: ["226"] -> 0 hasil
alarm_type_id: [101]   -> 0 hasil   (nilai subiao_id, sekadar memastikan)
alarm_type_id: []      -> 200 hasil
alarm_type_id: null    -> 200 hasil
```

Konsekuensinya penyaringan harus dilakukan di sisi ACM — seluruh jenis ditarik, lalu master data yang memutuskan mana yang diproses. Mekanismenya sama seperti `Notifikasi/Operation`. Layak dilaporkan ke pengelola API.

### 3.2 Penolakan device bersifat SEMUA-ATAU-TIDAK

Satu unit tak berizin di dalam array `vehicle_id` membuat **seluruh permintaan** gagal 403 — bukan hanya unit itu yang dilewati.

Ini sempat membuat skrip ekspor menghasilkan nol data tanpa galat apa pun. Poller wajib memakai batching yang memecah diri saat menerima 403, sampai unit bermasalah terisolasi. Tanpa itu, satu unit yang izinnya dicabut akan menghapus puluhan unit lain dari hasil polling secara senyap.

### 3.3 Wajib menyebut device

`sn`, `vehicle_id`, atau `nopol` — minimal salah satu harus diisi. Tidak ada mode "semua kendaraan" seperti `lstVehicleId: null` di TMS. Artinya `body_template` tidak bisa statis; daftar unit harus disuntikkan tiap polling.

### 3.4 `take` maksimum 200, tanpa laporan total

Response tidak memberi tahu berapa total yang cocok, jadi hasil tepat 200 berarti "mungkin terpotong" dan tidak ada cara memastikannya. Batching harus memecah diri pada kondisi ini juga. Teramati nyata: beberapa batch 25 unit mentok 200 pada rentang 30 hari.

### 3.5 `gps_time` tanpa zona waktu

Contoh: `"2026-09-14T15:08:32"` — tanpa `Z` maupun offset. Ini konvensi **ketiga** setelah UTC (`speed_flag`) dan `+07:00` (`Notifikasi`). Parameter `fallbackOffsetHours` di `parseTimestamp()` sudah menangani kasus ini, tapi offsetnya perlu ditetapkan per sumber.

### 3.6 Publikasi tertunda sampai bukti selesai diunggah

Seluruh 59 jenis memakai `publish_policy: AFTER_ATTACHMENTS_COMPLETE` — alarm baru muncul di API setelah video buktinya selesai diunggah. Kalau sinyal di lapangan buruk, kejadian pukul 08:00 bisa baru tersedia jauh setelahnya.

Karena itu window lookback harus jauh lebih longgar daripada TMS. Usulan: **interval 30 menit, lookback 2 jam** (tumpang tindih 4×). Besaran jedanya belum terukur dan perlu diamati beberapa hari.

### 3.7 Severity tersedia, tapi ada dua sumber yang berbeda

`/alarm-types` menyebut severity per jenis (`WARNING`/`NOTICE`), sedangkan tiap record punya `severity` sendiri (`warning`/`info`). Keduanya bisa berbeda — jenis 292 tercatat `WARNING` di daftar jenis tapi `info` di record.

**Keputusan BJU:** severity tidak diambil dari API sama sekali, melainkan diatur sendiri lewat halaman Jenis Alert. Kolom `alert_type_master.severity` yang sudah ada sudah mendukung ini tanpa perubahan kode.

## 4. Struktur L1/L2 — terkonfirmasi berbasis kecepatan

Jenis 221–238 (NOTICE) punya pasangan 251–268 (WARNING) dengan perilaku sama. Dugaan awal BJU bahwa pembedanya kecepatan **terbukti** pada 282 sampel:

| Jenis | L1 median | L2 median | L1 maks | L2 min |
|---|---|---|---|---|
| Smoking | 32 | 65 | 58 | 64 |
| Tidak fokus | 27 | 64 | 62 | 54 |
| Driver abnormal | 31 | 66 | 63 | 61 |
| Sabuk Pengaman | 32 | 67 | 60 | 57 |
| Distracted head down | 32 | 65 | 57 | 53 |

Ambang pemisah terbaik **61 km/jam**, akurasi 97,5% (7 perkecualian di zona 53–63, jadi ambangnya mungkin tidak persis 61 atau dapat dikonfigurasi per perangkat).

**Keputusan BJU:** L1 = `warning`, L2 = `critical`. L1 dan L2 dipetakan terpisah, tidak digabung.

## 5. Jenis yang dipilih BJU (belum final)

Tujuh ID disebut: **221, 222, 223, 226, 236, 251, 266**.

Catatan yang belum ditindaklanjuti: pilihan itu tidak simetris. Untuk Phone call, Smoking, dan Sabuk Pengaman hanya tingkat 1 yang diambil, sedangkan tingkat 2 — versi yang **lebih berbahaya** — tidak. Pada 7 hari data nyata:

| Pasangan | L1 | L2 | Status |
|---|---|---|---|
| Mata Terpejam | 221: 33 | 251: 1 | lengkap |
| Menguap | 236: 7 | 266: 0 | lengkap |
| Phone call | 222: 24 | **252: 2** | L2 terlewat |
| Smoking | 223: 11 | **253: 2** | L2 terlewat |
| Sabuk Pengaman | 226: 27 | **256: 10** | L2 terlewat |

Usulan: lengkapi jadi 10 ID dengan menambah **252, 253, 256**.

## 6. Beban dan bentuk data

Uji beban 2026-09-14 (satu hari penuh, 455 unit berizin):

| | |
|---|---|
| Permintaan HTTP | 10 (batch 50 unit, konkurensi 4) |
| Durasi | **9,6 detik** — muat dalam batas 60 detik Vercel |
| Terpotong | 0 |
| Alarm seluruh jenis | 98 |
| Dari 10 ID pilihan | 8 |

Rata-rata 7 hari: **~17 event/hari** untuk 10 ID, dari 917 alarm seluruh jenis. Sekitar **87% data ditarik lalu dibuang** karena filter API tidak berfungsi.

### Ukuran response

Satu record utuh rata-rata **4.443 byte**, dan **82%-nya hanya untuk `attachments`, `primary_media`, dan `alarm_id_numbers`**.

Usulan menyimpan 17 field saja → **426 byte**, hemat 90%:

```
alarm_no, vehicle_id, nopol, device_id, gps_time, lat, lon, addr,
speed, acc, alarm_id, alarm_nm, module, severity, subiao_alarm_level,
alarm_repeat_count, attachment_count
```

URL media sengaja tidak disimpan — ia bisa kedaluwarsa (`is_expired`, `storage_deleted_at_utc`), dan `GET /alarms/{alarmNo}` bisa mengambilnya lagi kapan saja. Modal Detail cukup memanggilnya saat dibuka.

Ini menuntut kolom baru `payload_fields` di `alert_sources` supaya per-sumber bisa menentukan field yang disimpan — tetap konfiguratif, bukan hardcode.

Ekstrapolasi setahun pada volume sekarang: **178 MB** kalau utuh vs **17 MB** kalau diringkas.

## 7. Berkas pendukung

| Berkas | Isi |
|---|---|
| `docs/MDVR_Alarm_Types.xlsx` | 59 jenis + kejadian nyata 7 hari, pasangan L1/L2, usulan severity |
| `docs/MDVR_Event_10ID.xlsx` | 117 event dari 10 ID, lengkap per baris dengan koordinat dan lokasi |
| `scripts/export-mdvr-types.mjs` | Menghasilkan ulang berkas pertama |

## 8. Yang perlu dipastikan sebelum lanjut

1. **Token/akun dengan cakupan company yang benar** — sedang dicari BJU.
2. Dari unit yang berizin nanti, **berapa yang benar-benar terpasang MDVR?** Kalau hanya belasan, menarik ratusan unit tiap siklus itu sia-sia.
3. Apakah `252, 253, 256` jadi ditambahkan (§5).
4. Adakah jenis bernama "Physiological Fatigue Alarm Level 1" di spesifikasi vendor — nama itu tidak ada di API ini. Kandidat terdekat: `221/251 Mata Terpejam`, `236/266 Menguap`, atau `225/255 Driver abnormal`. Field `subiao_id` mungkin bisa dipakai mencocokkan ke kode aslinya.
