'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, ChevronLeft, ChevronRight, Clock, FileText, Timer, X } from 'lucide-react';
import type { Meeting, User } from '@/lib/api/types';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const DAY_NAMES_LONG = [
  'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira',
  'Sexta-feira', 'Sábado', 'Domingo',
];
const DAY_NAMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Agendada',
  completed: 'Concluída',
  canceled: 'Cancelada',
  rejected: 'Rejeitada',
};
const KIND_LABEL: Record<string, string> = {
  remote: 'Videochamada',
  on_site: 'Presencial',
};

function getDaysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDow(year: number, month: number) { return (new Date(year, month, 1).getDay() + 6) % 7; }
function pad(n: number) { return String(n).padStart(2, '0'); }
function toDateStr(y: number, m: number, d: number) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function fmtTime(t: string) { const [h, min] = t.split(':'); return `${pad(Number(h))}:${min}`; }

function fmtDateLong(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = DAY_NAMES_LONG[(d.getDay() + 6) % 7];
  return `${dow}, ${d.getDate()} de ${MONTH_NAMES[d.getMonth()]}`;
}

function isFuture(m: Meeting) { return new Date(`${m.date}T${m.time}`).getTime() > Date.now(); }

function workingDaysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  let count = 0; const cur = new Date(today);
  while (cur < target) { if (cur.getDay() !== 0 && cur.getDay() !== 6) count++; cur.setDate(cur.getDate() + 1); }
  return count;
}

function isReschedulable(m: Meeting) {
  return m.status === 'scheduled' && m.kind !== 'on_site' && workingDaysUntil(m.date) > 3;
}

type Cell = { day: number; curMonth: boolean; dateStr: string };

function buildGrid(year: number, month: number): Cell[] {
  const firstDow = getFirstDow(year, month);
  const daysInCur = getDaysInMonth(year, month);
  const prevM = month === 0 ? 11 : month - 1; const prevY = month === 0 ? year - 1 : year;
  const nextM = month === 11 ? 0 : month + 1; const nextY = month === 11 ? year + 1 : year;
  const daysInPrev = getDaysInMonth(prevY, prevM);
  const cells: Cell[] = [];
  for (let i = firstDow - 1; i >= 0; i--) { const d = daysInPrev - i; cells.push({ day: d, curMonth: false, dateStr: toDateStr(prevY, prevM, d) }); }
  for (let d = 1; d <= daysInCur; d++) { cells.push({ day: d, curMonth: true, dateStr: toDateStr(year, month, d) }); }
  const total = Math.ceil(cells.length / 7) * 7;
  for (let d = 1; cells.length < total; d++) { cells.push({ day: d, curMonth: false, dateStr: toDateStr(nextY, nextM, d) }); }
  return cells;
}

// ─── Hover popover ────────────────────────────────────────────────────────────

type HoverState = { meeting: Meeting; rect: DOMRect };

function MeetingPopover({ meeting, rect, user }: { meeting: Meeting; rect: DOMRect; user: User }) {
  const POPOVER_W = 260; const POPOVER_H = 160; const GAP = 6;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  let left = rect.left + rect.width / 2 - POPOVER_W / 2;
  left = Math.max(8, Math.min(vw - POPOVER_W - 8, left));
  let top: number; let arrowBelow = false;
  if (rect.bottom + GAP + POPOVER_H < vh) { top = rect.bottom + GAP; }
  else { top = rect.top - GAP - POPOVER_H; arrowBelow = true; }

  const canceled = meeting.status === 'canceled' || meeting.status === 'rejected';
  const future = isFuture(meeting);
  const otherPerson = user.role === 'doctor'
    ? (meeting.patient ? `${meeting.patient.first_name} ${meeting.patient.last_name}` : null)
    : (meeting.doctor ? `Dr. ${meeting.doctor.first_name} ${meeting.doctor.last_name}` : null);
  const statusColor = meeting.status === 'completed'
    ? 'text-green-600 bg-green-50'
    : canceled ? 'text-black/40 bg-black/[0.04]'
    : future ? 'text-[#b5471b] bg-[#b5471b]/[0.08]'
    : 'text-black/40 bg-black/[0.04]';
  const arrowLeft = rect.left + rect.width / 2 - left;

  return (
    <motion.div
      className="fixed z-[9999] pointer-events-none"
      style={{ top, left, width: POPOVER_W }}
      initial={{ opacity: 0, scale: 0.95, y: arrowBelow ? -4 : 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="rounded-xl border border-black/[0.08] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-3.5 flex flex-col gap-2.5">
        <div>
          <p className="font-semibold text-sm text-black leading-snug">{meeting.title}</p>
          {otherPerson && <p className="text-xs text-black/40 mt-0.5">{otherPerson}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs text-black/60">{fmtDateLong(meeting.date)}</p>
          <p className="text-xs text-black/60 tabular-nums">{fmtTime(meeting.time)}<span className="text-black/30"> · {meeting.duration} min</span></p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusColor}`}>{STATUS_LABEL[meeting.status] ?? meeting.status}</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-black/[0.04] text-black/40">{KIND_LABEL[meeting.kind] ?? meeting.kind}</span>
        </div>
        <div
          className={`absolute w-2.5 h-2.5 rotate-45 border border-black/[0.08] bg-white ${arrowBelow ? 'bottom-[-6px] border-t-0 border-l-0' : 'top-[-6px] border-b-0 border-r-0'}`}
          style={{ left: arrowLeft, transform: 'translateX(-50%) rotate(45deg)' }}
        />
      </div>
    </motion.div>
  );
}

// ─── Click modal ──────────────────────────────────────────────────────────────

function MeetingModal({ meeting, user, onClose }: { meeting: Meeting; user: User; onClose: () => void }) {
  const canceled = meeting.status === 'canceled' || meeting.status === 'rejected';
  const upcoming = isFuture(meeting) && !canceled;
  const reschedulable = isReschedulable(meeting);
  const hasReport = meeting.soap_note_submitted;
  const otherPerson = user.role === 'doctor'
    ? (meeting.patient ? `${meeting.patient.first_name} ${meeting.patient.last_name}` : null)
    : (meeting.doctor ? `Dr. ${meeting.doctor.first_name} ${meeting.doctor.last_name}` : null);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(4px)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
    >
      <motion.div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-4"
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-black leading-snug">{meeting.title}</p>
            {otherPerson && <p className="text-sm text-black/40 mt-0.5">{otherPerson}</p>}
          </div>
          <button onClick={onClose} className="text-black/30 hover:text-black/60 transition-colors shrink-0 mt-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Meta */}
        <div className="flex flex-col gap-1.5 text-sm text-black/50">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>{fmtDateLong(meeting.date)} · <span className="tabular-nums">{fmtTime(meeting.time)}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <Timer className="w-3.5 h-3.5 shrink-0" />
            <span>{meeting.duration} min · {KIND_LABEL[meeting.kind] ?? meeting.kind}</span>
          </div>
        </div>

        {canceled && (
          <div className="px-3 py-2 rounded-xl bg-black/[0.03] border border-black/[0.06]">
            <p className="text-xs text-black/40 font-medium">{STATUS_LABEL[meeting.status] ?? meeting.status}</p>
          </div>
        )}

        {!canceled && (
          <div className="flex flex-col gap-2">
            {upcoming && (
              <Link href={`/meetings/${meeting.id}`} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-[#b5471b] text-white text-sm font-medium hover:opacity-90 transition-opacity">
                Entrar na consulta <ArrowRight className="w-4 h-4" />
              </Link>
            )}
            {upcoming && reschedulable && (
              <Link href={`/meetings/${meeting.id}/reschedule`} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium hover:opacity-80 transition-opacity" style={{ background: 'rgba(0,0,0,0.04)', color: '#0f0a07', border: '1px solid rgba(0,0,0,0.08)' }}>
                Reagendar
              </Link>
            )}
            {user.role === 'patient' && !upcoming && (
              <Link href={`/meetings/${meeting.id}/summary`} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium hover:opacity-80 transition-opacity" style={{ background: 'rgba(181,71,27,0.08)', color: '#b5471b', border: '1px solid rgba(181,71,27,0.18)' }}>
                <FileText className="w-4 h-4" /> Ver resumo
              </Link>
            )}
            {user.role === 'doctor' && !upcoming && !hasReport && (
              <Link href={`/meetings/${meeting.id}${meeting.kind === 'on_site' ? '?report=1' : ''}`} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium hover:opacity-80 transition-opacity" style={{ background: 'rgba(181,71,27,0.08)', color: '#b5471b', border: '1px solid rgba(181,71,27,0.18)' }}>
                <FileText className="w-4 h-4" /> Submeter relatório
              </Link>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── Pill ─────────────────────────────────────────────────────────────────────

function MeetingPill({ m, onHover, onLeave, onClick }: {
  m: Meeting;
  onHover: (meeting: Meeting, rect: DOMRect) => void;
  onLeave: () => void;
  onClick: (meeting: Meeting) => void;
}) {
  const canceled = m.status === 'canceled' || m.status === 'rejected';
  const future = isFuture(m);
  const cls = canceled
    ? 'bg-black/[0.04] text-black/30 line-through'
    : future ? 'bg-[#b5471b] text-white' : 'bg-[#b5471b]/[0.10] text-[#b5471b]';

  return (
    <motion.button
      className={`block w-full text-left rounded px-1.5 py-0.5 text-[10px] leading-tight font-medium truncate cursor-pointer ${cls}`}
      whileHover={{ opacity: 0.75 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.1 }}
      onMouseEnter={e => onHover(m, (e.currentTarget as HTMLElement).getBoundingClientRect())}
      onMouseLeave={onLeave}
      onClick={() => onClick(m)}
    >
      <span className="tabular-nums">{fmtTime(m.time)}</span>
      <span className="hidden sm:inline"> {m.title}</span>
    </motion.button>
  );
}

// ─── Month grid ───────────────────────────────────────────────────────────────

const monthVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 24 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: -dir * 24 }),
};

// ─── Main calendar ────────────────────────────────────────────────────────────

export function CalendarView({ meetings, user }: { meetings: Meeting[]; user: User }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [direction, setDirection] = useState(0);
  const [hovered, setHovered] = useState<HoverState | null>(null);
  const [selected, setSelected] = useState<Meeting | null>(null);

  const todayStr = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  const byDate = new Map<string, Meeting[]>();
  for (const m of meetings) {
    if (!byDate.has(m.date)) byDate.set(m.date, []);
    byDate.get(m.date)!.push(m);
  }
  for (const list of byDate.values()) list.sort((a, b) => a.time.localeCompare(b.time));

  const cells = buildGrid(year, month);

  const goToPrev = () => {
    setDirection(-1);
    if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1);
  };
  const goToNext = () => {
    setDirection(1);
    if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1);
  };
  const goToToday = () => { setDirection(0); setMonth(today.getMonth()); setYear(today.getFullYear()); };

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  return (
    <div>
      {/* Navigation */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <AnimatePresence mode="wait">
            <motion.h2
              key={`${year}-${month}`}
              className="font-semibold text-black text-base"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              {MONTH_NAMES[month]} {year}
            </motion.h2>
          </AnimatePresence>
          <AnimatePresence>
            {!isCurrentMonth && (
              <motion.button
                onClick={goToToday}
                className="text-xs px-2.5 py-1 rounded-full bg-black/[0.04] text-black/50 hover:bg-black/[0.07] transition-colors"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.15 }}
              >
                Hoje
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        <div className="flex items-center gap-0.5">
          <motion.button onClick={goToPrev} whileHover={{ backgroundColor: 'rgba(0,0,0,0.05)' }} whileTap={{ scale: 0.9 }} className="w-8 h-8 flex items-center justify-center rounded-full text-black/40 hover:text-black/70 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </motion.button>
          <motion.button onClick={goToNext} whileHover={{ backgroundColor: 'rgba(0,0,0,0.05)' }} whileTap={{ scale: 0.9 }} className="w-8 h-8 flex items-center justify-center rounded-full text-black/40 hover:text-black/70 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </motion.button>
        </div>
      </div>

      {/* Day-of-week labels (static) */}
      <div className="grid grid-cols-7 border-l border-t border-black/[0.06] rounded-t-xl overflow-hidden">
        {DAY_NAMES.map(d => (
          <div key={d} className="border-r border-b border-black/[0.06] bg-black/[0.02] py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-black/30">
            {d}
          </div>
        ))}
      </div>

      {/* Animated month grid */}
      <div className="overflow-hidden rounded-b-xl border-l border-black/[0.06]">
        <AnimatePresence custom={direction} mode="wait">
          <motion.div
            key={`${year}-${month}`}
            custom={direction}
            variants={monthVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-7"
          >
            {cells.map(({ day, curMonth, dateStr }, i) => {
              const dayMeetings = byDate.get(dateStr) ?? [];
              const isToday = dateStr === todayStr;
              const visible = dayMeetings;
              const overflow = 0;

              return (
                <div
                  key={i}
                  className={`border-r border-b border-black/[0.06] min-h-[90px] md:min-h-[130px] p-1 md:p-2 flex flex-col gap-0.5 ${
                    curMonth ? 'bg-white' : 'bg-black/[0.015]'
                  }`}
                >
                  <span className={`text-xs font-medium self-start w-5 h-5 md:w-6 md:h-6 flex items-center justify-center rounded-full mb-0.5 ${
                    isToday ? 'bg-[#b5471b] text-white' : curMonth ? 'text-black/70' : 'text-black/20'
                  }`}>
                    {day}
                  </span>
                  {visible.map(m => (
                    <MeetingPill
                      key={m.id}
                      m={m}
                      onHover={(meeting, rect) => setHovered({ meeting, rect })}
                      onLeave={() => setHovered(null)}
                      onClick={meeting => { setHovered(null); setSelected(meeting); }}
                    />
                  ))}
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Hover popover */}
      <AnimatePresence>
        {hovered && !selected && (
          <MeetingPopover key={hovered.meeting.id} meeting={hovered.meeting} rect={hovered.rect} user={user} />
        )}
      </AnimatePresence>

      {/* Click modal */}
      <AnimatePresence>
        {selected && (
          <MeetingModal meeting={selected} user={user} onClose={() => setSelected(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
