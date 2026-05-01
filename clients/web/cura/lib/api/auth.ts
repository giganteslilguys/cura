import { apiFetch } from "./client";
import type { AuthSuccess, Role, User } from "./types";

export type SignUpInput = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: Role;
};

export type SignInInput = {
  email: string;
  password: string;
};

export function signUp(input: SignUpInput): Promise<AuthSuccess> {
  return apiFetch<AuthSuccess>("/api/auth/sign_up", {
    method: "POST",
    body: input,
  });
}

export function signIn(input: SignInInput): Promise<AuthSuccess> {
  return apiFetch<AuthSuccess>("/api/auth/sign_in", {
    method: "POST",
    body: input,
  });
}

export function signOut(token: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>("/api/auth/sign_out", {
    method: "DELETE",
    token,
  });
}

export function getMe(token: string): Promise<{ user: User }> {
  return apiFetch<{ user: User }>("/api/me", {
    token,
    cache: "no-store",
  });
}
