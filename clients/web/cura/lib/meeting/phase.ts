import type { Meeting } from "@/lib/api/types";

export type MeetingPhase = "pre" | "active" | "post";

const TERMINAL_STATUSES = new Set<Meeting["status"]>([
  "completed",
  "canceled",
  "rejected",
]);

/**
 * Resolve which phase of the meeting timeline we are in.
 *
 * - Terminal statuses (completed/canceled/rejected) always map to "post".
 * - Otherwise we compare wall-clock time against [start, start + duration).
 */
export function getMeetingPhase(meeting: Meeting, now = Date.now()): MeetingPhase {
  if (TERMINAL_STATUSES.has(meeting.status)) return "post";

  const start = startMs(meeting);
  const end = start + meeting.duration * 60 * 1000;

  if (now < start) return "pre";
  if (now >= end) return "post";
  return "active";
}

function startMs(meeting: Meeting): number {
  return new Date(`${meeting.date}T${meeting.time}`).getTime();
}

/**
 * Human-friendly countdown until the meeting starts. Returns `null` once the
 * meeting is underway. Used for the patient "waiting room" view.
 */
export function getTimeUntilStart(
  meeting: Meeting,
  now = Date.now(),
): string | null {
  const diff = startMs(meeting) - now;
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
