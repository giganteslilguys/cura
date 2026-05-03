export type Role = "doctor" | "patient";

export type Sex = "male" | "female" | "other";

export type AllergySeverity = "mild" | "moderate" | "severe";

export type Medication = {
  name: string;
  dose: string | null;
  frequency: string | null;
};

export type Allergy = {
  substance: string;
  severity: AllergySeverity;
};

export type PatientProfile = {
  sex: Sex | null;
  date_of_birth: string | null;
  weight_kg: number | null;
  height_cm: number | null;
  bmi: number | null;
  medications: Medication[];
  allergies: Allergy[];
  conditions: string[];
};

export type User = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  patient_profile: PatientProfile | null;
};

export type AuthSuccess = {
  user: User;
  token: string;
};

export type FieldErrors = Record<string, string[]>;

export type MeetingStatus = "scheduled" | "completed" | "canceled" | "rejected";

export type MeetingKind = "remote" | "on_site";

export type PatientIntake = {
  reason: string;
  symptoms: string | null;
  notes: string | null;
};

export type SuggestionType = "question" | "action" | "flag";

export type SuggestionPriority = "high" | "medium" | "low";

export type Suggestion = {
  id: string;
  type: SuggestionType;
  text: string;
  rationale: string;
  priority: SuggestionPriority;
};

export type Vitals = {
  blood_pressure: string | null;
  heart_rate: string | null;
  temperature: string | null;
  weight: string | null;
};

export type Diagnosis = {
  condition: string;
  icd_code: string | null;
  type: "primary" | "secondary";
};

export type Prescription = {
  name: string;
  dosage: string | null;
  quantity: string | null;
  refills: string | null;
  instructions: string | null;
};

export type VisitSummary = {
  vitals: Vitals | null;
  diagnoses: Diagnosis[];
  clinical_assessment: string | null;
  treatment_plan: string[];
  prescriptions: Prescription[];
  lab_orders: string[];
  follow_up_appointment: { date: string; time: string } | null;
  when_to_seek_care: string[];
};

export type TranscriptEntry = {
  id: string;
  speaker: "doctor" | "patient";
  text: string;
  timestamp: string;
};

export type DoctorSummary = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
};

export type DoctorAvailability = {
  id: string;
  day_of_week: number; // 1=Mon … 7=Sun
  start_time: string;  // "HH:MM:SS"
  end_time: string;
  slot_duration: number;
};

export type TimeSlot = {
  time: string;    // "HH:MM:SS"
  duration: number;
};

export type Meeting = {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: number;
  notes: string | null;
  timezone: string;
  kind: MeetingKind;
  status: MeetingStatus;
  doctor: User | null;
  patient: User | null;
  patient_intake: PatientIntake | null;
  soap_note: VisitSummary | null;
  soap_note_submitted: boolean;
};
