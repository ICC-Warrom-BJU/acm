# Hasil Investigasi Milestone 0 — API TMS EASYGO

**Tanggal uji:** 2026-09-07
**Status:** Terverifikasi lewat panggilan langsung ke API produksi
**Menggantikan:** asumsi yang ditandai "perlu dikonfirmasi" di `API_LIST_ACM.md`

---

## 1. Cara Autentikasi — TERJAWAB

Token dikirim sebagai **header bernama `token` (huruf kecil semua), nilainya mentah tanpa prefix**.

```http
POST https://vtsapi.easygo-gps.co.id/api/report/speed_flag
Content-Type: application/json
token: <EASYGO_TOKEN>
```

Yang **tidak** bekerja: `Authorization: Bearer <token>`, `Authorization: <token>`, `api-key`, `X-Token`, token di body, token di query string. Semuanya dijawab `"Token is empty"`.

Catatan: header `Token` (huruf besar T) tidak konsisten — pada dua percobaan responsnya menggantung sampai timeout. Gunakan `token` huruf kecil.

> Implikasi untuk `alert_sources.auth_type`: butuh mode **`custom_header`** dengan nama header yang bisa dikonfigurasi, bukan hanya `bearer`/`api_key`/`basic` seperti di PRD §6.2.

## 2. Bentuk Response — Envelope Seragam

Kedua endpoint memakai envelope yang sama:

```json
{ "ResponseCode": 1, "ResponseMessage": "success 764 recs", "Data": [ ... ] }
```

| ResponseCode | Arti |
|---|---|
| `1` | Sukses, `Data` berisi array record |
| `0` | Gagal, `ResponseMessage` berisi sebab (mis. `"Token is empty"`), `Data` array kosong |

> **Penting untuk Modul Kesehatan API:** API ini **selalu mengembalikan HTTP 200**, bahkan saat gagal auth. Health check tidak boleh menilai keberhasilan dari status HTTP — harus membaca `ResponseCode`. Kalau tidak, sumber yang tokennya mati akan terus tampak "hijau" padahal tidak pernah menghasilkan data.

## 3. Window Waktu Singkat — DIDUKUNG

Ini menentukan kelayakan seluruh desain polling, dan hasilnya positif.

| Endpoint | Rentang | Record | Durasi |
|---|---|---|---|
| `/api/report/speed_flag` | 1 hari penuh | 764 | **138.553 ms** |
| `/api/report/speed_flag` | 5 menit | 19 | **1.337 ms** |
| `/api/Notifikasi/Operation` | 1 hari penuh | 465 | 3.117 ms |

Window 5 menit dijawab dalam ~1,3 detik → polling berkala sepenuhnya layak.

### 3.1 Zona Waktu Window Request BERBEDA Antar Endpoint — TEMUAN KRITIS

Ditemukan saat menguji pipeline, bukan dari dokumen. Kedua endpoint membaca `start_time` / `stop_time` dalam zona waktu yang **berbeda**:

| Endpoint | Window request dibaca sebagai | Bukti (window 60 menit yang sama) |
|---|---|---|
| `/api/report/speed_flag` | **UTC** | offset +0 → 368 rec · offset +7 → **0 rec** |
| `/api/Notifikasi/Operation` | **WIB (+7)** | offset +7 → 47 rec · offset +0 → 32 rec |

Masing-masing konsisten dengan format `gps_time` di responsnya sendiri (`speed_flag` menjawab `...Z`, `Notifikasi` menjawab `...+07:00`).

> **Kenapa ini berbahaya:** offset yang salah **tidak menghasilkan error**. API tetap menjawab `ResponseCode: 1` dan `"success N recs"` — hanya saja untuk rentang waktu yang keliru. Pada `speed_flag`, memakai offset WIB berarti meminta window di masa depan dan selalu mendapat **nol record**: sumber akan tampak sehat sempurna di Modul Kesehatan API sambil tidak pernah menghasilkan satu alert pun.

Karena itu offset **wajib dikonfigurasi per sumber** (`alert_sources.time_window_offset_hours`), bukan konstanta global.

> **Peringatan operasional:** query 1 hari penuh di `speed_flag` makan **139 detik**. Ini melampaui batas eksekusi serverless Vercel (10 s Hobby, 60 s default Pro, maks 300 s). Endpoint polling **wajib** memakai window sempit (`sekarang − interval`), tidak pernah rentang panjang. Untuk backfill manual perlu jalur terpisah yang memecah rentang jadi potongan kecil.

## 4. Field Response — speed_flag

```
vehicle_id, gps_sn, nopol, group_name, gps_time,
speed, speed_flag, speed_flag_value, event_text,
lat, lon, addr, direction
```

Contoh record:

```json
{
  "vehicle_id": "VEH0166916",
  "gps_sn": "353691847408647",
  "nopol": "DD 7500 RF",
  "group_name": "CAHAYA BONE MAKASSAR",
  "gps_time": "2026-09-07T02:31:49Z",
  "speed": 71.0,
  "speed_flag": "13",
  "speed_flag_value": 70,
  "event_text": "Speed >= 70 km/h",
  "lat": -4.963393211364746,
  "lon": 119.79889678955078,
  "addr": "Jalan Poros Maros - Watampone, Cenrana, Maros, ...",
  "direction": "239"
}
```

## 5. Field Response — Notifikasi/Operation

```
vehicle_id, company_id, company_nm, gps_sn, nopol, driver_nm, gps_time,
tipe_notif, addr, geo_location_nm, geo_location_code, ket_notif,
lon, lat, direction, start_time, stop_time, durasi_moving, durasi_stop, start_from
```

## 6. Field Pembeda 3 API Berbagi Endpoint — TERJAWAB

Pembedanya adalah **`tipe_notif`**. Satu panggilan mengembalikan semua jenis tercampur, jadi pendekatan **satu konfigurasi sumber, dipecah di Node.js** (opsi utama di `API_LIST_ACM.md`) terkonfirmasi benar.

Nilai `tipe_notif` yang benar-benar muncul (sampel 1 hari, 465 record):

| `tipe_notif` | Jumlah |
|---|---|
| `OVERSPEED` | 323 |
| `Forbidden Driving` | 63 |
| `IDLE` | 37 |
| `Forbidden Parking` | 15 |
| `FUEL FILLING` | 14 |
| `FUEL THEFT` | 7 |
| `MOVEMENT` | 4 |
| `OVERSPEED_IN_GEO` | 2 |

Sampel satu hari itu **tidak lengkap**. Window 10 jam pada 2026-09-07 memunculkan satu jenis lagi yang tidak ada di daftar ini: `FATIQUE` (lihat §6.1). Pelajarannya: daftar jenis dari sampel apa pun harus diperlakukan sebagai sementara — itulah sebabnya penemuan otomatis dibangun, bukan daftar tetap di kode.

Perhatikan: penulisannya **tidak konsisten** (ada UPPERCASE, ada Title Case) — pencocokan harus case-insensitive.

### 6.1 Ketidakcocokan dengan Dokumen — PERLU KEPUTUSAN

Dokumen menargetkan tiga jenis: Parking Overtime, Idle Overtime, **Fatigue Driving**. Yang tersedia di API berbeda:

| Target di dokumen | Kandidat di API | Keyakinan |
|---|---|---|
| `idle_overtime` | `IDLE` | Tinggi |
| `parking_overtime` | `Forbidden Parking` | Sedang — "Forbidden" (parkir di area terlarang) belum tentu sama dengan "Overtime" (parkir kelamaan). Tapi `ket_notif` berbunyi `"Forbidden Parking >= 2h, 3m"`, yang berbasis durasi — jadi kemungkinan besar memang ini |
| `fatigue_driving` | `Forbidden Driving` | **Rendah** — `ket_notif` berbunyi `"Forbidden Driving >= 1h, 7m"`. Tidak ada jenis notifikasi yang secara eksplisit bernama fatigue |

### TERPECAHKAN 2026-09-07 — jenisnya bernama `FATIQUE`

Sampel awal satu hari tidak memuatnya sama sekali, sehingga sempat disimpulkan tidak ada. Jenis itu **ada**, dieja `FATIQUE` (bukan `FATIGUE`), dan muncul jauh lebih jarang daripada jenis lain — 1 kejadian dalam window 10 jam, dibanding 103 untuk `Forbidden Driving`.

Ia ditemukan **tanpa ada yang menebaknya**, oleh mekanisme penemuan otomatis di §6.1: poller mencatat setiap nilai `tipe_notif` yang belum dikenal sebagai baris nonaktif beserta contoh payloadnya.

Contoh payload memastikan maknanya:

```json
{
  "tipe_notif": "FATIQUE",
  "ket_notif": "FATIQUE",
  "durasi_moving": "4h",
  "direction": "START",
  "vehicle_id": "VEH0162537",
  "nopol": "buffer DD 8483 UD"
}
```

`durasi_moving: "4h"` — mengemudi empat jam menerus. Ini memang kelelahan pengemudi.

**Konsekuensinya, dugaan awal di tabel atas keliru:** `Forbidden Driving` **bukan** padanan fatigue driving. Keduanya jenis yang berbeda dan kini dipetakan terpisah:

| `tipe_notif` | alert_type ACM | Severity |
|---|---|---|
| `FATIQUE` | `fatigue_driving` | critical |
| `Forbidden Driving` | `forbidden_driving` | critical |

Ini juga membenarkan keputusan memindahkan pemetaan ke master data: penyesuaian dilakukan lewat satu baris di UI, tanpa perubahan kode dan tanpa deploy ulang.

> **KEPUTUSAN (BJU):** pemetaan jenis notifikasi dipindahkan ke master data `alert_type_master`, bukan lagi konstanta di kode atau JSON di konfigurasi sumber. Begitu jenis mana yang mewakili fatigue driving diketahui, staf cukup mengubah `alert_type` pada baris itu lewat UI. Lebih jauh, poller mencatat sendiri setiap nilai `tipe_notif` baru yang muncul sebagai baris nonaktif — jadi kalau EASYGO menambahkan jenis fatigue nanti, ia akan muncul otomatis untuk ditinjau tanpa ada yang perlu menebak namanya lebih dulu.

Selain itu ada 4 jenis di luar lingkup dokumen yang datanya sudah tersedia gratis dalam response yang sama: `MOVEMENT`, `FUEL THEFT`, `FUEL FILLING`, `OVERSPEED_IN_GEO`.

### 6.2 OVERSPEED Muncul di Dua Endpoint — RISIKO DUPLIKASI

`speed_flag` dan `tipe_notif = "OVERSPEED"` sama-sama melaporkan pelanggaran kecepatan, dari dua endpoint berbeda, dengan ambang berbeda (`speed_flag` memakai ambang 70 km/h; contoh OVERSPEED di notifikasi berbunyi `"OVERSPEED max 49"`).

Kalau kedua sumber diaktifkan apa adanya, satu kejadian ngebut yang sama berpotensi jadi dua alert dengan `alert_type` berbeda, sehingga dedup harian di PRD §7.1 (yang berbasis `vhcid + alert_type`) tidak akan menggabungkannya.

> **KEPUTUSAN (BJU): overspeed memakai Speed Flag sebagai satu-satunya sumber.** `OVERSPEED` dari `Notifikasi/Operation` tetap didaftarkan di master data tapi dengan `is_active = false`, bukan dihapus — supaya alasannya terbaca di UI dan supaya jenis itu tidak muncul berulang sebagai "jenis baru yang belum ditinjau" tiap kali polling berjalan.

## 7. Temuan Normalisasi yang Wajib Ditangani

1. **Zona waktu tidak konsisten antar endpoint.** `speed_flag.gps_time` memakai UTC (`"2026-09-07T02:31:49Z"`), sedangkan `Notifikasi.gps_time` memakai offset lokal (`"2026-09-07T00:00:10+07:00"`). Keduanya harus dinormalisasi ke `timestamptz` UTC saat disimpan. Kalau diabaikan, alert speed_flag akan tampak bergeser 7 jam dan **dedup harian akan salah menentukan "hari yang sama"**.

2. **Sentinel tanggal kosong.** `start_time` / `stop_time` sering berisi `"0001-01-01T00:00:00"` yang berarti "tidak ada nilai", bukan tanggal tahun 1. Harus dipetakan ke `NULL`.

3. **Nama field berbeda dari tebakan PRD.** Yang benar: `vehicle_id` (bukan `vhcid`), `lon` (bukan `long`/`lng`). `field_mapping` default harus disesuaikan.

4. **Tidak ada field severity di kedua endpoint.** PRD §12 sudah menandai ini sebagai hal yang belum disepakati — sekarang terkonfirmasi bahwa severity **tidak bisa dipetakan**, harus **diturunkan** oleh ACM dari data yang ada (mis. `speed` vs `speed_flag_value` untuk speed_flag, dan `tipe_notif` + durasi di `ket_notif` untuk notifikasi). Aturannya perlu disepakati.

5. **Koordinat selalu terisi.** 465 dari 465 record notifikasi punya `lat`/`lon` valid — heatmap aman.

6. **`nopol` bisa mengandung sufiks.** Ditemukan `"DD 8464 SI/dascam"` — jangan dijadikan kunci join. `vehicle_id` tetap satu-satunya kunci yang dipakai.

7. **Enrichment tersedia dari response.** `group_name` (speed_flag) dan `company_nm` / `company_id` (notifikasi) bisa jadi fallback saat unit belum ada di `master_vehicles`.

## 8. Status Keputusan

| # | Hal | Status |
|---|---|---|
| 1 | Pemetaan `fatigue_driving` (§6.1) | **Selesai.** Jenisnya bernama `FATIQUE`, ditemukan otomatis oleh poller pada 2026-09-07 dan dikonfirmasi lewat contoh payload (`durasi_moving: "4h"`). Sudah dipetakan dan aktif |
| 2 | Tumpang tindih OVERSPEED (§6.2) | **Diputuskan.** Speed Flag jadi satu-satunya sumber overspeed |
| 3 | Zona waktu window request per endpoint (§3.1) | **Diperbaiki.** `time_window_offset_hours` per sumber, tanpa nilai default tersembunyi di kode |
| 4 | Zona waktu bisnis (batas hari & tampilan) | **Diputuskan: WITA (+8)**, mengikuti lokasi control room di Makassar. Lihat `src/lib/time.ts` |
| 5 | Aturan penurunan severity (§7.4) | **Sebagian.** Severity kini bisa ditetapkan per jenis di master data; aturan turunan hanya dipakai sebagai cadangan. Ambang untuk speed_flag masih usulan |
| 6 | 4 jenis di luar lingkup (`MOVEMENT`, `FUEL THEFT`, `FUEL FILLING`, `OVERSPEED_IN_GEO`) | **Terbuka.** Sudah terdaftar di master data dalam keadaan nonaktif — tinggal diaktifkan lewat UI bila diperlukan, tanpa perubahan kode |

### Catatan konsekuensi zona waktu bisnis

WITA (+8) dipilih supaya operator membaca jam yang sama dengan jam dinding di ruangan Makassar. Konsekuensinya: batas "hari" ACM bergeser satu jam dari batas hari TMS EASYGO yang memakai WIB. Rekap harian ACM karena itu bisa berbeda tipis dengan laporan TMS untuk kejadian di sekitar tengah malam. Ini konsekuensi yang disadari, bukan cacat — dan tercatat di `src/lib/time.ts` supaya tidak jadi kejutan saat ada yang merekonsiliasi angka.
