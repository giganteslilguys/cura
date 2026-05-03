'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Calendar, Clock, FileText, Timer, X } from 'lucide-react';
import type { Meeting, User } from '@/lib/api/types';

function isFuture(m: Meeting) {
  return new Date(`${m.date}T${m.time}`).getTime() > Date.now();
}

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

function isReschedulable(m: Meeting): boolean {
  return m.status === 'scheduled' && m.kind !== 'on_site' && workingDaysUntil(m.date) > 3;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtTime(t: string) {
  const [h, min] = t.split(':');
  return `${h.padStart(2, '0')}:${min}`;
}

function MeetingCard({ m, user }: { m: Meeting; user: User }) {
  const canceled = m.status === 'canceled' || m.status === 'rejected';
  const hasReport = m.soap_note_submitted;
  const upcoming = isFuture(m) && !canceled;

  return (
    <div className="border-b border-black/[0.07] py-4 flex flex-col gap-3">
      {/* Title + badges */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-start gap-2 flex-wrap">
          <span className="font-semibold text-black leading-snug">{m.title}</span>
          {m.kind === 'on_site' && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#b5471b]/10 text-[#b5471b] shrink-0 mt-0.5">
              Presencial
            </span>
          )}
          {canceled && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-black/30 bg-black/5 px-2 py-0.5 rounded-full shrink-0 mt-0.5">
              <X className="w-2.5 h-2.5" />
              {m.status}
            </span>
          )}
        </div>

        {user.role === 'patient' && m.doctor && (
          <span className="text-sm text-black/40">
            Dr. {m.doctor.first_name} {m.doctor.last_name}
          </span>
        )}
        {user.role === 'doctor' && m.patient && (
          <Link
            href={`/meetings/${m.id}/patient`}
            className="text-sm text-black/40 hover:text-[#b5471b] transition-colors w-fit flex items-center gap-1"
          >
            {m.patient.first_name} {m.patient.last_name}
            <svg className="w-3 h-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 17L17 7M17 7H7M17 7v10" />
            </svg>
          </Link>
        )}
      </div>

      {/* Date / time / duration + actions on the same row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-sm text-black/40 flex-wrap">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            {fmtDate(m.date)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {fmtTime(m.time)}
          </span>
          <span className="flex items-center gap-1">
            <Timer className="w-3.5 h-3.5 shrink-0" />
            {m.duration} min
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
        {user.role === 'patient' && upcoming && (
          <Link
            href={`/meetings/${m.id}`}
            className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#b5471b] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Entrar <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
        {user.role === 'patient' && upcoming && isReschedulable(m) && (
          <Link
            href={`/meetings/${m.id}/reschedule`}
            className="flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-medium hover:opacity-80 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.04)', color: '#0f0a07', border: '1px solid rgba(0,0,0,0.08)' }}
          >
            Reagendar
          </Link>
        )}
        {user.role === 'patient' && !upcoming && !canceled && (
          <Link
            href={`/meetings/${m.id}/summary`}
            className="flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-medium hover:opacity-80 transition-opacity"
            style={{ background: 'rgba(181,71,27,0.08)', color: '#b5471b', border: '1px solid rgba(181,71,27,0.18)' }}
          >
            <FileText className="w-3.5 h-3.5" />
            Ver resumo
          </Link>
        )}
        {user.role === 'doctor' && upcoming && (
          <Link
            href={`/meetings/${m.id}`}
            className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#b5471b] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Entrar <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
        {user.role === 'doctor' && !upcoming && !canceled && !hasReport && (
          <Link
            href={`/meetings/${m.id}${m.kind === 'on_site' ? '?report=1' : ''}`}
            className="flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-medium hover:opacity-80 transition-opacity"
            style={{ background: 'rgba(181,71,27,0.08)', color: '#b5471b', border: '1px solid rgba(181,71,27,0.18)' }}
          >
            <FileText className="w-3.5 h-3.5" />
            Submeter relatório
          </Link>
        )}
        </div>
      </div>
    </div>
  );
}

type Tab = 'upcoming' | 'past';

const TABS: { id: Tab; label: string }[] = [
  { id: 'upcoming', label: 'Próximas' },
  { id: 'past', label: 'Anteriores' },
];

export function MeetingsList({ upcoming, past, user }: { upcoming: Meeting[]; past: Meeting[]; user: User }) {
  const [tab, setTab] = useState<Tab>('upcoming');
  const meetings = tab === 'upcoming' ? upcoming : past;

  function switchTab(next: Tab) {
    setTab(t => (t === next ? (next === 'upcoming' ? 'past' : 'upcoming') : next));
  }

  return (
    <div>
      {/* Tabs */}
      <div className="relative flex gap-1 p-1 rounded-full mb-6" style={{ background: 'rgba(0,0,0,0.05)' }}>
        {/* Sliding capsule — pure CSS, immune to parent motion state */}
        <span
          className="absolute top-1 bottom-1 rounded-full bg-white shadow-sm pointer-events-none"
          style={{
            width: 'calc(50% - 6px)',
            left: 4,
            transform: tab === 'past' ? 'translateX(calc(100% + 4px))' : 'translateX(0)',
            transition: 'transform 0.22s cubic-bezier(0.16,1,0.3,1)',
          }}
        />
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className="relative flex-1 py-2 rounded-full text-sm font-medium z-10 transition-colors duration-200"
            style={{ color: tab === t.id ? '#000' : 'rgba(0,0,0,0.4)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div className="flex flex-col">
        {meetings.length === 0 ? (
          <p className="text-sm text-black/30 italic py-4">
            {tab === 'upcoming' ? 'Sem consultas próximas.' : 'Sem consultas anteriores.'}
          </p>
        ) : (
          meetings.map(m => <MeetingCard key={m.id} m={m} user={user} />)
        )}
      </div>
    </div>
  );
}
