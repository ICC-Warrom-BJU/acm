import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getCurrentUser, isStaff } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  petakanHeader, bersihkanNilai, bandingkan, parseCsv,
  type NilaiBaris, type Masalah, type Ringkasan,
} from '@/lib/master-import';

/**
 * POST /api/master-vehicles/import — import & update massal master unit.
 *
 * Dua tahap dengan endpoint yang sama:
 *   mode=preview  -> hanya membaca; mengembalikan apa yang AKAN berubah
 *   mode=commit   -> menulis
 *
 * Preview bukan formalitas: tabel ini rujukan seluruh alert, dan satu file
 * salah kolom bisa memindahkan ratusan unit ke cabang yang keliru tanpa ada
 * yang menyadarinya sampai laporan bulanan tidak cocok.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Batas baris per file. Armada yang diantisipasi 1000+ unit; 5000 memberi
// ruang longgar sambil tetap menahan file yang jelas keliru (mis. export
// mentah berisi puluhan ribu baris log) sebelum memakan memori fungsi.
const MAKS_BARIS = 5000;
const MAKS_BYTE = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Belum login' }, { status: 401 });
  if (!isStaff(user.role)) {
    return NextResponse.json(
      { error: 'Hanya Staff IT dan Super Admin yang dapat mengubah master data.' },
      { status: 403 },
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: 'File tidak ditemukan.' }, { status: 400 });
  }
  if (file.size > MAKS_BYTE) {
    return NextResponse.json(
      { error: `Ukuran file melebihi ${MAKS_BYTE / 1024 / 1024} MB.` },
      { status: 400 },
    );
  }

  const commit = form.get('mode') === 'commit';
  const kosongkan = form.get('kosongkan') === 'true';

  // --- baca berkas jadi kisi teks -------------------------------------------
  // Excel dan CSV disatukan jadi satu bentuk (kisi string) lebih dulu, supaya
  // sisa logikanya tidak perlu tahu berkasnya datang dari mana.
  const buf = Buffer.from(await file.arrayBuffer());
  let kisi: string[][];

  const sel = (c: unknown): string => {
    if (c == null) return '';
    if (typeof c === 'object') {
      const o = c as { text?: unknown; result?: unknown };
      return String(o.text ?? o.result ?? '').trim();
    }
    return String(c).trim();
  };

  try {
    if (/\.csv$/i.test(file.name)) {
      kisi = parseCsv(buf.toString('utf8'));
    } else {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      if (!ws) throw new Error('sheet kosong');
      kisi = [];
      ws.eachRow((row) => {
        kisi.push((row.values as unknown[]).slice(1).map(sel));
      });
    }
  } catch {
    return NextResponse.json(
      { error: 'Berkas tidak terbaca. Pastikan formatnya .xlsx atau .csv.' },
      { status: 400 },
    );
  }

  if (kisi.length < 2) {
    return NextResponse.json(
      { error: 'Berkas kosong atau tidak punya baris data di bawah header.' },
      { status: 400 },
    );
  }

  const header = kisi[0].map(sel);
  const cols = petakanHeader(header);

  if (!cols.includes('vhcid')) {
    return NextResponse.json(
      {
        error:
          'Kolom VHCID tidak ditemukan. File wajib punya kolom VHCID — itu kunci yang ' +
          'menentukan unit mana yang diperbarui. Header terbaca: ' +
          header.filter(Boolean).join(', '),
      },
      { status: 400 },
    );
  }

  // --- parse baris ----------------------------------------------------------
  const masalah: Masalah[] = [];
  const terlihat = new Map<string, number>();
  const baris: { baris: number; nilai: NilaiBaris }[] = [];

  for (let n = 2; n <= kisi.length; n++) {
    if (baris.length >= MAKS_BARIS) break;
    const vals = kisi[n - 1].map(sel);

    const nilai: NilaiBaris = {};
    cols.forEach((c, i) => {
      if (c) nilai[c] = bersihkanNilai(c, vals[i]);
    });

    if (!nilai.vhcid) {
      // Baris kosong di akhir sheet lazim dan bukan kesalahan pengguna —
      // tidak perlu dilaporkan sebagai masalah.
      if (vals.some((v) => v)) masalah.push({ baris: n, pesan: 'VHCID kosong — baris dilewati.' });
      continue;
    }
    const kembar = terlihat.get(nilai.vhcid);
    if (kembar) {
      masalah.push({
        baris: n,
        pesan: `VHCID ${nilai.vhcid} sudah ada di baris ${kembar} — baris ini dilewati.`,
      });
      continue;
    }
    terlihat.set(nilai.vhcid, n);
    baris.push({ baris: n, nilai });
  }

  if (kisi.length - 1 > MAKS_BARIS) {
    masalah.push({
      baris: 0,
      pesan: `File memuat lebih dari ${MAKS_BARIS} baris; hanya ${MAKS_BARIS} pertama yang diproses.`,
    });
  }
  if (baris.length === 0) {
    return NextResponse.json({ error: 'Tidak ada baris dengan VHCID yang bisa diproses.' }, { status: 400 });
  }

  // --- ambil kondisi sekarang ----------------------------------------------
  const db = createAdminClient();
  const existing = new Map<string, Record<string, unknown>>();
  const idAll = [...terlihat.keys()];
  for (let i = 0; i < idAll.length; i += 500) {
    const { data, error } = await db
      .from('master_vehicles')
      // Daftar kolom ditulis harfiah, bukan dirangkai dari KOLOM_DATA:
      // PostgREST hanya bisa menyimpulkan tipe barisnya dari string literal.
      .select('vhcid, no_plat, no_rangka, cabang, group_project, vendor, jenis_gps')
      .in('vhcid', idAll.slice(i, i + 500));
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    for (const r of data ?? []) existing.set(r.vhcid, r as unknown as Record<string, unknown>);
  }

  const { count: totalDb } = await db
    .from('master_vehicles')
    .select('vhcid', { count: 'exact', head: true });

  const hasil = bandingkan(baris, existing, kosongkan);

  const ringkasan: Ringkasan = {
    baris: hasil,
    masalah,
    takDisebut: Math.max(0, (totalDb ?? 0) - existing.size),
    kolomTerpakai: [...new Set(cols.filter(Boolean))] as Ringkasan['kolomTerpakai'],
    kolomDiabaikan: header.filter((h, i) => h && !cols[i]),
  };

  if (!commit) return NextResponse.json({ ok: true, preview: true, ...ringkasan });

  // --- tulis ----------------------------------------------------------------
  // Baris yang tidak berubah sengaja tidak ikut dikirim: menulis ulang 500 baris
  // identik hanya memajukan `updated_at` dan `updated_by` seluruh armada,
  // sehingga kolom itu berhenti berarti "terakhir benar-benar diubah".
  const tulis = hasil.filter((h) => h.aksi !== 'sama');
  let ditulis = 0;

  for (let i = 0; i < tulis.length; i += 200) {
    const batch = tulis.slice(i, i + 200).map((h) => ({
      ...h.data,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await db.from('master_vehicles').upsert(batch, { onConflict: 'vhcid' });
    if (error) {
      return NextResponse.json(
        {
          error: `Gagal pada baris ke-${i + 1} dan seterusnya: ${error.message}. ` +
                 `${ditulis} unit sudah tersimpan sebelum kegagalan ini.`,
          ditulis,
        },
        { status: 400 },
      );
    }
    ditulis += batch.length;
  }

  return NextResponse.json({
    ok: true,
    preview: false,
    ditulis,
    baru: tulis.filter((h) => h.aksi === 'baru').length,
    diubah: tulis.filter((h) => h.aksi === 'ubah').length,
    sama: hasil.length - tulis.length,
    masalah,
  });
}
