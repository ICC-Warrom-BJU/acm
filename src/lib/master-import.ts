/**
 * Import / update massal master unit (PRD §9).
 *
 * Kuncinya VHCID — bukan pilihan gaya, tapi satu-satunya yang mungkin: VHCID
 * adalah primary key `master_vehicles` DAN satu-satunya identitas unit yang
 * dikirim API alert. Nomor polisi dan nomor rangka tidak pernah muncul di
 * respons API, jadi tidak ada cara mencocokkan alert ke unit lewat keduanya.
 *
 * Logika dipisahkan dari route supaya bisa diuji tanpa HTTP maupun database.
 */

/** Kolom yang boleh diisi lewat import. `vhcid` kunci, sisanya data. */
export const KOLOM_DATA = [
  'no_plat',
  'no_rangka',
  'cabang',
  'group_project',
  'vendor',
  'jenis_gps',
] as const;

export type KolomData = (typeof KOLOM_DATA)[number];

export const LABEL_KOLOM: Record<KolomData | 'vhcid', string> = {
  vhcid: 'VHCID',
  no_plat: 'No. Polisi',
  no_rangka: 'No. Rangka',
  cabang: 'Cabang',
  group_project: 'Project',
  vendor: 'Vendor',
  jenis_gps: 'Jenis GPS',
};

/**
 * Header file -> kolom database. Dicocokkan longgar (huruf kecil, tanpa spasi
 * dan tanda baca) supaya file dari cabang yang headernya sedikit berbeda tetap
 * terbaca tanpa perlu diseragamkan manual lebih dulu.
 */
const HEADER_MAP: Record<string, KolomData | 'vhcid'> = {
  gpsvhcid: 'vhcid',
  vhcid: 'vhcid',
  idgps: 'vhcid',
  nopolisi: 'no_plat',
  nopol: 'no_plat',
  noplat: 'no_plat',
  nopolis: 'no_plat',
  platnomor: 'no_plat',
  norangka: 'no_rangka',
  nomorrangka: 'no_rangka',
  vin: 'no_rangka',
  cabang: 'cabang',
  branch: 'cabang',
  project: 'group_project',
  groupproject: 'group_project',
  grupproject: 'group_project',
  vendor: 'vendor',
  jenisgps: 'jenis_gps',
  tipegps: 'jenis_gps',
};

export const norm = (s: unknown) =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function petakanHeader(header: string[]): (KolomData | 'vhcid' | null)[] {
  return header.map((h) => HEADER_MAP[norm(h)] ?? null);
}

export type NilaiBaris = Partial<Record<KolomData | 'vhcid', string | null>>;

export type Masalah = { baris: number; pesan: string };

export type Perubahan = {
  kolom: KolomData;
  dari: string | null;
  ke: string | null;
};

export type HasilBaris = {
  baris: number;
  vhcid: string;
  aksi: 'baru' | 'ubah' | 'sama';
  perubahan: Perubahan[];
  /** Nomor rangka berubah pada VHCID yang sudah ada — lihat catatan di bawah. */
  gantiRangka: boolean;
  /** Payload yang akan dikirim ke database. */
  data: Record<string, string | null>;
};

export type Ringkasan = {
  baris: HasilBaris[];
  masalah: Masalah[];
  /** Unit yang ada di database tapi tidak disebut di file. Tidak pernah disentuh. */
  takDisebut: number;
  kolomTerpakai: (KolomData | 'vhcid')[];
  kolomDiabaikan: string[];
};

/**
 * Nilai sel yang sudah dibersihkan.
 *
 * "XX" dan sejenisnya dipakai di file BJU sebagai penanda "belum diketahui".
 * Diperlakukan sebagai kosong, bukan disimpan apa adanya, supaya tidak ada
 * yang membacanya sebagai nomor polisi sungguhan di feed alert.
 */
export function bersihkanNilai(kolom: KolomData | 'vhcid', mentah: unknown): string | null {
  let v = String(mentah ?? '').trim();
  if (!v) return null;
  if (kolom === 'no_plat' && /^x+$/i.test(v)) return null;
  // VHCID selalu huruf besar: file dari sumber berbeda kadang huruf kecil, dan
  // dua ejaan untuk unit yang sama akan tampak sebagai dua unit berbeda.
  if (kolom === 'vhcid') v = v.toUpperCase();
  return v;
}

/**
 * Bandingkan baris file dengan isi database dan tentukan apa yang berubah.
 *
 * @param kosongkan  Bila false (default), sel kosong berarti "biarkan apa
 *   adanya". Bila true, sel kosong berarti "hapus nilainya".
 *
 *   Defaultnya sengaja yang tidak merusak. File yang dikirim cabang sering
 *   hanya memuat kolom yang mereka urus; kalau sel kosong dianggap perintah
 *   menghapus, satu file parsial bisa mengosongkan cabang dan project seluruh
 *   armada sekaligus — dan alert yang sudah terlanjur diperkaya tidak ikut
 *   kembali sendiri setelah diperbaiki.
 */
export function bandingkan(
  baris: { baris: number; nilai: NilaiBaris }[],
  existing: Map<string, Record<string, unknown>>,
  kosongkan: boolean,
): HasilBaris[] {
  return baris.map(({ baris: n, nilai }) => {
    const vhcid = nilai.vhcid as string;
    const lama = existing.get(vhcid);
    const perubahan: Perubahan[] = [];
    const data: Record<string, string | null> = { vhcid };

    for (const k of KOLOM_DATA) {
      if (!(k in nilai)) continue;           // kolom tidak ada di file
      const baru = nilai[k] ?? null;
      if (baru === null && !kosongkan) continue; // sel kosong = biarkan

      data[k] = baru;

      const sebelum = lama ? ((lama[k] as string | null) ?? null) : null;
      if (sebelum !== baru) perubahan.push({ kolom: k, dari: sebelum, ke: baru });
    }

    const aksi = !lama ? 'baru' : perubahan.length ? 'ubah' : 'sama';

    /*
      VHCID adalah identitas PERANGKAT GPS, bukan kendaraannya. Kalau nomor
      rangka berubah untuk VHCID yang sama, artinya perangkat itu dipindah ke
      kendaraan lain — bukan sekadar koreksi ketik. Perubahan seperti ini tetap
      diterapkan, tapi ditandai supaya tidak lewat tanpa disadari: riwayat alert
      unit itu sebelumnya milik kendaraan yang berbeda.
    */
    const gantiRangka =
      aksi === 'ubah' &&
      perubahan.some((p) => p.kolom === 'no_rangka' && p.dari !== null);

    return { baris: n, vhcid, aksi, perubahan, gantiRangka, data };
  });
}

/**
 * Parser CSV sederhana (RFC 4180): koma sebagai pemisah, tanda kutip ganda
 * untuk mengapit, dan `""` sebagai kutip harfiah di dalamnya.
 *
 * Ditulis sendiri, bukan memakai pembaca CSV milik ExcelJS: pembaca itu
 * bergantung pada stream Node yang gagal diam-diam di runtime serverless —
 * berkas CSV yang sah ditolak dengan pesan "tidak terbaca", dan penyebabnya
 * tidak terlihat sama sekali dari sisi pengguna.
 */
export function parseCsv(teks: string): string[][] {
  // BOM dari Excel akan menempel di header pertama dan membuat "VHCID" tidak
  // dikenali sebagai kolom kunci.
  const t = teks.replace(/^\uFEFF/, '');
  const baris: string[][] = [];
  let sel = '';
  let kini: string[] = [];
  let dalamKutip = false;

  for (let i = 0; i < t.length; i++) {
    const c = t[i];

    if (dalamKutip) {
      if (c === '"') {
        if (t[i + 1] === '"') { sel += '"'; i++; }
        else dalamKutip = false;
      } else sel += c;
      continue;
    }

    if (c === '"') dalamKutip = true;
    else if (c === ',') { kini.push(sel); sel = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      kini.push(sel);
      baris.push(kini);
      kini = [];
      sel = '';
    } else sel += c;
  }
  if (sel !== '' || kini.length) { kini.push(sel); baris.push(kini); }

  // Baris yang seluruh selnya kosong dibuang: berkas CSV lazim diakhiri baris
  // baru, dan tanpa ini selalu ada satu baris hantu di akhir.
  return baris.filter((r) => r.some((s) => s.trim() !== ''));
}
