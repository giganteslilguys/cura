import type { Meeting } from '@/lib/api/types';

import { MeetingsPageClient } from './meetings-page-client';
import { Nav } from '@/components/nav';
import { getCurrentUser } from '@/lib/auth/dal';
import { getSessionToken } from '@/lib/auth/session';
import { listMeetings } from '@/lib/api/meetings';
import { redirect } from 'next/navigation';

function isFuture(m: Meeting) {
  return new Date(`${m.date}T${m.time}`).getTime() > Date.now();
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

      <main className="mx-auto px-6 pt-8 pb-36 md:pt-28 md:pb-20 w-full">
        <MeetingsPageClient
          upcoming={upcoming}
          past={past}
          meetings={meetings}
          user={user}
        />
      </main>
    </div>
  );
}
