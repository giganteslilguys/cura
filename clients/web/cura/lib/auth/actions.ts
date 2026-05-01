"use server";

import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import type { FieldErrors, Role, User } from "@/lib/api/types";

import { clearSession, getSessionToken, setSessionToken } from "./session";

export type AuthActionResult =
  | { ok: true; user: User }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

const ROLES: readonly Role[] = ["doctor", "patient"];

export async function signUpAction(
  _state: AuthActionResult | undefined,
  formData: FormData,
): Promise<AuthActionResult> {
  const role = formData.get("role");
  if (typeof role !== "string" || !ROLES.includes(role as Role)) {
    return { ok: false, error: "role must be 'doctor' or 'patient'" };
  }

  try {
    const { user, token } = await authApi.signUp({
      email: stringOrEmpty(formData.get("email")),
      password: stringOrEmpty(formData.get("password")),
      first_name: stringOrEmpty(formData.get("first_name")),
      last_name: stringOrEmpty(formData.get("last_name")),
      role: role as Role,
    });
    await setSessionToken(token);
    return { ok: true, user };
  } catch (error) {
    return apiErrorToResult(error, "Could not sign up");
  }
}

export async function signInAction(
  _state: AuthActionResult | undefined,
  formData: FormData,
): Promise<AuthActionResult> {
  try {
    const { user, token } = await authApi.signIn({
      email: stringOrEmpty(formData.get("email")),
      password: stringOrEmpty(formData.get("password")),
    });
    await setSessionToken(token);
    return { ok: true, user };
  } catch (error) {
    return apiErrorToResult(error, "Could not sign in");
  }
}

export async function signOutAction(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    try {
      await authApi.signOut(token);
    } catch (error) {
      // Server-side invalidation failed (e.g. token already expired). The
      // client cookie still needs to go, so swallow non-network errors.
      if (!(error instanceof ApiError)) throw error;
    }
  }
  await clearSession();
}

function stringOrEmpty(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function apiErrorToResult(error: unknown, fallback: string): AuthActionResult {
  if (error instanceof ApiError) {
    return {
      ok: false,
      error: error.body.error ?? fallback,
      fieldErrors: error.fieldErrors,
    };
  }
  return { ok: false, error: fallback };
}
