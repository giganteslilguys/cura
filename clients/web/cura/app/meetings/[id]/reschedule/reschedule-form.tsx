'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDoctorSlots } from '@/lib/api/availability';
import { rescheduleMeeting } from '@/lib/api/meetings';
import { ApiError } from '@/lib/api/errors';
import type { DoctorSummary, TimeSlot } from '@/lib/api/types';

function fmt(t: string) {
  const [h, m] = t.split(':');
  return `${h.padStart(2, '0')}:${m}`;
}


export function RescheduleForm({
  meetingId,
  currentDoctorId,
  currentDate,
  doctors,
  token,
}: {
  meetingId: string;
  currentDoctorId: string;
  currentDate: string;
  doctors: DoctorSummary[];
  token: string;
}) {
  const router = useRouter();

  const [doctorId, setDoctorId] = useState(currentDoctorId);
  const [date, setDate] = useState(currentDate);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [time, setTime] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load slots whenever doctor or date changes
  useEffect(() => {
    setTime('');
    setSlots([]);
    if (!doctorId || !date) return;

    setLoadingSlots(true);
    getDoctorSlots(doctorId, date, token)
      .then(({ slots }) => setSlots(slots))
      .catch(() => setError('Não foi possível carregar os horários disponíveis.'))
      .finally(() => setLoadingSlots(false));
  }, [doctorId, date, token]);

  const handleSubmit = async () => {
    if (!doctorId || !date || !time) return;
    setSubmitting(true);
    setError(null);

    try {
      await rescheduleMeeting(meetingId, { doctor_id: doctorId, date, time }, token);
      router.push('/meetings');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const msg =
          (err.body as Record<string, unknown>)?.error as string | undefined;
        setError(msg ?? 'Não foi possível reagendar. Por favor, tente novamente.');
      } else {
        setError('Não foi possível reagendar. Por favor, tente novamente.');
      }
      setSubmitting(false);
    }
  };

  const ready = doctorId && date && time;

  return (
    <div className="flex flex-col gap-7">
      {/* Doctor */}
      <Field label="Médico/a">
        <select
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          className="w-full border-b border-black/10 py-2.5 bg-transparent text-sm text-black focus:outline-none focus:border-[#b5471b] transition-colors"
        >
          <option value="">Selecione um médico/a…</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              Dr. {d.first_name} {d.last_name}
            </option>
          ))}
        </select>
      </Field>

      {/* Date */}
      <Field label="Dia">
        <input
          type="date"
          value={date}
          min={currentDate}
          onChange={(e) => setDate(e.target.value)}
          className="w-full border-b border-black/10 py-2.5 bg-transparent text-sm text-black focus:outline-none focus:border-[#b5471b] transition-colors"
        />
      </Field>

      {/* Time */}
      <Field label="Hora">
        {loadingSlots ? (
          <p className="py-2.5 text-sm text-black/30 animate-pulse">A carregar…</p>
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
                  ? 'Sem horários disponíveis neste dia'
                  : 'Selecione primeiro um médico/a'
                : 'Selecione uma hora…'}
            </option>
            {slots.map((s, i) => (
              <option key={i} value={s.time}>
                {fmt(s.time)}
              </option>
            ))}
          </select>
        )}
      </Field>

      {error && <p className="text-sm text-[#b5471b]">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={!ready || submitting}
        className="w-full rounded-full py-3.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-30"
        style={{ background: '#b5471b' }}
      >
        {submitting ? 'A reagendar…' : 'Confirmar reagendamento'}
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
