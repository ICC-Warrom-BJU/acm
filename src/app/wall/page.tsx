import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { Dashboard } from '@/components/Dashboard';

/**
 * Dashboard Wall Display (UIUX §6, §7).
 *
 * Route terpisah dari `/` karena perilakunya memang berbeda: selalu gelap,
 * tanpa toggle mode, tanpa menu pengguna, sidebar diciutkan jadi ikon saja, dan
 * skala huruf ~1.6-2x. Di layar bersama, operator tidak boleh tidak sengaja
 * mengubah mode atau keluar dari sesi.
 */
export const dynamic = 'force-dynamic';

export default async function WallPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <Dashboard name={user.fullName} role={user.role} wall />;
}
