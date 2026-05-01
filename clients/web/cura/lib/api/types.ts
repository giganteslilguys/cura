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
