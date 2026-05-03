import { CalendarPlus, Settings2 } from 'lucide-react';
import type { Meeting } from '@/lib/api/types';

import Link from 'next/link';
import { MeetingsList } from './meetings-list';
import { Nav } from '@/components/nav';
import { StartOnSite } from './start-on-site';
import { getCurrentUser } from '@/lib/auth/dal';
import { getSessionToken } from '@/lib/auth/session';
import { listMeetings } from '@/lib/api/meetings';
import { redirect } from 'next/navigation';

function isFuture(m: Meeting) {
  const dt = new Date(`${m.date}T${m.time}`);
  return dt.getTime() > Date.now();
}

export default async function MeetingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const token = await getSessionToken();
  if (!token) redirect('/sign-in');

  const { meetings } = await listMeetings(token);

  const upcoming = meetings.filter(m =>
    isFuture(m) && m.status !== 'canceled' && m.status !== 'rejected'
  );
  const past = meetings.filter(m =>
    !isFuture(m) || m.status === 'canceled' || m.status === 'rejected'
  ).reverse();

  return (
    <div className="min-h-screen bg-white">
      <Nav user={user} token={token} />

      <main className="max-w-xl mx-auto px-6 pt-8 pb-36 md:pt-28 md:pb-20">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <h1 className="text-2xl font-semibold text-black">Consultas</h1>
          <div className="flex items-center gap-2">
            {user.role === 'patient' && (
              <Link
                href="/book"
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-white hover:opacity-90 transition-opacity"
                style={{ background: '#b5471b' }}
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                Marcar consulta
              </Link>
            )}
            {user.role === 'doctor' && (
              <>
                <StartOnSite />
                <Link
                  href="/availability"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors"
                  style={{ background: 'rgba(0,0,0,0.04)', color: '#0f0a07', border: '1px solid rgba(0,0,0,0.08)' }}
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  Disponibilidade
                </Link>
              </>
            )}
          </div>
        </div>

        <MeetingsList upcoming={upcoming} past={past} user={user} />
      </main>
    </div>
  );
}
