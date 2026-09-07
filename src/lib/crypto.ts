import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Enkripsi token API sumber alert (PRD §10).
 *
 * Token EASYGO adalah kredensial produksi yang memberi akses ke seluruh data
 * armada. Ia disimpan terenkripsi di database dan tidak pernah dikembalikan
 * utuh ke frontend — UI hanya menerima bentuk ter-mask.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // panjang nonce yang direkomendasikan untuk GCM
const TAG_LEN = 16;

function key(): Buffer {
  const raw = process.env.ACM_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ACM_ENCRYPTION_KEY belum diset. Buat dengan: openssl rand -base64 32',
    );
  }
  // Di-hash ke 32 byte supaya panjang kunci apa pun tetap valid untuk AES-256,
  // tanpa diam-diam memotong kunci yang terlalu pendek.
  return createHash('sha256').update(raw).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptToken(stored: string): string {
  const buf = Buffer.from(stored, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Bentuk yang aman ditampilkan di UI konfigurasi sumber (PRD §9). */
export function maskToken(stored: string | null): string | null {
  if (!stored) return null;
  try {
    const plain = decryptToken(stored);
    if (plain.length <= 4) return '••••';
    return '••••••••' + plain.slice(-4);
  } catch {
    return '••••••••';
  }
}

/**
 * Verifikasi rahasia endpoint internal. Dibandingkan dengan waktu tetap supaya
 * penyerang tidak bisa menebak rahasia karakter demi karakter dari selisih
 * waktu respons.
 */
export function verifyInternalSecret(provided: string | null): boolean {
  const expected = process.env.ACM_INTERNAL_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
