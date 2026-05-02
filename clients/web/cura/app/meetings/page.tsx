import { ArrowRight, Calendar, Clock, Timer } from 'lucide-react';

import Link from 'next/link';
import { Nav } from '@/components/nav';
import { getCurrentUser } from '@/lib/auth/dal';
import { getSessionToken } from '@/lib/auth/session';
import { listMeetings } from '@/lib/api/meetings';
import { redirect } from 'next/navigation';

import { StartOnSite } from './start-on-site';

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
        <div className="flex items-end justify-between mb-8 gap-4 flex-wrap">
          <h1 className="text-2xl font-semibold text-black">Upcoming visits</h1>
          {user.role === 'doctor' && <StartOnSite />}
        </div>

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
                  <span className="font-medium text-black flex items-center gap-2">
                    {m.title}
                    {m.kind === 'on_site' && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#b5471b]/10 text-[#b5471b]">
                        On-site
                      </span>
                    )}
                  </span>
                  {user.role === 'patient' && m.doctor && (
                    <span className="text-xs text-black/40">
                      Dr. {m.doctor.first_name} {m.doctor.last_name}
                    </span>
                  )}
                  {user.role === 'doctor' && m.patient && (
                    <Link
                      href={`/meetings/${m.id}/patient`}
                      className="text-xs text-black/40 hover:text-[#b5471b] transition-colors w-fit flex items-center gap-1"
                    >
                      {m.patient.first_name} {m.patient.last_name}
                      <svg className="w-3 h-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                    </Link>
                  )}
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
