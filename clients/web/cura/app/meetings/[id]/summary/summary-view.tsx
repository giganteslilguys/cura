'use client';

import {
  AlertTriangle,
  Calendar,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FlaskConical,
  HeartPulse,
  Pill,
  Stethoscope,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { Diagnosis, Meeting, Prescription, VisitSummary } from '@/lib/api/types';

export function SummaryView({
  meeting,
  soap,
}: {
  meeting: Meeting;
  soap: VisitSummary;
}) {
  const doctor = meeting.doctor;

  const start      = new Date(`${meeting.date}T${meeting.time}`);
  const end        = new Date(start.getTime() + meeting.duration * 60_000);
  const dateStr    = start.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr    = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const endTimeStr = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const doctorName = doctor ? `Dr. ${doctor.first_name} ${doctor.last_name}` : 'Your Doctor';
  const chiefComplaint = meeting.patient_intake?.reason ?? null;

  const hasVitals      = soap.vitals && Object.values(soap.vitals).some(Boolean);
  const diagnoses      = soap.diagnoses ?? [];
  const treatment_plan = soap.treatment_plan ?? [];
  const prescriptions  = soap.prescriptions ?? [];
  const lab_orders     = soap.lab_orders ?? [];
  const when_to_seek   = soap.when_to_seek_care ?? [];
  const assessment     = soap.clinical_assessment ?? null;
  const follow_up      = soap.follow_up_appointment ?? null;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      {/* Top bar */}
      <header className="sticky top-0 z-10 bg-white border-b border-stone-200">
        <div className="max-w-2xl mx-auto px-5 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-stone-900">Visit Summary</h1>
            <p className="text-xs text-stone-400">{dateStr}</p>
          </div>
          <Link
            href="/meetings"
            className="px-4 py-1.5 text-sm font-medium text-stone-600 hover:text-stone-900 border border-stone-200 rounded-full transition-colors"
          >
            Back to visits
          </Link>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

        {/* Doctor / visit info card */}
        <div className="bg-white rounded-2xl border border-stone-200 p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-orange-500 flex items-center justify-center text-white shrink-0">
              <User className="w-6 h-6" />
            </div>
            <div>
              <p className="font-semibold text-stone-900">{doctorName}</p>
              <p className="text-xs text-stone-400 mt-0.5">Physician</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-stone-100 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1">Date &amp; Time</p>
              <p className="font-medium text-stone-900">{dateStr}</p>
              <p className="text-xs text-stone-400">{timeStr} – {endTimeStr}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1">Duration</p>
              <p className="font-medium text-stone-900">{meeting.duration} minutes</p>
              <p className="text-xs text-stone-400">Telemedicine Visit</p>
            </div>
            {chiefComplaint && (
              <div className="col-span-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1">Chief Complaint</p>
                <p className="text-stone-700">{chiefComplaint}</p>
              </div>
            )}
          </div>
        </div>

        {/* Vitals */}
        {hasVitals && (
          <Section icon={<HeartPulse className="w-4 h-4" />} title="Vitals Recorded" defaultOpen>
            <div className="grid grid-cols-2 gap-px bg-stone-100 rounded-xl overflow-hidden border border-stone-100">
              {soap.vitals!.blood_pressure && <Vital label="Blood Pressure" value={soap.vitals!.blood_pressure} />}
              {soap.vitals!.heart_rate     && <Vital label="Heart Rate"     value={soap.vitals!.heart_rate} />}
              {soap.vitals!.temperature    && <Vital label="Temperature"    value={soap.vitals!.temperature} />}
              {soap.vitals!.weight         && <Vital label="Weight"         value={soap.vitals!.weight} />}
            </div>
          </Section>
        )}

        {/* Diagnoses */}
        {diagnoses.length > 0 && (
          <Section
            icon={<Stethoscope className="w-4 h-4" />}
            title="Diagnosis"
            badge={`${diagnoses.length} condition${diagnoses.length === 1 ? '' : 's'}`}
            defaultOpen
          >
            <div className="divide-y divide-stone-100">
              {diagnoses.map((d: Diagnosis, i: number) => (
                <div key={i} className="flex items-start justify-between py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium text-stone-900">{d.condition}</p>
                    {d.icd_code && <p className="text-xs text-stone-400 mt-0.5">ICD-10: {d.icd_code}</p>}
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ml-3 ${
                    d.type === 'primary' ? 'bg-blue-100 text-blue-700' : 'bg-stone-100 text-stone-600'
                  }`}>
                    {d.type === 'primary' ? 'Primary' : 'Secondary'}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Clinical Assessment */}
        {assessment && (
          <Section icon={<ClipboardList className="w-4 h-4" />} title="Clinical Assessment" defaultOpen={false}>
            <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">{assessment}</p>
          </Section>
        )}

        {/* Treatment Plan */}
        {treatment_plan.length > 0 && (
          <Section
            icon={<ClipboardCheck className="w-4 h-4" />}
            title="Treatment Plan"
            badge={`${treatment_plan.length} item${treatment_plan.length === 1 ? '' : 's'}`}
            defaultOpen
          >
            <ul className="space-y-2.5">
              {treatment_plan.map((item: string, i: number) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                  </div>
                  <p className="text-sm text-stone-700 leading-relaxed">{item}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Prescriptions */}
        {prescriptions.length > 0 && (
          <Section
            icon={<Pill className="w-4 h-4" />}
            title="Prescriptions"
            badge={`${prescriptions.length} new`}
            defaultOpen
          >
            <div className="space-y-3">
              {prescriptions.map((rx: Prescription, i: number) => (
                <div key={i} className="border border-stone-200 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-sm text-stone-900">{rx.name}</p>
                      {rx.dosage && <p className="text-xs text-stone-400 mt-0.5">{rx.dosage}</p>}
                    </div>
                    <div className="text-right text-xs text-stone-400 shrink-0">
                      {rx.quantity && <p>{rx.quantity}</p>}
                      {rx.refills  && <p>{rx.refills} refills</p>}
                    </div>
                  </div>
                  {rx.instructions && (
                    <p className="text-xs text-stone-500 mt-2 leading-relaxed border-t border-stone-100 pt-2">
                      Instructions: {rx.instructions}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Lab Orders */}
        {lab_orders.length > 0 && (
          <Section
            icon={<FlaskConical className="w-4 h-4" />}
            title="Lab Orders"
            badge={`${lab_orders.length} order${lab_orders.length === 1 ? '' : 's'}`}
            defaultOpen={false}
          >
            <ul className="space-y-2">
              {lab_orders.map((order: string, i: number) => (
                <li key={i} className="flex items-center gap-2 text-sm text-stone-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-400 shrink-0" />
                  {order}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Follow-Up */}
        {follow_up && (
          <Section icon={<Calendar className="w-4 h-4" />} title="Follow-Up Appointment" defaultOpen={false}>
            <p className="text-sm text-stone-700">{follow_up}</p>
          </Section>
        )}

        {/* When to Seek Immediate Care */}
        {when_to_seek.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
              <h2 className="font-semibold text-stone-900">When to Seek Immediate Care</h2>
            </div>
            <p className="text-xs text-stone-500 mb-3 ml-7">Contact your doctor or go to the ER if you experience:</p>
            <ul className="space-y-2 ml-7">
              {when_to_seek.map((item: string, i: number) => (
                <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                  <span className="text-red-400 mt-0.5 shrink-0">•</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="text-xs font-semibold text-red-600 mt-3 ml-7">
              Emergency: Call 112 or go to your nearest emergency room.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="bg-white rounded-2xl border border-stone-200 px-5 py-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-stone-900">Have questions?</p>
            <p className="text-xs text-stone-400 mt-0.5">Reach out to {doctorName} for any follow-up.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/meetings"
              className="px-4 py-2 border border-stone-200 text-sm font-medium text-stone-600 rounded-full hover:bg-stone-50 transition-colors"
            >
              Back to visits
            </Link>
            <Link
              href="/book"
              className="px-4 py-2 text-sm font-medium text-white rounded-full hover:opacity-90 transition-opacity"
              style={{ background: '#b5471b' }}
            >
              Contact doctor
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}

function Section({
  icon, title, badge, children, defaultOpen = true,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-stone-50 transition-colors"
      >
        <span className="text-orange-500 shrink-0">{icon}</span>
        <span className="font-semibold text-stone-900 flex-1 text-sm">{title}</span>
        {badge && (
          <span className="text-xs font-medium text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
        <ChevronRight className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-stone-100">
          <div className="pt-4">{children}</div>
        </div>
      )}
    </div>
  );
}

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1">{label}</p>
      <p className="text-lg font-bold text-stone-900">{value}</p>
    </div>
  );
}
