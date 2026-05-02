"use server";

import { createOnSiteMeeting } from "@/lib/api/meetings";
import { ApiError } from "@/lib/api/errors";
import { getSessionToken } from "@/lib/auth/session";

export type StartOnSiteResult =
  | { ok: true; meetingId: string }
  | { ok: false; error: string };

/**
 * Server action backing the "Start on-site visit" form on the meetings page.
 * Reads the session token from the httpOnly cookie, hits the Phoenix
 * `/api/meetings/on_site` endpoint, and returns the new meeting id so the
 * client widget can route into the on-site room.
 */
export async function startOnSiteVisitAction(
  _state: StartOnSiteResult | undefined,
  formData: FormData,
): Promise<StartOnSiteResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };

  const patient_email = stringOrEmpty(formData.get("patient_email")).trim();
  const title = stringOrEmpty(formData.get("title")).trim();

  if (!patient_email) {
    return { ok: false, error: "Patient email is required" };
  }

  try {
    const { meeting } = await createOnSiteMeeting(
      {
        patient_email,
        title: title || undefined,
      },
      token,
    );
    return { ok: true, meetingId: meeting.id };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) {
        return { ok: false, error: "No patient with that email" };
      }
      return { ok: false, error: error.body.error ?? "Could not start visit" };
    }
    return { ok: false, error: "Could not start visit" };
  }
}

function stringOrEmpty(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}
