import type { Alert } from './alert';

/**
 * Penyaring tampilan alert per cabang.
 *
 * Ini filter TAMPILAN saja. Alert tetap dipolling, disimpan, diagregasi ke
 * ringkasan harian, dan ikut terekspor — yang berubah hanya apa yang muncul di
 * dashboard. Menyaring di sini bisa dibatalkan kapan saja; menyaring saat
 * polling akan membuang data secara permanen.
 */

export interface KonfigCabang {
  cabang: string;
  /** NULL = tanpa batasan. Array kosong = cabang dibisukan total. */
  alert_types: string[] | null;
}

export function buatPenyaring(konfig: KonfigCabang[]) {
  const peta = new Map<string, string[] | null>(
    konfig.map((k) => [k.cabang, k.alert_types]),
  );

  return (a: Alert) => {
    /*
      Alert dari unit yang belum terdaftar di master data SELALU tampil.

      Cabangnya null, jadi tidak ada aturan yang bisa dicocokkan — dan
      menyembunyikannya justru berbahaya: unit yang belum terdaftar adalah
      justru yang paling perlu diketahui keberadaannya (PRD §7.3). Kalau
      disembunyikan, ia hilang dari dashboard tanpa pernah ada yang tahu unit
      itu belum masuk master data.
    */
    if (!a.cabang) return true;

    // Cabang yang belum pernah dikonfigurasi tampil apa adanya, supaya cabang
    // baru dari master data tidak diam-diam kehilangan seluruh alertnya.
    if (!peta.has(a.cabang)) return true;

    const izin = peta.get(a.cabang);
    if (izin == null) return true;

    return izin.includes(a.alert_type);
  };
}

/** Ringkasan singkat untuk ditampilkan di UI konfigurasi. */
export function ringkasKonfig(k: KonfigCabang, totalJenis: number) {
  if (k.alert_types == null) return 'Semua jenis tampil';
  if (k.alert_types.length === 0) return 'Dibisukan — tidak ada yang tampil';
  if (k.alert_types.length === totalJenis) return 'Semua jenis tampil';
  return `${k.alert_types.length} dari ${totalJenis} jenis tampil`;
}
