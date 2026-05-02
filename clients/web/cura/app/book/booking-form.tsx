'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bookSlot, getDoctorSlots, getAnySlots, type AnyTimeSlot } from '@/lib/api/availability';
import { ApiError } from '@/lib/api/errors';
import type { DoctorSummary, TimeSlot } from '@/lib/api/types';

const ANY_DOCTOR = '__any__';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(t: string) {
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

type Slot =
  | { kind: 'specific'; slot: TimeSlot }
  | { kind: 'any'; slot: AnyTimeSlot };

export function BookingForm({
  doctors,
  token,
}: {
  doctors: DoctorSummary[];
  token: string;
}) {
  const router = useRouter();

  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [time, setTime] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTime('');
    setSlots([]);
    if (!doctorId || !date) return;

    setLoadingSlots(true);
    const req =
      doctorId === ANY_DOCTOR
        ? getAnySlots(date, token).then(({ slots }) =>
            slots.map((s): Slot => ({ kind: 'any', slot: s })),
          )
        : getDoctorSlots(doctorId, date, token).then(({ slots }) =>
            slots.map((s): Slot => ({ kind: 'specific', slot: s })),
          );

    req
      .then(setSlots)
      .catch(() => setError('Could not load available times.'))
      .finally(() => setLoadingSlots(false));
  }, [doctorId, date, token]);

  const handleBook = async () => {
    if (!doctorId || !date || !time) return;
    setBooking(true);
    setError(null);
    try {
      let resolvedDoctorId = doctorId;
      if (doctorId === ANY_DOCTOR) {
        const chosen = slots.find(
          (s) => s.kind === 'any' && s.slot.time === time,
        );
        if (!chosen || chosen.kind !== 'any') throw new Error('Slot not found');
        resolvedDoctorId = chosen.slot.doctor_id;
      }
      await bookSlot({ doctor_id: resolvedDoctorId, date, time, title: 'Appointment' }, token);
      router.push('/meetings');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not book. Please try again.');
      setBooking(false);
    }
  };

  const ready = doctorId && date && time;

  const slotLabel = (s: Slot) => {
    if (s.kind === 'any') {
      return `${fmt(s.slot.time)} — Dr. ${s.slot.doctor_last_name}`;
    }
    return fmt(s.slot.time);
  };

  const slotValue = (s: Slot) => s.slot.time;

  return (
    <div className="flex flex-col gap-7">
      {/* Doctor */}
      <Field label="Doctor">
        <select
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          className="w-full border-b border-black/10 py-2.5 bg-transparent text-sm text-black focus:outline-none focus:border-[#b5471b] transition-colors"
        >
          <option value="">Select a doctor…</option>
          <option value={ANY_DOCTOR}>Any available doctor</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              Dr. {d.first_name} {d.last_name}
            </option>
          ))}
        </select>
      </Field>

      {/* Date */}
      <Field label="Day">
        <input
          type="date"
          value={date}
          min={todayStr()}
          onChange={(e) => setDate(e.target.value)}
          className="w-full border-b border-black/10 py-2.5 bg-transparent text-sm text-black focus:outline-none focus:border-[#b5471b] transition-colors"
        />
      </Field>

      {/* Time */}
      <Field label="Time">
        {loadingSlots ? (
          <p className="py-2.5 text-sm text-black/30 animate-pulse">Loading…</p>
        ) : (
          <select
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={slots.length === 0}
            className="w-full border-b border-black/10 py-2.5 bg-transparent text-sm text-black focus:outline-none focus:border-[#b5471b] transition-colors disabled:text-black/30"
          >
            <option value="">
              {slots.length === 0
                ? doctorId
                  ? 'No slots available on this day'
                  : 'Select a doctor first'
                : 'Select a time…'}
            </option>
            {slots.map((s, i) => (
              <option key={i} value={slotValue(s)}>
                {slotLabel(s)}
              </option>
            ))}
          </select>
        )}
      </Field>

      {error && <p className="text-sm text-[#b5471b]">{error}</p>}

      <button
        onClick={handleBook}
        disabled={!ready || booking}
        className="w-full rounded-full py-3.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-30"
        style={{ background: '#b5471b' }}
      >
        {booking ? 'Booking…' : 'Confirm appointment'}
      </button>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-medium text-black/35 uppercase tracking-widest">
        {label}
      </span>
      {children}
    </label>
  );
}
