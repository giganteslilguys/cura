import { apiFetch } from "./client";
import type { Meeting, PatientIntake } from "./types";

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
