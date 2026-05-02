import "server-only";

import { cache } from "react";

import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import type { User } from "@/lib/api/types";

import { getSessionToken } from "./session";

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
