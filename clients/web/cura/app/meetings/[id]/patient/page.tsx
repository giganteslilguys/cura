import {
  ArrowLeft,
  ArrowRight,
  Pill,
  AlertTriangle,
  Activity,
  User,
  HeartPulse,
  ClipboardList,
  NotebookPen,
  FolderOpen,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Nav } from '@/components/nav';
import { getMeeting } from '@/lib/api/meetings';
import { getCurrentUser } from '@/lib/auth/dal';
import { getSessionToken } from '@/lib/auth/session';
import type { Allergy, Medication } from '@/lib/api/types';
import { NotesEditor } from './notes-editor';
import { DocumentsPanel } from './documents-panel';
import { listDocuments } from '@/lib/api/documents';

export default async function PatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  if (user.role !== 'doctor') redirect(`/meetings/${id}`);

  const token = await getSessionToken();
  if (!token) redirect('/sign-in');

  const { meeting } = await getMeeting(id, token);
  if (!meeting.patient) notFound();

  const patient = meeting.patient;
  const profile = patient.patient_profile;
  const intake = meeting.patient_intake;
  const { documents } = await listDocuments(patient.id, token).catch(() => ({ documents: [] }));

  const fullName = `${patient.first_name} ${patient.last_name}`;

  return (
    <div className="min-h-screen bg-white">
      <Nav user={user} token={token} />

      <main className="max-w-2xl mx-auto px-6 pt-28 pb-24">
        {/* Back */}
        <Link
          href="/meetings"
          className="inline-flex items-center gap-1.5 text-xs text-black/35 hover:text-[#b5471b] transition-colors mb-8"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to visits
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="text-2xl font-semibold text-black">{fullName}</h1>
            <p className="text-sm text-black/40 mt-1">{meeting.title}</p>
          </div>
          {meeting.status === 'scheduled' && (() => {
            const start = new Date(`${meeting.date}T${meeting.time}`).getTime();
            const upcoming = meeting.kind === 'on_site' || start > Date.now();
            return upcoming ? (
              <Link
                href={`/meetings/${id}`}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-[#b5471b] text-white text-sm font-medium hover:opacity-90 transition-opacity shrink-0"
              >
                Join visit <ArrowRight className="w-4 h-4" />
              </Link>
            ) : null;
          })()}
        </div>

        <div className="flex flex-col gap-6">
          {/* Demographics */}
          <Section title="Demographics" icon={<User className="w-4 h-4" />}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="Date of birth" value={profile?.date_of_birth ?? '—'} />
              <Stat
                label="Sex"
                value={
                  profile?.sex
                    ? profile.sex.charAt(0).toUpperCase() + profile.sex.slice(1)
                    : '—'
                }
              />
              <Stat
                label="Weight"
                value={profile?.weight_kg ? `${profile.weight_kg} kg` : '—'}
              />
              <Stat
                label="Height"
                value={profile?.height_cm ? `${profile.height_cm} cm` : '—'}
              />
            </div>
          </Section>

          {/* Vitals */}
          {profile?.bmi != null && (
            <Section title="Vitals" icon={<HeartPulse className="w-4 h-4" />}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="BMI" value={profile.bmi.toFixed(1)} />
                <Stat
                  label="BMI category"
                  value={bmiCategory(profile.bmi)}
                />
              </div>
            </Section>
          )}

          {/* Medications */}
          <Section title="Medications" icon={<Pill className="w-4 h-4" />}>
            {profile?.medications?.length ? (
              <ul className="flex flex-col gap-2">
                {profile.medications.map((med, i) => (
                  <MedicationRow key={i} med={med} />
                ))}
              </ul>
            ) : (
              <Empty>No medications on record.</Empty>
            )}
          </Section>

          {/* Allergies */}
          <Section
            title="Allergies"
            icon={<AlertTriangle className="w-4 h-4" />}
          >
            {profile?.allergies?.length ? (
              <ul className="flex flex-col gap-2">
                {profile.allergies.map((a, i) => (
                  <AllergyRow key={i} allergy={a} />
                ))}
              </ul>
            ) : (
              <Empty>No allergies on record.</Empty>
            )}
          </Section>

          {/* Conditions */}
          <Section
            title="Medical conditions"
            icon={<Activity className="w-4 h-4" />}
          >
            {profile?.conditions?.length ? (
              <div className="flex flex-wrap gap-2">
                {profile.conditions.map((c, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 rounded-full text-xs font-medium"
                    style={{
                      background: 'rgba(181,71,27,0.07)',
                      color: '#b5471b',
                      border: '1px solid rgba(181,71,27,0.15)',
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <Empty>No conditions on record.</Empty>
            )}
          </Section>

          {/* Doctor notes */}
          <Section
            title="My notes"
            icon={<NotebookPen className="w-4 h-4" />}
          >
            <NotesEditor
              meetingId={id}
              token={token}
              initialNotes={meeting.notes ?? ''}
            />
          </Section>

          {/* Documents */}
          <Section
            title="Documents"
            icon={<FolderOpen className="w-4 h-4" />}
          >
            <DocumentsPanel
              patientId={patient.id}
              token={token}
              initialDocuments={documents}
            />
          </Section>

          {/* Pre-visit intake */}
          <Section
            title="Pre-visit intake"
            icon={<ClipboardList className="w-4 h-4" />}
          >
            {intake ? (
              <div className="flex flex-col gap-4">
                <IntakeField label="Reason for visit" value={intake.reason} />
                {intake.symptoms && (
                  <IntakeField label="Symptoms" value={intake.symptoms} />
                )}
                {intake.notes && (
                  <IntakeField label="Additional notes" value={intake.notes} />
                )}
              </div>
            ) : (
              <Empty>Patient has not submitted pre-visit information yet.</Empty>
            )}
          </Section>
        </div>
      </main>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function bmiCategory(bmi: number): string {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        border: '1px solid rgba(0,0,0,0.07)',
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <span style={{ color: '#b5471b' }}>{icon}</span>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-black/40">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-black/35">{label}</span>
      <span className="text-sm font-medium text-black">{value}</span>
    </div>
  );
}

function MedicationRow({ med }: { med: Medication }) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="font-medium text-black">{med.name}</span>
      {med.dose && <span className="text-black/40">{med.dose}</span>}
      {med.frequency && (
        <span className="text-black/30 text-xs">{med.frequency}</span>
      )}
    </li>
  );
}

function AllergyRow({ allergy }: { allergy: Allergy }) {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    mild: {
      bg: 'rgba(0,0,0,0.03)',
      text: 'rgba(0,0,0,0.5)',
      border: 'rgba(0,0,0,0.08)',
    },
    moderate: {
      bg: 'rgba(181,71,27,0.06)',
      text: '#b5471b',
      border: 'rgba(181,71,27,0.15)',
    },
    severe: {
      bg: 'rgba(181,27,27,0.07)',
      text: '#b51b1b',
      border: 'rgba(181,27,27,0.18)',
    },
  };
  const c = colors[allergy.severity] ?? colors.mild;

  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="font-medium text-black">{allergy.substance}</span>
      <span
        className="px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
      >
        {allergy.severity}
      </span>
    </li>
  );
}

function IntakeField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-black/35 mb-1">{label}</p>
      <p className="text-sm text-black/80 leading-relaxed">{value}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-black/30 italic">{children}</p>;
}
