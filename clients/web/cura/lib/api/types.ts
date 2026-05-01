export type Role = "doctor" | "patient";

export type User = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
};

export type AuthSuccess = {
  user: User;
  token: string;
};

export type FieldErrors = Record<string, string[]>;

export type MeetingStatus = "scheduled" | "completed" | "canceled" | "rejected";

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
};
