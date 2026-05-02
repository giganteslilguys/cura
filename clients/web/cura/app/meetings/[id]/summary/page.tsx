import { getMeeting } from '@/lib/api/meetings';
import { getCurrentUser } from '@/lib/auth/dal';
import { getSessionToken } from '@/lib/auth/session';
import { notFound, redirect } from 'next/navigation';
import type { VisitSummary } from '@/lib/api/types';
import { SummaryView } from './summary-view';

export default async function VisitSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  if (user.role !== 'patient') redirect(`/meetings/${id}`);

  const token = await getSessionToken();
  if (!token) redirect('/sign-in');

  const { meeting } = await getMeeting(id, token);

  if (meeting.patient?.id !== user.id) notFound();
  if (!meeting.soap_note_submitted || !meeting.soap_note) redirect('/meetings');

  return <SummaryView meeting={meeting} soap={meeting.soap_note as VisitSummary} />;
}
