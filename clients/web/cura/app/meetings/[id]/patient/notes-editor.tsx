'use client';

import { useRef, useState } from 'react';
import { updateMeetingNotes } from '@/lib/api/meetings';

export function NotesEditor({
  meetingId,
  token,
  initialNotes,
}: {
  meetingId: string;
  token: string;
  initialNotes: string;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (value: string) => {
    setNotes(value);
    setSaveState('saving');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        await updateMeetingNotes(meetingId, value, token);
        setSaveState('saved');
      } catch {
        setSaveState('idle');
      }
    }, 1000);
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={notes}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Adicione notas sobre este doente ou consulta…"
        maxLength={1000}
        rows={5}
        className="w-full resize-none text-sm text-black/80 leading-relaxed bg-transparent placeholder:text-black/20 focus:outline-none"
      />
      <div className="flex justify-between items-center">
        <span className="text-xs text-black/20">{notes.length}/1000</span>
        {saveState === 'saving' && (
          <span className="text-xs text-black/25">A guardar…</span>
        )}
        {saveState === 'saved' && (
          <span className="text-xs text-black/25">Guardado</span>
        )}
      </div>
    </div>
  );
}
