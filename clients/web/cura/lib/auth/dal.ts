import "server-only";

import { cache } from "react";

import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import type { User } from "@/lib/api/types";

import { clearSession, getSessionToken } from "./session";

/**
 * Returns the authenticated user, or `null` if there is no valid session.
 * Memoised per request via React `cache`, so callers can use it freely
 * across Server Components without firing duplicate requests.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { user } = await authApi.getMe(token);
    return user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // Token is invalid/expired — drop the cookie so subsequent reads are
      // fast and the user is treated as logged out.
      await clearSession();
      return null;
    }
    throw error;
  }
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Not authenticated");
  }
  return user;
}
