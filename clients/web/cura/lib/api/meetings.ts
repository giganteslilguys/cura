import { apiFetch } from "./client";
import type { Meeting } from "./types";

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
