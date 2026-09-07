/**
 * Buat akun pengguna ACM beserta rolenya.
 *
 * Pakai:
 *   node --env-file=.env.local scripts/create-user.mjs <email> <role> ["Nama Lengkap"] [cabang,cabang]
 *
 * Contoh:
 *   ... scripts/create-user.mjs hajir@bju.co.id super_admin "Hajir"
 *   ... scripts/create-user.mjs ops@bju.co.id staff_it "Operator ICC"
 *   ... scripts/create-user.mjs mgr@bju.co.id management "Manajer Makassar" MKS1,MKS2
 *
 * Pendaftaran mandiri sengaja tidak dibuka: trigger handle_new_user memberi role
 * terendah (management) ke siapa pun yang mendaftar, jadi kenaikan hak akses
 * harus selalu merupakan tindakan sadar seseorang — bukan efek samping signup.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const [email, role, fullName = '', cabang = ''] = process.argv.slice(2);
const ROLES = ['super_admin', 'staff_it', 'management'];

if (!email || !ROLES.includes(role)) {
  console.error('Pakai: node --env-file=.env.local scripts/create-user.mjs <email> <role> ["Nama"] [cabang,cabang]');
  console.error(`role: ${ROLES.join(' | ')}`);
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Kata sandi awal dibangkitkan acak, bukan ditentukan di sini, supaya tidak ada
// nilai default yang bisa ditebak dan tidak ada kata sandi yang tersimpan di
// riwayat perintah.
const password = randomBytes(12).toString('base64url');

const { data, error } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
});

if (error) {
  console.error('Gagal membuat akun:', error.message);
  if (/already/i.test(error.message)) {
    console.error('Akun sudah ada. Untuk mengubah rolenya, jalankan skrip ini dengan email lain');
    console.error('atau ubah langsung di tabel user_profiles.');
  }
  process.exit(1);
}

// Trigger handle_new_user sudah membuat baris profilnya dengan role terendah.
// Di sini role-nya dinaikkan sesuai yang diminta.
const { error: pErr } = await db
  .from('user_profiles')
  .update({
    role,
    full_name: fullName,
    cabang_scope: cabang ? cabang.split(',').map((c) => c.trim()).filter(Boolean) : null,
  })
  .eq('user_id', data.user.id);

if (pErr) {
  console.error('Akun dibuat tapi gagal menetapkan role:', pErr.message);
  process.exit(1);
}

const { data: profile } = await db
  .from('user_profiles')
  .select('full_name, role, cabang_scope')
  .eq('user_id', data.user.id)
  .single();

console.log('\nAkun dibuat.');
console.log('  Email        :', email);
console.log('  Nama         :', profile.full_name || '(kosong)');
console.log('  Role         :', profile.role);
console.log('  Cabang scope :', profile.cabang_scope?.join(', ') ?? 'seluruh cabang');
console.log('\n  Kata sandi awal:', password);
console.log('\nSegera ganti kata sandi setelah login pertama — nilai di atas muncul');
console.log('di layar dan kemungkinan tersimpan di riwayat terminal.');
