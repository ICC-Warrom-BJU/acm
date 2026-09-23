import { createAdminClient } from './supabase/admin';
import { decryptToken } from './crypto';
import {
  getPath,
  parseTimestamp,
  parseCoord,
  parseText,
  formatEasygoTime,
  deriveSeverity,
} from './normalize';
import { createHash } from 'node:crypto';
import { businessDate } from './time';

/**
 * Satu siklus polling untuk satu sumber alert (PRD §5.2 langkah 3).
 *
 * Sengaja generik: tidak ada satu pun cabang khusus per endpoint di sini.
 * Semua perbedaan antar API hidup di baris `alert_sources` — itulah yang
 * membuat sumber baru bisa ditambah lewat UI tanpa deploy ulang (PRD §2.2).
 */

export interface PollResult {
  source: string;
  success: boolean;
  httpStatus: number | null;
  responseCode: number | null;
  durationMs: number;
  recordsFetched: number;
  recordsNew: number;
  recordsDeduped: number;
  recordsSkipped: number;
  /** Nilai discriminator yang muncul tapi belum dipetakan/diaktifkan di master data. */
  unmappedTypes: string[];
  error: string | null;
}

interface AlertRow {
  source_id: string;
  vhcid: string | null;
  alert_type: string;
  severity: string;
  lat: number | null;
  long: number | null;
  no_plat: string | null;
  raw_payload: any;
  first_seen_at: string;
  last_seen_at: string;
}

/**
 * Penyetelan window untuk satu panggilan, di luar konfigurasi sumber.
 *
 * Dipakai sapuan rekonsiliasi harian: data EASYGO terbit terlambat dan baru
 * lengkap pada umur sekitar satu jam (FINDINGS 6.5), jadi polling biasa selalu
 * meninggalkan ekor. Sapuan menariknya ulang saat datanya sudah pasti lengkap.
 */
export interface OpsiWindow {
  /** Panjang window, menggantikan `time_window_lookback_seconds`. */
  lookbackSeconds?: number;
  /** Geser ujung window ke belakang sekian detik dari sekarang. */
  offsetSeconds?: number;
}

export async function pollSource(
  sourceId: string,
  opsi: OpsiWindow = {},
): Promise<PollResult> {
  const db = createAdminClient();
  const startedAt = Date.now();

  const { data: src, error: srcErr } = await db
    .from('alert_sources')
    .select('*')
    .eq('id', sourceId)
    .single();

  if (srcErr || !src) {
    throw new Error(`Sumber ${sourceId} tidak ditemukan: ${srcErr?.message ?? 'kosong'}`);
  }

  const result: PollResult = {
    source: src.name,
    success: false,
    httpStatus: null,
    responseCode: null,
    durationMs: 0,
    recordsFetched: 0,
    recordsNew: 0,
    recordsDeduped: 0,
    recordsSkipped: 0,
    unmappedTypes: [],
    error: null,
  };

  try {
    const { body, headers } = buildRequest(src, opsi);
    const { httpStatus, payload } = await callSource(src, body, headers);
    result.httpStatus = httpStatus;

    // Envelope EASYGO: ResponseCode 1 = sukses, 0 = gagal — dan HTTP-nya
    // SELALU 200, bahkan saat token ditolak. Menilai keberhasilan dari status
    // HTTP akan membuat sumber yang tokennya mati terlihat sehat terus.
    const responseCode = numberOrNull(payload?.ResponseCode);
    result.responseCode = responseCode;

    if (responseCode !== null && responseCode !== 1) {
      throw new Error(
        `API menolak permintaan (ResponseCode ${responseCode}): ` +
          `${payload?.ResponseMessage ?? 'tanpa pesan'}`,
      );
    }

    const records = extractRecords(payload, src.data_path);
    result.recordsFetched = records.length;

    const mappings = await loadTypeMappings(db, src.id);

    const rows: AlertRow[] = [];
    const discovered = new Map<string, { count: number; sample: any }>();

    for (const rec of records) {
      const { row, rawValue } = mapRecord(src, rec, mappings);

      if (rawValue) {
        const prev = discovered.get(rawValue);
        if (prev) prev.count++;
        else discovered.set(rawValue, { count: 1, sample: rec });
      }

      if (row) rows.push(row);
      else result.recordsSkipped++;
    }

    await recordDiscoveries(db, src.id, discovered);
    result.unmappedTypes = Array.from(discovered.keys()).filter(
      (v) => !mappings.get(v.toLowerCase().trim())?.is_active,
    );

    if (rows.length > 0) {
      const { newCount, dedupCount } = await upsertAlerts(db, rows);
      result.recordsNew = newCount;
      result.recordsDeduped = dedupCount;
    }

    result.success = true;
  } catch (err: any) {
    result.error = String(err?.message ?? err);
  }

  result.durationMs = Date.now() - startedAt;
  await recordOutcome(db, sourceId, result);
  return result;
}

// ---------------------------------------------------------------------------

function numberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Susun body permintaan, termasuk window waktu bergulir.
 *
 * Window sengaja dibuka lebih lebar dari interval polling (lookback default
 * 900 s untuk interval 300 s). Tanpa tumpang tindih ini, kejadian yang tercatat
 * di API tepat setelah satu polling selesai akan lolos dari polling berikutnya.
 * Duplikat yang timbul dari tumpang tindih tidak jadi masalah — dedup harian
 * di database yang menyerapnya.
 */
function buildRequest(src: any, opsi: OpsiWindow = {}) {
  const body: Record<string, any> = { ...(src.body_template ?? {}) };

  if (src.time_window_enabled) {
    const now = new Date(Date.now() - (opsi.offsetSeconds ?? 0) * 1000);
    const panjang = opsi.lookbackSeconds ?? src.time_window_lookback_seconds;
    const from = new Date(now.getTime() - panjang * 1000);
    // Offset diambil per sumber: dua endpoint EASYGO membaca window dalam zona
    // waktu yang berbeda (speed_flag UTC, Notifikasi WIB). Menyamakan keduanya
    // akan membuat salah satu selalu mengembalikan window yang keliru — dan
    // API tetap menjawab "success", jadi kesalahannya tidak akan terlihat.
    const offset = src.time_window_offset_hours ?? 0;
    body[src.time_window_start_field] = formatEasygoTime(from, offset);
    body[src.time_window_stop_field] = formatEasygoTime(now, offset);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(src.headers_template ?? {}),
  };

  if (src.token_encrypted && src.auth_type !== 'none') {
    const token = decryptToken(src.token_encrypted);
    switch (src.auth_type) {
      case 'bearer':
        headers['Authorization'] = `Bearer ${token}`;
        break;
      case 'basic':
        headers['Authorization'] = `Basic ${token}`;
        break;
      case 'api_key':
      case 'custom_header':
      default:
        // EASYGO memakai header bernama `token` dengan nilai mentah.
        // Nama headernya dapat dikonfigurasi supaya sumber lain tetap terlayani.
        headers[src.auth_header_name || 'token'] = token;
        break;
    }
  }

  return { body, headers };
}

async function callSource(src: any, body: any, headers: Record<string, string>) {
  // Batas waktu sendiri: tanpa ini, satu API yang menggantung akan menahan
  // fungsi serverless sampai platform memutusnya, dan sumber lain ikut telat.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000);

  try {
    const res = await fetch(src.endpoint_url, {
      method: src.method,
      headers,
      body: src.method === 'POST' ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
      cache: 'no-store',
    });

    const text = await res.text();
    let payload: any = null;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(
        `Response bukan JSON (HTTP ${res.status}): ${text.slice(0, 200)}`,
      );
    }
    return { httpStatus: res.status, payload };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Timeout 60 detik saat memanggil API sumber');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Response bisa berupa array langsung atau dibungkus envelope seperti `Data`. */
function extractRecords(payload: any, dataPath: string | null): any[] {
  if (Array.isArray(payload)) return payload;
  const inner = getPath(payload, dataPath ?? 'Data');
  if (Array.isArray(inner)) return inner;
  if (inner && typeof inner === 'object') return [inner];
  return [];
}

interface TypeMapping {
  alert_type: string | null;
  severity: string | null;
  is_active: boolean;
}

/**
 * Muat master data pemetaan jenis notifikasi untuk satu sumber.
 *
 * Dikunci pada bentuk huruf kecil karena penulisan `tipe_notif` di API tidak
 * konsisten — ada yang UPPERCASE (IDLE), ada yang Title Case (Forbidden Parking).
 */
async function loadTypeMappings(db: any, sourceId: string) {
  const { data, error } = await db
    .from('alert_type_master')
    .select('notif_value, alert_type, severity, is_active')
    .eq('source_id', sourceId);

  if (error) throw new Error(`Gagal memuat master jenis alert: ${error.message}`);

  const map = new Map<string, TypeMapping>();
  for (const row of data ?? []) {
    map.set(String(row.notif_value).toLowerCase().trim(), row);
  }
  return map;
}

/**
 * Tentukan alert_type satu record.
 *
 * Sumber berbagi endpoint (Notifikasi/Operation mengirim OVERSPEED, IDLE,
 * Forbidden Parking, ... tercampur) dipecah lewat `discriminator_path` +
 * master data. Jenis yang belum dipetakan atau belum diaktifkan dilewati,
 * bukan disimpan apa adanya: memasukkan alert_type tak dikenal akan mengotori
 * filter dashboard dan laporan tanpa ada yang menyadarinya. Nilainya tetap
 * tercatat sebagai temuan (lihat recordDiscoveries) supaya bisa ditinjau.
 */
function resolveType(
  src: any,
  rec: any,
  mappings: Map<string, TypeMapping>,
): { alertType: string | null; severity: string | null; rawValue: string | null } {
  if (!src.discriminator_path) {
    return { alertType: src.alert_type, severity: null, rawValue: null };
  }

  const raw = parseText(getPath(rec, src.discriminator_path));
  if (!raw) return { alertType: null, severity: null, rawValue: null };

  const m = mappings.get(raw.toLowerCase().trim());
  if (!m || !m.is_active || !m.alert_type) {
    return { alertType: null, severity: null, rawValue: raw };
  }

  return { alertType: m.alert_type, severity: m.severity, rawValue: raw };
}

function mapRecord(
  src: any,
  rec: any,
  mappings: Map<string, TypeMapping>,
): { row: AlertRow | null; rawValue: string | null } {
  const fm = (src.field_mapping ?? {}) as Record<string, string>;
  const { alertType, severity, rawValue } = resolveType(src, rec, mappings);

  if (!alertType) return { row: null, rawValue };

  const vhcid = parseText(getPath(rec, fm.vhcid_path));

  // Offset cadangan diambil dari sumber, bukan konstanta: dipakai hanya kalau
  // timestamp datang tanpa penanda zona waktu sama sekali. Menebak dengan satu
  // nilai tetap akan menggeser kejadian berjam-jam tanpa gejala apa pun.
  const ts =
    parseTimestamp(getPath(rec, fm.timestamp_path), src.time_window_offset_hours ?? 0) ??
    new Date().toISOString();

  return {
    row: {
      source_id: src.id,
      vhcid,
      alert_type: alertType,
      // Severity dari master data lebih diutamakan; aturan turunan hanya dipakai
      // kalau master belum menetapkannya.
      severity: severity ?? deriveSeverity(alertType, rec),
      lat: parseCoord(getPath(rec, fm.lat_path)),
      long: parseCoord(getPath(rec, fm.long_path)),
      no_plat: parseText(getPath(rec, fm.no_plat_path)),
      raw_payload: rec,
      first_seen_at: ts,
      last_seen_at: ts,
    },
    rawValue,
  };
}

/**
 * Catat setiap nilai discriminator yang muncul, termasuk yang sudah dikenal.
 *
 * Inilah jalan agar jenis baru bisa ditemukan tanpa menebak: kalau nanti EASYGO
 * mulai mengirim jenis fatigue driving, ia langsung muncul di master data
 * sebagai jenis belum terpetakan, lengkap dengan contoh payload dan hitungan
 * kemunculannya — tinggal diberi alert_type lalu diaktifkan lewat UI.
 */
async function recordDiscoveries(
  db: any,
  sourceId: string,
  counts: Map<string, { count: number; sample: any }>,
) {
  if (counts.size === 0) return;

  const payload = Array.from(counts.entries()).map(([value, v]) => ({
    value,
    count: v.count,
    sample: v.sample,
  }));

  // Kegagalan di sini tidak boleh menggagalkan polling: ini catatan bantu,
  // bukan jalur utama data alert.
  const { error } = await db.rpc('record_discovered_types', {
    p_source_id: sourceId,
    p_types: payload,
  });
  if (error) console.warn(`Gagal mencatat jenis notifikasi: ${error.message}`);
}

/**
 * Sidik jari satu record API.
 *
 * Menggantikan penyaring berbasis jam yang dipakai sebelumnya. Alasannya, dari
 * pengukuran 2026-09-23 (FINDINGS 6.5):
 *
 *   EASYGO menerbitkan record terlambat — window 15 menit baru lengkap pada
 *   umur sekitar 63 menit — sehingga lookback harus jauh lebih panjang. Dengan
 *   lookback panjang, satu record dikirim ulang puluhan kali.
 *
 *   Menyaringnya berdasarkan jam tidak cukup: satu unit bisa punya beberapa
 *   record dengan `gps_time` yang sama persis, yaitu segmen berkendara berbeda
 *   yang dipancarkan dalam satu batch. Kalau segmen kedua terbit belakangan,
 *   penyaring jam akan membuangnya sebagai "tidak lebih baru" — kejadian nyata
 *   hilang.
 *
 * Yang ikut dihitung karena itu bukan jamnya, tapi isi record yang membedakan
 * satu kejadian dari kejadian lain: unit, jenis, jam, posisi, dan keterangan.
 * Posisi disertakan justru karena itu yang membedakan segmen-segmen tadi.
 *
 * Dipangkas ke 16 karakter heksadesimal. Bukan untuk keamanan — ini bukan nilai
 * rahasia — melainkan untuk menahan ukuran array pada baris yang menampung
 * ratusan kejadian per hari.
 */
function sidikJari(row: AlertRow, rec: Record<string, any>): string {
  const bahan = [
    row.vhcid ?? '',
    row.alert_type,
    row.first_seen_at,
    row.lat ?? '',
    row.long ?? '',
    String(rec?.ket_notif ?? ''),
  ].join('|');
  return createHash('sha1').update(bahan).digest('hex').slice(0, 16);
}

/**
 * Simpan alert dengan dedup harian (PRD §7.1).
 *
 * Dedup dilakukan oleh unique index parsial `uq_alerts_dedup` lewat
 * ON CONFLICT, bukan oleh pola "SELECT dulu lalu INSERT". Alasannya: window
 * polling kita memang sengaja tumpang tindih, jadi dua siklus bisa memproses
 * kejadian yang sama nyaris bersamaan. Dengan pengecekan di aplikasi, keduanya
 * bisa sama-sama menyimpulkan "belum ada" lalu sama-sama menyisipkan.
 */
async function upsertAlerts(db: any, rows: AlertRow[]) {
  if (rows.length === 0) return { newCount: 0, dedupCount: 0 };

  // Enrich dari master data (PRD §2.3). Satu query untuk seluruh batch,
  // bukan satu per baris — pada 1000+ unit, per-baris akan jadi beban nyata.
  const vhcids = Array.from(
    new Set(rows.map((r) => r.vhcid).filter((v): v is string => !!v)),
  );

  const master = new Map<string, any>();
  if (vhcids.length > 0) {
    const { data } = await db
      .from('master_vehicles')
      .select('vhcid, cabang, group_project, no_plat')
      .in('vhcid', vhcids);
    for (const m of data ?? []) master.set(m.vhcid, m);
  }

  // Gabungkan duplikat di dalam satu batch lebih dulu. ON CONFLICT tidak bisa
  // menyentuh baris yang sama dua kali dalam satu perintah, dan satu window
  // polling memang sering memuat beberapa kejadian untuk unit yang sama.
  type Gabung = AlertRow & { occurrence_count: number; fingerprints: string[] };
  const merged = new Map<string, Gabung>();

  for (const row of rows) {
    const m = row.vhcid ? master.get(row.vhcid) : null;
    const enriched: Gabung = {
      ...row,
      cabang: m?.cabang ?? null,
      group_project: m?.group_project ?? null,
      no_plat: row.no_plat ?? m?.no_plat ?? null,
      occurrence_count: 1,
      fingerprints: [sidikJari(row, row.raw_payload)],
    } as Gabung;

    // Kunci penggabungan HARUS memakai tanggal bisnis (WITA), sama persis
    // dengan kolom generated occurrence_date di database. Memakai tanggal UTC
    // di sini membuat dua kejadian yang menurut database satu baris terkirim
    // sebagai dua, dan ON CONFLICT menolak seluruh perintah.
    const day = businessDate(enriched.first_seen_at);
    const key = `${enriched.vhcid ?? ''}|${enriched.alert_type}|${day}`;
    const prev = merged.get(key);

    if (!prev) {
      merged.set(key, enriched);
    } else {
      // Sidik jari dikumpulkan, bukan dihitung. Database yang memutuskan mana
      // yang benar-benar baru — di sini kita belum tahu apa yang sudah pernah
      // tercatat dari polling sebelumnya.
      if (!prev.fingerprints.includes(enriched.fingerprints[0])) {
        prev.fingerprints.push(enriched.fingerprints[0]);
        prev.occurrence_count += 1;
      }
      if (enriched.first_seen_at < prev.first_seen_at) prev.first_seen_at = enriched.first_seen_at;
      if (enriched.last_seen_at > prev.last_seen_at) {
        prev.last_seen_at = enriched.last_seen_at;
        prev.raw_payload = enriched.raw_payload; // simpan kejadian terbaru
        prev.severity = enriched.severity;
      }
    }
  }

  const payload = Array.from(merged.values());

  const { data, error } = await db.rpc('upsert_alerts', { p_rows: payload });
  if (error) throw new Error(`Gagal menyimpan alert: ${error.message}`);

  const newCount = Number(data?.[0]?.inserted ?? 0);
  return { newCount, dedupCount: payload.length - newCount };
}

/** Perbarui kesehatan sumber + tulis log diagnostik (PRD §5.2 langkah 3). */
async function recordOutcome(db: any, sourceId: string, r: PollResult) {
  const patch = r.success
    ? { last_success_at: new Date().toISOString(), last_error: null, consecutive_failures: 0 }
    : { last_error: r.error };

  await db.from('alert_sources').update(patch).eq('id', sourceId);

  // Penghitung kegagalan dinaikkan lewat RPC, bukan dibaca-lalu-ditulis di sini,
  // supaya dua polling yang gagal bersamaan tidak saling menimpa hitungannya.
  if (!r.success) {
    await db.rpc('bump_source_failure', { p_source_id: sourceId });
  }

  await db.from('polling_logs').insert({
    source_id: sourceId,
    http_status: r.httpStatus,
    response_code: r.responseCode,
    duration_ms: r.durationMs,
    success: r.success,
    records_fetched: r.recordsFetched,
    records_new: r.recordsNew,
    records_deduped: r.recordsDeduped,
    error_message: r.error,
  });
}
