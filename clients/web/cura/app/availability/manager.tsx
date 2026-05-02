'use client';

import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { createAvailability, deleteAvailability } from '@/lib/api/availability';
import type { DoctorAvailability } from '@/lib/api/types';

const DAY_NAMES: Record<number, string> = {
  1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday',
  5: 'Friday', 6: 'Saturday', 7: 'Sunday',
};

function fmt(t: string) {
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function AvailabilityManager({
  initialAvailability,
  token,
}: {
  initialAvailability: DoctorAvailability[];
  token: string;
}) {
  const [availability, setAvailability] = useState<DoctorAvailability[]>(initialAvailability);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ day_of_week: 1, start_time: '09:00', end_time: '17:00' });

  const grouped = availability.reduce<Record<number, DoctorAvailability[]>>((acc, a) => {
    acc[a.day_of_week] = [...(acc[a.day_of_week] ?? []), a];
    return acc;
  }, {});

  const handleAdd = async () => {
    setError(null);
    setAdding(true);
    try {
      const { availability: created } = await createAvailability(
        { day_of_week: form.day_of_week, start_time: form.start_time + ':00', end_time: form.end_time + ':00', slot_duration: 15 },
        token,
      );
      setAvailability((prev) =>
        [...prev, created].sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time)),
      );
    } catch {
      setError('Could not save. Make sure end time is after start time.');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await deleteAvailability(id, token);
      setAvailability((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setError('Could not remove this window.');
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Current windows */}
      {Object.keys(grouped).length === 0 ? (
        <p className="text-sm text-black/30 italic">No availability set yet. Add a window below.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {[1, 2, 3, 4, 5, 6, 7].filter((d) => grouped[d]).map((day) => (
            <div key={day}>
              <p className="text-xs font-semibold text-black/35 uppercase tracking-widest mb-2">
                {DAY_NAMES[day]}
              </p>
              <div className="flex flex-col gap-1.5 mb-4">
                {grouped[day].map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-xl px-4 py-3"
                    style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)' }}
                  >
                    <span className="text-sm font-medium text-black">
                      {fmt(a.start_time)} – {fmt(a.end_time)}
                    </span>
                    <button
                      onClick={() => handleDelete(a.id)}
                      className="text-black/25 hover:text-[#b5471b] transition-colors p-1"
                      aria-label="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      <div className="rounded-2xl p-5 flex flex-col gap-5" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
        <p className="text-xs font-semibold text-black/35 uppercase tracking-widest">Add window</p>

        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="text-xs text-black/35">Day</span>
            <select
              value={form.day_of_week}
              onChange={(e) => setForm((f) => ({ ...f, day_of_week: parseInt(e.target.value) }))}
              className="border-b border-black/10 py-2.5 bg-transparent text-sm text-black focus:outline-none focus:border-[#b5471b] transition-colors"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>{DAY_NAMES[d]}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-xs text-black/35">From</span>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                className="border-b border-black/10 py-2.5 bg-transparent text-sm text-black focus:outline-none focus:border-[#b5471b] transition-colors"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs text-black/35">To</span>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                className="border-b border-black/10 py-2.5 bg-transparent text-sm text-black focus:outline-none focus:border-[#b5471b] transition-colors"
              />
            </label>
          </div>
        </div>

        {error && <p className="text-xs text-[#b5471b]">{error}</p>}

        <button
          onClick={handleAdd}
          disabled={adding}
          className="self-start flex items-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: '#b5471b' }}
        >
          <Plus className="w-4 h-4" />
          {adding ? 'Saving…' : 'Add window'}
        </button>
      </div>
    </div>
  );
}
