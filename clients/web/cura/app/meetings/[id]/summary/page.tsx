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

  if (!meeting.soap_note_submitted || !meeting.soap_note) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center px-6">
        <div className="max-w-sm w-full bg-white rounded-2xl border border-stone-200 p-8 flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-stone-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-stone-900">Summary not available yet</p>
            <p className="text-sm text-stone-500 mt-1">Your doctor hasn&apos;t submitted a visit summary for this appointment yet.</p>
          </div>
          <a
            href="/meetings"
            className="mt-2 px-5 py-2 rounded-full text-sm font-medium text-[#b5471b] border border-[#b5471b]/30 hover:bg-[#b5471b]/5 transition-colors"
          >
            Back to visits
          </a>
        </div>
      </div>
    );
  }

  return <SummaryView meeting={meeting} soap={meeting.soap_note as VisitSummary} user={user} token={token} />;
}
