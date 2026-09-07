# UI/UX Guideline — Alert Centre Monitoring (ACM)

**Versi:** 1.0
**Selaras dengan:** Design system BJU yang sudah ada (warna teal, Plus Jakarta Sans, arah Glass UI yang pernah dieksplorasi di prototipe modal BJU) — dokumen ini memperluasnya khusus untuk kebutuhan ACM.

---

## 1. Prinsip Desain

1. **Clean & profesional** — sedikit elemen dekoratif, hierarki visual jelas, tidak ramai.
2. **Putih & hijau sebagai identitas utama** — hijau dipakai untuk branding, elemen interaktif, dan status positif; putih/netral untuk permukaan (surface) dominan.
3. **Warna tetap bermakna, bukan dekorasi** — severity alert (kritis/peringatan/info) punya palet sendiri di luar hijau, supaya saat dilihat sekilas dari layar TV, warna langsung mengomunikasikan urgensi tanpa perlu membaca teks.
4. **Terbaca dari jarak** — ini pertimbangan tertinggi. Semua keputusan visual (ukuran font, kontras, transparansi glass) diuji dengan asumsi dilihat dari 2-4 meter di layar TV, bukan dari depan laptop.
5. **Glassmorphism secukupnya, bukan di semua tempat** — dipakai untuk memberi kedalaman pada elemen "furnitur" (sidebar, topbar, card container), tapi tidak pernah di belakang teks kritikal yang harus terbaca instan (lihat §4).

## 2. Palet Warna

### 2.1 Mode Terang (Light)

| Token | Nilai | Penggunaan |
|---|---|---|
| `--surface-base` | `#FFFFFF` | Latar utama |
| `--surface-elevated` | `#F7F9F8` | Card, panel |
| `--brand-primary` | `#0F6E56` | Warna hijau identitas (selaras dengan design system BJU) — sidebar aktif, tombol utama, aksen |
| `--brand-primary-hover` | `#0C5A46` | Hover state |
| `--brand-primary-soft` | `#E1F5EE` | Latar lembut untuk badge/indikator status positif |
| `--text-primary` | `#111827` | Teks utama |
| `--text-secondary` | `#5F5E5A` | Teks sekunder, label |
| `--border-default` | `#E3E5E1` | Garis pemisah tipis |

### 2.2 Mode Gelap (Dark) — mode utama untuk layar TV control room

| Token | Nilai | Penggunaan |
|---|---|---|
| `--surface-base` | `#0B0F0E` | Latar utama, hampir hitam dengan nuansa hijau gelap (bukan hitam pekat, terasa "bertema" bukan generik) |
| `--surface-elevated` | `#141A18` | Card, panel |
| `--brand-primary` | `#1D9E75` | Hijau lebih terang untuk kontras cukup di layar gelap |
| `--brand-primary-soft` | `rgba(29, 158, 117, 0.16)` | Latar lembut/indikator |
| `--text-primary` | `#F1F5F3` | Teks utama |
| `--text-secondary` | `#9CA39F` | Teks sekunder |
| `--border-default` | `rgba(255, 255, 255, 0.08)` | Garis pemisah tipis di atas glass |

### 2.3 Warna Severity (Sama di Kedua Mode — Ini yang Tidak Boleh Ikut Berubah)

| Severity | Warna | Catatan |
|---|---|---|
| Critical | `#E24B4A` (merah) | Selalu solid, tidak pernah dalam bentuk glass transparan — harus langsung menangkap perhatian |
| Warning | `#EF9F27` (amber) | |
| Info / Resolved | `--brand-primary` (hijau) | Konsisten dengan identitas, sekaligus menandakan "aman/selesai" |
| Unit tidak dikenal | `#888780` (abu netral) | Netral, bukan warna alert |

## 3. Tipografi

- **Font utama:** Plus Jakarta Sans (selaras dengan design system BJU yang sudah berjalan)
- **Font monospace:** JetBrains Mono — dipakai khusus untuk data teknis: VHCID, No. Plat, No. Rangka, timestamp. Ini membantu operator membedakan "data identitas unit" dari teks naratif secara instan.
- **Skala untuk layar kerja (laptop/monitor biasa):** 14px body, 16-20px heading card, 24-28px heading halaman.
- **Skala khusus TV wall display:** dikalikan ~1.6-2x dari skala biasa. Contoh: nomor plat/VHCID di kartu feed minimal setara 24-28px di layar kerja, sehingga skala TV bisa mencapai 40-48px. Judul grafik minimal 32px setara TV.
- Berat font hanya dua: regular (400) untuk isi, medium (500) untuk judul/label penting. Hindari bold tebal (700) — terlihat kasar di layar besar dan tidak menambah keterbacaan.

## 4. Glassmorphism — Aturan Pemakaian

**Resep dasar (dipakai konsisten di semua elemen glass):**
```css
background: rgba(255, 255, 255, 0.55);      /* light mode */
background: rgba(20, 26, 24, 0.55);          /* dark mode */
backdrop-filter: blur(20px);
border: 1px solid rgba(255, 255, 255, 0.25); /* light: putih; dark: hijau muda tipis */
```

### Boleh dipakai glass di:
- **Topbar** — mengambang tipis di atas konten, blur latar saat scroll
- **Sidebar** — permukaan glass dengan border halus, ikon aktif diberi highlight `--brand-primary-soft`
- **Card ringkasan/statistik** (bukan kartu alert individual) — mis. kartu "Total alert hari ini", "Unit aktif"
- **Modal & dialog** (konfirmasi bulk close, form konfigurasi) — ini sudah pernah dieksplorasi sebagai arah "Glass UI" di prototipe BJU sebelumnya, dilanjutkan di sini

### Tidak boleh dipakai glass di:
- **Latar belakang item alert individual di feed** — teks severity, VHCID, dan waktu kejadian harus di atas permukaan solid (`--surface-elevated`), bukan glass tembus pandang. Ini murni soal keterbacaan dari jarak jauh: transparansi + blur menurunkan kontras, dan di layar TV yang dilihat dari 2-4 meter, ini bisa membuat operator salah baca angka penting.
- **Grafik/chart** — sumbu, label, dan garis data harus di atas latar solid.
- **Badge severity** — badge critical/warning selalu solid, tidak pernah glass, supaya warna alert tidak "tercuci" oleh transparansi.

## 5. Rounded Corner — Skala

Sesuai arahan, rounding dipakai cukup banyak untuk kesan modern, dengan skala konsisten:

| Elemen | Radius |
|---|---|
| Sidebar (kontainer utama) | `28px` (hanya sisi dalam yang menghadap konten, sisi luar mengikuti tepi layar) |
| Topbar | `24px`, mengambang dengan margin dari tepi layar (bukan menempel penuh) — memperkuat kesan glass "melayang" |
| Card besar (statistik, panel grafik) | `20px` |
| Card alert individual di feed | `16px` |
| Badge, pill status | `999px` (pill penuh) |
| Tombol | `12px` |
| Input form | `10px` |

Prinsip: makin besar & makin "furnitur" elemennya (sidebar, topbar), makin besar radiusnya. Elemen kecil (tombol, badge) tetap proporsional supaya tidak terlihat seperti kapsul aneh di ukuran kecil.

## 6. Dark Mode — Perilaku Khusus

- Dark mode adalah **mode default** untuk Dashboard Wall Display (ruang kontrol biasanya menyala lama, dark mode mengurangi kelelahan mata dan membuat warna severity lebih menonjol).
- Mode terang tetap tersedia penuh untuk halaman kerja non-wall-display (konfigurasi API, master data, laporan Management) — pengguna bisa toggle manual.
- Toggle dark/light disimpan sebagai preferensi per pengguna (bukan per perangkat), kecuali khusus URL/route Dashboard Wall Display yang **selalu dark mode dan tidak menampilkan toggle** — supaya operator tidak tidak sengaja mengubah mode di layar bersama.

## 7. Layout Dashboard Utama (Sesuai Konsep Awal)

```
+-------------------------------------------------------------+
|  Topbar (glass, mengambang, rounded 24px)                   |
+------------+--------------------------------------------------+
|            |                              |                   |
|  Sidebar   |   Grafik update event        |   Feed alert       |
|  (glass,   |   (kiri)                     |   realtime         |
|  rounded   |                              |   (kanan)          |
|  28px)     |                              |                    |
|            |                              |                    |
+------------+--------------------------------------------------+
```

- **Kiri — grafik:** tren jumlah event per jenis alert (mis. bar/line chart per jam), warna batang/garis mengikuti warna severity, bukan warna acak.
- **Kanan — feed realtime:** daftar alert terbaru berjalan (baris terbaru masuk dari atas dengan transisi halus, bukan lompat tiba-tiba), tiap item menampilkan: badge severity, VHCID (font mono), No. Plat, jenis alert, waktu, cabang/project.
- Untuk mode wall display, sidebar bisa disembunyikan/diciutkan otomatis (hanya ikon) supaya ruang untuk grafik dan feed maksimal.

## 8. Pertimbangan Khusus Layar TV Besar

- **Safe zone margin:** sisakan minimal 5% margin dari tepi layar di semua sisi — banyak TV komersial melakukan overscan/crop tepi, elemen penting jangan ditempel di pinggir mentah.
- **Kontras minimum:** rasio kontras teks-ke-latar minimal 7:1 untuk teks kritikal (severity, VHCID) di dashboard wall display — lebih tinggi dari standar AA (4.5:1) biasa, karena jarak pandang jauh mengurangi kemampuan mata membedakan kontras rendah.
- **Hindari animasi berlebihan:** transisi halus untuk item baru masuk feed itu bagus, tapi hindari animasi berulang/berkedip (mis. badge yang terus-menerus pulsing) — ini melelahkan mata untuk tampilan yang menyala berjam-jam. Cukup satu kali animasi masuk per alert baru.
- **Audio cue untuk critical**, karena tidak semua orang di ruangan menatap layar terus-menerus — visual saja tidak cukup untuk alert yang butuh perhatian segera (sudah dibahas di PRD).
- **Tidak ada interaksi mouse/klik yang wajib** di layar wall display murni — semua update otomatis lewat Realtime. Klik untuk lihat peta lokasi tetap ada untuk mode workstation (bukan mode TV murni yang tanpa perangkat input).

## 9. Komponen Kunci

### Badge Severity
- Bentuk pill (`radius: 999px`), warna solid sesuai §2.3, teks putih/gelap kontras tinggi (bukan warna teks dari palet brand)
- Ukuran teks badge tidak boleh lebih kecil dari label sekitarnya — badge sering jadi elemen pertama yang dibaca mata dari jarak jauh

### Item Feed Alert
- Latar solid `--surface-elevated` (bukan glass, lihat §4)
- Border kiri setipis 4px dengan warna severity — cara cepat memindai daftar tanpa membaca badge satu-satu
- VHCID & No. Plat dalam font mono, jenis alert dalam font utama medium weight

### Sidebar
- Glass, rounded 28px, ikon dengan label (bukan ikon saja di mode workstation; ikon saja di mode wall display yang diciutkan)
- Item aktif mendapat latar `--brand-primary-soft` + indikator garis kiri hijau solid

### Topbar
- Glass, rounded 24px, mengambang dengan margin dari tepi atas layar
- Berisi: nama halaman, filter cepat (cabang/project — lihat kebutuhan filter di PRD), status koneksi realtime (indikator kecil hijau "live" / merah "terputus"), toggle dark/light (disembunyikan di mode wall display sesuai §6)

## 10. Yang Perlu Dihindari

- Jangan taruh teks penting di atas gradient/glass dengan opacity di bawah 40% — akan gagal di uji jarak pandang TV.
- Jangan gunakan warna severity untuk elemen non-alert (mis. tombol biasa berwarna merah) — akan membingungkan mata yang terlatih membaca merah = kritis.
- Jangan campur radius yang tidak konsisten antar elemen sejenis (mis. satu card 16px, card sejenis lain 12px) — pecah kesan sistematis.
- Jangan animasikan background glass (blur bergerak/berubah) — cukup elemen konten yang bertransisi, bukan wadahnya.
