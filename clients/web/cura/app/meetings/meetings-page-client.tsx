'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Calendar, CalendarDays, CalendarPlus, LayoutList } from 'lucide-react';
import type { Meeting, User } from '@/lib/api/types';

import { CalendarView } from './calendar-view';
import Link from 'next/link';
import { MeetingsList } from './meetings-list';
import { StartOnSite } from './start-on-site';
import { useState } from 'react';

type View = 'list' | 'calendar';

const viewVariants = {
  enter: (dir: number) => ({ opacity: 0, y: dir * 10 }),
  center: { opacity: 1, y: 0 },
  exit: (dir: number) => ({ opacity: 0, y: -dir * 10 }),
};

export function MeetingsPageClient({
  upcoming,
  past,
  meetings,
  user,
}: {
  upcoming: Meeting[];
  past: Meeting[];
  meetings: Meeting[];
  user: User;
}) {
  const [view, setView] = useState<View>('list');
  // direction: +1 = going to calendar (down), -1 = going to list (up)
  const [direction, setDirection] = useState(1);

  const switchView = (next: View) => {
    if (next === view) return;
    setDirection(next === 'calendar' ? 1 : -1);
    setView(next);
  };

  return (
    <div
      className={view === 'calendar' ? 'max-w-6xl mx-auto' : 'max-w-xl mx-auto'}
      style={{ transition: 'max-width 0.22s cubic-bezier(0.16,1,0.3,1)' }}
    >
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold text-black">Consultas</h1>
        <div className="flex justify-between items-center w-full">
          {/* View toggle */}
          <div
            className="flex items-center p-1 rounded-full gap-0.5"
            style={{ background: 'rgba(0,0,0,0.05)' }}
          >
            <button
              onClick={() => switchView('list')}
              title="Vista de lista"
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                view === 'list' ? 'bg-white shadow-sm text-black' : 'text-black/40 hover:text-black/60'
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => switchView('calendar')}
              title="Vista de calendário"
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                view === 'calendar' ? 'bg-white shadow-sm text-black' : 'text-black/40 hover:text-black/60'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
            </button>
          </div>

          {user.role === 'patient' && (
            <Link
              href="/book"
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-white hover:opacity-90 transition-opacity"
              style={{ background: '#b5471b' }}
            >
              <CalendarPlus className="w-3.5 h-3.5" />
              Marcar consulta
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
                <Calendar className="w-3.5 h-3.5" />
                Disponibilidade
              </Link>
            </>
          )}
        </div>
      </div>

      <AnimatePresence mode="sync" custom={direction}>
        <motion.div
          key={view}
          custom={direction}
          variants={viewVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
        >
          {view === 'list' ? (
            <MeetingsList upcoming={upcoming} past={past} user={user} />
          ) : (
            <CalendarView meetings={meetings} user={user} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
