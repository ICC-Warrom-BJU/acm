import { redirect } from 'next/navigation';
import { getCurrentUser, isStaff } from '@/lib/supabase/server';
import { Dashboard } from '@/components/Dashboard';

// Sesi dibaca per permintaan, jadi halaman ini tidak boleh di-cache statis.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getCurrentUser();

  // Middleware sudah menjaga rute ini, tapi pemeriksaan kedua di sini disengaja:
  // keamanan tidak bergantung pada satu titik saja (PRD §4).
  if (!user) redirect('/login');

  return <Dashboard name={user.fullName} role={user.role} isStaff={isStaff(user.role)} />;
}
