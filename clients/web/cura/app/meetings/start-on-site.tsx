'use client';

import { Stethoscope } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import { startOnSiteVisitAction, type StartOnSiteResult } from './actions';

export function StartOnSite() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<
    StartOnSiteResult | undefined,
    FormData
  >(startOnSiteVisitAction, undefined);

  // On success, navigate into the new meeting and refresh the list.
  useEffect(() => {
    if (state?.ok) {
      router.push(`/meetings/${state.meetingId}`);
    }
  }, [state, router]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-black/10 hover:border-[#b5471b] hover:text-[#b5471b] text-sm font-medium text-black/60 transition-colors"
      >
        <Stethoscope className="w-4 h-4" />
        Start on-site visit
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 p-4 rounded-2xl border border-black/10 bg-white"
    >
      <div className="flex items-center gap-2">
        <Stethoscope className="w-4 h-4 text-[#b5471b]" />
        <p className="text-sm font-semibold text-black">Start an on-site visit</p>
      </div>
      <p className="text-xs text-black/40">
        The patient is here in person — we&apos;ll record audio only and start
        producing visit notes immediately.
      </p>
      <input
        name="patient_email"
        type="email"
        required
        placeholder="Patient email"
        className="px-3 py-2 rounded-lg bg-stone-50 border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/50"
      />
      <input
        name="title"
        type="text"
        placeholder="Reason for visit (optional)"
        maxLength={100}
        className="px-3 py-2 rounded-lg bg-stone-50 border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/50"
      />
      {state && !state.ok && (
        <p className="text-xs text-[#b5471b]">{state.error}</p>
      )}
      <div className="flex justify-end gap-2 mt-1">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="px-4 py-2 text-sm text-black/50 hover:text-black transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-5 py-2 rounded-full bg-[#b5471b] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {pending ? 'Starting…' : 'Start visit'}
        </button>
      </div>
    </form>
  );
}
