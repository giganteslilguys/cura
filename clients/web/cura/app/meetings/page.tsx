import { ArrowRight, Calendar, Clock, Timer } from 'lucide-react';

import Link from 'next/link';
import { Nav } from '@/components/nav';
import { getCurrentUser } from '@/lib/auth/dal';
import { getSessionToken } from '@/lib/auth/session';
import { listMeetings } from '@/lib/api/meetings';
import { redirect } from 'next/navigation';

export default async function MeetingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const token = await getSessionToken();
  if (!token) redirect('/sign-in');

  const { meetings } = await listMeetings(token);

  return (
    <div className="min-h-screen" style={{ background: '#ffffff' }}>
      <Nav user={user} token={token} />

      <main className="max-w-xl mx-auto px-6 pt-28 pb-20">
        <h1 className="text-2xl font-semibold text-black mb-8">
          Upcoming visits
        </h1>

        {meetings.length === 0 ? (
          <p className="text-sm text-black/40">No visits scheduled.</p>
        ) : (
          <div className="flex flex-col">
            {meetings.map((m, i) => (
              <div
                key={m.id}
                className={`flex items-center justify-between py-5 ${
                  i < meetings.length - 1 ? 'border-b border-black/[0.06]' : ''
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-black">{m.title}</span>
                  <span className="text-sm text-black/40 flex items-center gap-2.5">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {m.date}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {m.time}
                    </span>
                    <span className="flex items-center gap-1">
                      <Timer className="w-3.5 h-3.5" />
                      {m.duration} min
                    </span>
                  </span>
                </div>
                <Link
                  href={`/meetings/${m.id}`}
                  className="px-5 py-2 rounded-full bg-[#b5471b] text-white text-sm font-medium hover:opacity-90 transition-opacity shrink-0 flex items-center gap-1.5"
                >
                  Join <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
