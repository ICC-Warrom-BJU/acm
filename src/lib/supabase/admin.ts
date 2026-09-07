import { createClient } from '@supabase/supabase-js';

/**
 * Klien service-role. Melewati RLS sepenuhnya, jadi HANYA boleh dipakai di
 * jalur server yang tidak menerima identitas pengguna: endpoint polling
 * internal dan job terjadwal.
 *
 * Jangan pernah mengimpor ini dari komponen klien.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset.',
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
