import { apiFetch } from "./client";
import type { Meeting, PatientIntake, VisitSummary, TranscriptEntry } from "./types";

export function listMeetings(token: string): Promise<{ meetings: Meeting[] }> {
  return apiFetch<{ meetings: Meeting[] }>("/api/meetings", {
    token,
    cache: "no-store",
  });
}

export function getMeeting(
  id: string,
  token: string,
): Promise<{ meeting: Meeting }> {
  return apiFetch<{ meeting: Meeting }>(`/api/meetings/${id}`, {
    token,
    cache: "no-store",
  });
}

export function updateMeetingNotes(
  id: string,
  notes: string,
  token: string,
): Promise<{ meeting: Meeting }> {
  return apiFetch<{ meeting: Meeting }>(`/api/meetings/${id}/notes`, {
    method: "PATCH",
    body: { notes },
    token,
  });
}

export function submitMeetingIntake(
  id: string,
  intake: PatientIntake,
  token: string,
): Promise<{ meeting: Meeting }> {
  return apiFetch<{ meeting: Meeting }>(`/api/meetings/${id}/intake`, {
    method: "PATCH",
    body: { patient_intake: intake },
    token,
  });
}

export function saveVisitSummary(
  id: string,
  note: VisitSummary,
  submit: boolean,
  token: string,
): Promise<{ meeting: Meeting }> {
  return apiFetch<{ meeting: Meeting }>(`/api/meetings/${id}/soap_note`, {
    method: "PATCH",
    body: { soap_note: note, submit },
    token,
  });
}

export function getMeetingTranscript(
  id: string,
  token: string,
): Promise<{ transcript: TranscriptEntry[] }> {
  return apiFetch<{ transcript: TranscriptEntry[] }>(`/api/meetings/${id}/transcript`, {
    token,
    cache: "no-store",
  });
}

export type CreateOnSiteInput = {
  patient_email: string;
  title?: string;
  duration?: number;
};

/**
 * Starts an ad-hoc on-site visit. The backend resolves the patient by email,
 * sets `kind: "on_site"`, and stamps the start to "now".
 */
export function createOnSiteMeeting(
  input: CreateOnSiteInput,
  token: string,
): Promise<{ meeting: Meeting }> {
  return apiFetch<{ meeting: Meeting }>("/api/meetings/on_site", {
    method: "POST",
    body: input,
    token,
  });
}

/**
 * Marks the meeting as completed — used to end an on-site visit so the view
 * transitions into the post-meeting SOAP-note editor.
 */
export function completeMeeting(
  id: string,
  token: string,
): Promise<{ meeting: Meeting }> {
  return apiFetch<{ meeting: Meeting }>(`/api/meetings/${id}/complete`, {
    method: "PATCH",
    token,
  });
}
