'use client';

import { Stethoscope, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef } from 'react';

import { startOnSiteVisitAction, type StartOnSiteResult } from './actions';

export function StartOnSite() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState<
    StartOnSiteResult | undefined,
    FormData
  >(startOnSiteVisitAction, undefined);

  useEffect(() => {
    if (state?.ok) {
      dialogRef.current?.close();
      router.push(`/meetings/${state.meetingId}`);
    }
  }, [state, router]);

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-black/10 hover:border-[#b5471b] hover:text-[#b5471b] text-sm font-medium text-black/60 transition-colors"
      >
        <Stethoscope className="w-4 h-4" />
        Iniciar consulta presencial
      </button>

      <dialog
        ref={dialogRef}
        className="rounded-2xl shadow-2xl border border-stone-200 p-0 w-full max-w-md m-auto backdrop:bg-black/40 open:flex open:flex-col"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-[#b5471b]" />
            <span className="text-sm font-semibold text-stone-900">Iniciar uma consulta presencial</span>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="text-stone-400 hover:text-stone-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form action={formAction} className="flex flex-col gap-4 px-6 py-5">
          <p className="text-xs text-stone-500">
            O doente está presente em pessoa — vamos gravar apenas o áudio e começar
            a produzir notas da consulta de imediato.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone-600">Email do doente</label>
            <input
              name="patient_email"
              type="email"
              required
              placeholder="patient@email.com"
              className="px-3 py-2 rounded-lg bg-stone-50 border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone-600">
              Motivo da consulta <span className="text-stone-400 font-normal">(opcional)</span>
            </label>
            <input
              name="title"
              type="text"
              placeholder="ex. Consulta de acompanhamento, Consulta anual"
              maxLength={100}
              className="px-3 py-2 rounded-lg bg-stone-50 border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/50"
            />
          </div>

          {state && !state.ok && (
            <p className="text-xs text-[#b5471b] bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              disabled={pending}
              className="px-4 py-2 text-sm text-stone-500 hover:text-stone-800 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="px-5 py-2 rounded-full bg-[#b5471b] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {pending ? 'A iniciar…' : 'Iniciar consulta'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
