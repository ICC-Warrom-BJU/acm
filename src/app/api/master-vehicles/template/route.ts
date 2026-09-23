import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { LABEL_KOLOM, KOLOM_DATA } from '@/lib/master-import';

/**
 * GET /api/master-vehicles/template?isi=data|kosong
 *
 * Default `data`: template berisi seluruh unit yang sekarang terdaftar, supaya
 * pembaruan massal jadi sunting-lalu-unggah — bukan mengetik ulang dari nol.
 * Cara ini juga membuat VHCID-nya pasti cocok; mengetik ulang VHCID adalah
 * sumber paling mungkin unit "baru" yang sebenarnya duplikat salah ketik.
 *
 * Datanya mengikuti RLS pengguna: Management ber-scope cabang hanya mengunduh
 * cabangnya sendiri.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Belum login' }, { status: 401 });

  const kosong = req.nextUrl.searchParams.get('isi') === 'kosong';
  const urutan = ['vhcid', ...KOLOM_DATA] as const;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Master Unit');

  ws.columns = urutan.map((k) => ({
    header: LABEL_KOLOM[k],
    key: k,
    width: k === 'vhcid' ? 16 : k === 'no_rangka' ? 24 : 18,
  }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  if (!kosong) {
    const db = createServerSupabase();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('master_vehicles')
        .select('vhcid, no_plat, no_rangka, cabang, group_project, vendor, jenis_gps')
        .order('vhcid')
        .range(from, from + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      for (const r of data ?? []) ws.addRow(r);
      if ((data?.length ?? 0) < 1000) break;
    }
  }

  const pet = wb.addWorksheet('Petunjuk');
  pet.columns = [{ width: 100 }];
  [
    'Cara memakai berkas ini',
    '',
    'VHCID adalah kuncinya. Baris dengan VHCID yang sudah terdaftar akan MEMPERBARUI',
    'unit itu; VHCID yang belum ada akan DITAMBAHKAN sebagai unit baru.',
    '',
    'Jangan mengubah isi kolom VHCID pada baris yang sudah ada. Mengubahnya tidak',
    'mengganti nama unit — ia membuat unit baru, dan yang lama tetap ada.',
    '',
    'Sel yang dikosongkan secara bawaan berarti "biarkan seperti sekarang", bukan',
    '"hapus isinya". Untuk benar-benar mengosongkan sebuah nilai, centang pilihan',
    'yang tersedia di halaman import sebelum menyimpan.',
    '',
    'Unit yang terdaftar tapi tidak muncul di berkas ini tidak akan terpengaruh.',
    'Import tidak pernah menghapus unit.',
    '',
    'Nama kolom boleh berbeda ejaan (mis. "No. Polisi", "NoPol", "Plat Nomor") —',
    'kolom yang tidak dikenali akan dilaporkan sebagai diabaikan pada pratinjau,',
    'bukan diam-diam dibuang.',
  ].forEach((t) => pet.addRow([t]));
  pet.getRow(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  const nama = kosong ? 'template-master-unit.xlsx' : 'master-unit.xlsx';

  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nama}"`,
      'Cache-Control': 'no-store',
    },
  });
}
