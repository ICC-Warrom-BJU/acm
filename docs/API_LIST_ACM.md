# Daftar API Sumber Alert — ACM (Fase 1)

**Sumber data:** TMS EASYGO
**Status:** Draft awal — sebagian field response API belum terverifikasi (lihat catatan di tiap API)

---

## Ringkasan Kredensial Bersama

| Item | Nilai |
|---|---|
| Base URL | `https://vtsapi.easygo-gps.co.id` |
| Token | Disimpan di `.env.local` sebagai `EASYGO_TOKEN`, dan di database dalam bentuk terenkripsi (AES-256-GCM) pada `alert_sources.token_encrypted`. Sengaja tidak ditulis di dokumen yang masuk repo. |
| Auth type | Kemungkinan `api_key` / custom header — **perlu dikonfirmasi**: apakah token dikirim sebagai `Authorization: Bearer ...`, header custom (mis. `Token: ...`), atau sebagai bagian dari body/query. Belum ada contoh cara pengiriman token dari yang dibagikan |
| Method | Kemungkinan besar **POST** (karena parameter berupa body JSON, bukan query string) — **perlu dikonfirmasi** dengan uji panggilan langsung |
| Body template bersama | Lihat di bawah, berlaku sama untuk 4 API ini |

### Body Template (dipakai apa adanya oleh 4 API di bawah)

```json
{
  "start_time": "2026/08/26 00:00:00",
  "stop_time": "2026/08/29 23:59:59",
  "lstVehicleId": null,
  "lstNoPOL": []
}
```

Catatan: `start_time` / `stop_time` di sini adalah rentang tanggal, bukan waktu realtime saat ini. Untuk kebutuhan polling ACM (mengambil kejadian *baru* sejak polling terakhir), nilai `start_time` kemungkinan perlu digeser otomatis oleh sistem (mis. `sekarang - interval polling`) setiap kali dipanggil, bukan nilai statis. **Ini perlu dikonfirmasi**: apakah API mendukung window waktu singkat seperti "5 menit terakhir", atau format ini hanya untuk laporan rentang panjang.

`lstVehicleId: null` dan `lstNoPOL: []` tampak berarti "semua kendaraan" — perlu dikonfirmasi apakah ACM akan selalu memakai nilai ini (ambil semua unit sekaligus per polling) atau perlu difilter per konfigurasi.

---

## 1. Parking Overtime

| Item | Nilai |
|---|---|
| Alert type code (usulan) | `parking_overtime` |
| Endpoint | `POST https://vtsapi.easygo-gps.co.id/api/Notifikasi/Operation` |
| Body | Body template bersama (lihat di atas) |
| Token | Bersama (lihat di atas) |

**Catatan khusus:** endpoint ini **sama persis** dengan Idle Overtime dan Fatigue Driving (lihat bagian "Catatan Penting" di bawah).

## 2. Idle Overtime

| Item | Nilai |
|---|---|
| Alert type code (usulan) | `idle_overtime` |
| Endpoint | `POST https://vtsapi.easygo-gps.co.id/api/Notifikasi/Operation` |
| Body | Body template bersama (lihat di atas) |
| Token | Bersama (lihat di atas) |

**Catatan khusus:** sama seperti di atas — endpoint identik dengan Parking Overtime dan Fatigue Driving.

## 3. Fatigue Driving

| Item | Nilai |
|---|---|
| Alert type code (usulan) | `fatigue_driving` |
| Endpoint | `POST https://vtsapi.easygo-gps.co.id/api/Notifikasi/Operation` |
| Body | Body template bersama (lihat di atas) |
| Token | Bersama (lihat di atas) |

**Catatan khusus:** sama seperti di atas — endpoint identik dengan Parking Overtime dan Idle Overtime.

## 4. Speed Flag — **Prioritas implementasi pertama**

| Item | Nilai |
|---|---|
| Alert type code (usulan) | `speed_flag` |
| Endpoint | `POST https://vtsapi.easygo-gps.co.id/api/report/speed_flag` |
| Body | Body template bersama (lihat di atas) |
| Token | Bersama (lihat di atas) |

**Catatan khusus:** endpoint ini unik (tidak dipakai API lain), sehingga secara arsitektur lebih sederhana untuk dijadikan implementasi pertama — satu `alert_sources` config ↔ satu endpoint ↔ satu jenis alert, tanpa masalah pembeda notifikasi seperti tiga API di atas.

---

## Catatan Penting: 3 API Berbagi 1 Endpoint yang Sama

Parking Overtime, Idle Overtime, dan Fatigue Driving semuanya memanggil endpoint yang **sama persis** (`/api/Notifikasi/Operation`) dengan token dan body yang **sama persis**. Ini berarti satu panggilan API kemungkinan mengembalikan ketiga jenis notifikasi tersebut sekaligus dalam satu response (kemungkinan berupa array campuran, dengan satu field yang membedakan jenis notifikasi per item, misalnya `notifType` atau `category`).

Implikasi terhadap desain di PRD (§5, §6.2):
- Tidak bisa langsung dibuat 3 baris `alert_sources` yang masing-masing polling sendiri-sendiri secara naif — itu akan memanggil endpoint yang sama 3× dengan parameter identik, boros dan berisiko rate-limit.
- Kemungkinan besar perlu **satu konfigurasi sumber** (`alert_type = "notifikasi_operation"`) yang di-polling sekali, lalu logika normalisasi di Node.js **memecah response menjadi 3 jenis alert** berdasarkan field pembeda di dalam payload — field pembeda ini yang belum diketahui.
- Alternatif lain (kurang efisien): tetap 3 config terpisah tapi ditandai "shared endpoint group" supaya scheduler hanya benar-benar memanggil API sekali per grup dan hasilnya dibagi ke 3 alert_type — ini butuh sedikit penyesuaian desain scheduler yang belum ada di PRD versi awal.

**Keputusan ini perlu contoh response asli** dari endpoint `/api/Notifikasi/Operation` sebelum implementasi dimulai — lihat TASKS.md untuk task investigasi ini.

---

## Field yang Masih Perlu Diverifikasi (berlaku untuk semua 4 API)

Field mapping di PRD (`vhcid_path`, `timestamp_path`, `lat_path`, `long_path`, `severity_path`) membutuhkan contoh response JSON asli dari tiap endpoint. Sampai saat ini belum ada contoh response yang dibagikan, sehingga field-field berikut belum bisa dipastikan namanya di response:

- Nama field VHCID di response (apakah `vhcid`, `vehicle_id`, `id_kendaraan`, dll)
- Nama field koordinat lat/long
- Nama field waktu kejadian (apakah beda dari `start_time`/`stop_time` request)
- Nama field pembeda notifikasi untuk 3 API yang berbagi endpoint (khusus poin di atas)
- Format response: apakah objek tunggal, array langsung, atau dibungkus (`{ "data": [...] }`, `{ "result": [...] }`, dll)
- Struktur error response (untuk keperluan `last_error` di modul kesehatan API)
