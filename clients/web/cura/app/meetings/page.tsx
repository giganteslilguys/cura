import { ArrowRight, Calendar, CalendarPlus, Clock, FileText, Settings2, Timer, X } from 'lucide-react';

import Link from 'next/link';
import { Nav } from '@/components/nav';
import { getCurrentUser } from '@/lib/auth/dal';
import { getSessionToken } from '@/lib/auth/session';
import { listMeetings } from '@/lib/api/meetings';
import { redirect } from 'next/navigation';
import type { Meeting, User } from '@/lib/api/types';
import { StartOnSite } from './start-on-site';

function isFuture(m: Meeting) {
  const dt = new Date(`${m.date}T${m.time}`);
  return dt.getTime() > Date.now();
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(t: string) {
  const [h, min] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${min} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function MeetingRow({ m, user, last }: { m: Meeting; user: User; last: boolean }) {
  const canceled = m.status === 'canceled' || m.status === 'rejected';
  const hasReport = m.soap_note_submitted;
  const upcoming = isFuture(m) && !canceled;

  return (
    <div className={`flex items-center justify-between py-5 ${!last ? 'border-b border-black/[0.06]' : ''}`}>
      <div className="flex flex-col gap-0.5 min-w-0 mr-4">
        <div className="flex items-center gap-2">
          <span className="font-medium text-black truncate">{m.title}</span>
          {m.kind === 'on_site' && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#b5471b]/10 text-[#b5471b] shrink-0">
              On-site
            </span>
          )}
          {canceled && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-black/30 bg-black/5 px-2 py-0.5 rounded-full shrink-0">
              <X className="w-2.5 h-2.5" />
              {m.status}
            </span>
          )}
        </div>

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
            <svg className="w-3 h-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M17 7H7M17 7v10" /></svg>
          </Link>
        )}

        <span className="text-sm text-black/40 flex items-center gap-2.5 mt-0.5">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {fmtDate(m.date)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {fmtTime(m.time)}
          </span>
          <span className="flex items-center gap-1">
            <Timer className="w-3.5 h-3.5" />
            {m.duration} min
          </span>
        </span>
      </div>

      <div className="shrink-0">
        {user.role === 'patient' && hasReport ? (
          <Link
            href={`/meetings/${m.id}/summary`}
            className="flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-medium transition-opacity hover:opacity-80"
            style={{ background: 'rgba(181,71,27,0.08)', color: '#b5471b', border: '1px solid rgba(181,71,27,0.18)' }}
          >
            <FileText className="w-3.5 h-3.5" />
            View summary
          </Link>
        ) : upcoming ? (
          <Link
            href={`/meetings/${m.id}`}
            className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#b5471b] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Join <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        ) : null}
      </div>
    </div>
  );
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

      <main className="max-w-xl mx-auto px-6 pt-28 pb-20">
        <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
          <h1 className="text-2xl font-semibold text-black">Visits</h1>
          <div className="flex items-center gap-2">
            {user.role === 'patient' && (
              <Link
                href="/book"
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-white hover:opacity-90 transition-opacity"
                style={{ background: '#b5471b' }}
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                Book a visit
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
                  Availability
                </Link>
              </>
            )}
          </div>
        </div>

        <section className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-black/30 mb-4">Upcoming</p>
          {upcoming.length === 0 ? (
            <p className="text-sm text-black/30 italic">No upcoming visits.</p>
          ) : (
            <div>
              {upcoming.map((m, i) => (
                <MeetingRow key={m.id} m={m} user={user} last={i === upcoming.length - 1} />
              ))}
            </div>
          )}
        </section>

        {past.length > 0 && (
          <section>
            <p className="text-xs font-semibold uppercase tracking-widest text-black/30 mb-4">Past visits</p>
            <div>
              {past.map((m, i) => (
                <MeetingRow key={m.id} m={m} user={user} last={i === past.length - 1} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
