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

export type Meeting = {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: number;
  notes: string | null;
  timezone: string;
  status: MeetingStatus;
  doctor: User | null;
  patient: User | null;
  patient_intake: PatientIntake | null;
};
