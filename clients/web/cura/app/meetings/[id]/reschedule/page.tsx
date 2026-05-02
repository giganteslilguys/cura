import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Nav } from '@/components/nav';
import { listDoctors } from '@/lib/api/availability';
import { getMeeting } from '@/lib/api/meetings';
import { getCurrentUser } from '@/lib/auth/dal';
import { getSessionToken } from '@/lib/auth/session';
import { ApiError } from '@/lib/api/errors';
import { RescheduleForm } from './reschedule-form';

function workingDaysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  let count = 0;
  const cur = new Date(today);
  while (cur < target) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export default async function ReschedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  if (user.role !== 'patient') redirect('/meetings');

  const token = await getSessionToken();
  if (!token) redirect('/sign-in');

  let meeting;
  try {
    const result = await getMeeting(id, token);
    meeting = result.meeting;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    if (error instanceof ApiError && error.status === 401) redirect('/sign-in');
    throw error;
  }

  // Guard: only schedulable, non-on-site meetings > 5 working days away
  if (
    meeting.status !== 'scheduled' ||
    meeting.kind === 'on_site' ||
    meeting.patient?.id !== user.id ||
    workingDaysUntil(meeting.date) <= 3
  ) {
    redirect('/meetings');
  }

  const { doctors } = await listDoctors(token);

  return (
    <div className="min-h-screen bg-white">
      <Nav user={user} token={token} />

      <main className="max-w-sm mx-auto px-6 pt-28 pb-24">
        <Link
          href="/meetings"
          className="inline-flex items-center gap-1.5 text-xs text-black/35 hover:text-[#b5471b] transition-colors mb-8"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Voltar às consultas
        </Link>

        <h1 className="text-2xl font-semibold text-black mb-1">Reagendar consulta</h1>
        <p className="text-sm text-black/40 mb-2">
          Escolha um novo médico/a, dia e hora para a sua consulta.
        </p>
        <p className="text-xs text-black/25 mb-10">
          Atual: {new Date(meeting.date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' })}
          {' '}às{' '}
          {meeting.time.slice(0, 5)}
          {meeting.doctor ? ` com Dr. ${meeting.doctor.first_name} ${meeting.doctor.last_name}` : ''}
        </p>

        <RescheduleForm
          meetingId={meeting.id}
          currentDoctorId={meeting.doctor?.id ?? ''}
          currentDate={meeting.date}
          doctors={doctors}
          token={token}
        />
      </main>
    </div>
  );
}
