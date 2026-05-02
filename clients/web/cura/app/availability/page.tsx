import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Nav } from '@/components/nav';
import { getMyAvailability } from '@/lib/api/availability';
import { getCurrentUser } from '@/lib/auth/dal';
import { getSessionToken } from '@/lib/auth/session';
import { AvailabilityManager } from './manager';

export default async function AvailabilityPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  if (user.role !== 'doctor') redirect('/meetings');

  const token = await getSessionToken();
  if (!token) redirect('/sign-in');

  const { availability } = await getMyAvailability(token);

  return (
    <div className="min-h-screen bg-white">
      <Nav user={user} token={token} />

      <main className="max-w-xl mx-auto px-6 pt-28 pb-24">
        <Link
          href="/meetings"
          className="inline-flex items-center gap-1.5 text-xs text-black/35 hover:text-[#b5471b] transition-colors mb-8"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Voltar às consultas
        </Link>

        <h1 className="text-2xl font-semibold text-black mb-2">
          A minha disponibilidade
        </h1>
        <p className="text-sm text-black/40 mb-10">
          Defina os horários semanais em que os doentes podem marcar consultas consigo.
        </p>

        <AvailabilityManager initialAvailability={availability} token={token} />
      </main>
    </div>
  );
}
