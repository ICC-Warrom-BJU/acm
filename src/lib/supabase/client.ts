'use client';

import { createBrowserClient } from '@supabase/ssr';

/** Klien browser. Tunduk pada RLS — inilah yang menegakkan cabang_scope. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
