'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  staff_it: 'Staff IT',
  management: 'Management',
};

export function UserMenu({ name, role }: { name: string; role: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await createClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-content-secondary">{ROLE_LABEL[role] ?? role}</p>
      </div>
      <button
        onClick={signOut}
        disabled={busy}
        className="rounded-btn border border-line px-3 py-1.5 text-sm text-content-secondary transition-colors hover:border-brand hover:text-content-primary disabled:opacity-60"
      >
        {busy ? '…' : 'Keluar'}
      </button>
    </div>
  );
}
