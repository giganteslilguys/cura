import { describe, expect, it } from "bun:test";

import type { Meeting } from "@/lib/api/types";

import { getMeetingPhase, getTimeUntilStart } from "./phase";

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "m1",
    title: "Visit",
    date: "2026-05-02",
    time: "10:00:00",
    duration: 30,
    notes: null,
    timezone: "UTC",
    status: "scheduled",
    doctor: null,
    patient: null,
    patient_intake: null,
    soap_note: null,
    soap_note_submitted: false,
    ...overrides,
  };
}

const start = new Date("2026-05-02T10:00:00").getTime();
const minute = 60 * 1000;

describe("getMeetingPhase", () => {
  it("returns 'pre' before the start time", () => {
    expect(getMeetingPhase(meeting(), start - minute)).toBe("pre");
  });

  it("returns 'active' at the exact start time", () => {
    expect(getMeetingPhase(meeting(), start)).toBe("active");
  });

  it("returns 'active' midway through the meeting", () => {
    expect(getMeetingPhase(meeting({ duration: 30 }), start + 15 * minute)).toBe(
      "active",
    );
  });

  it("returns 'post' at the exact end time", () => {
    expect(getMeetingPhase(meeting({ duration: 30 }), start + 30 * minute)).toBe(
      "post",
    );
  });

  it("returns 'post' after the end time", () => {
    expect(getMeetingPhase(meeting({ duration: 30 }), start + 60 * minute)).toBe(
      "post",
    );
  });

  for (const status of ["completed", "canceled", "rejected"] as const) {
    it(`returns 'post' for terminal status '${status}' regardless of clock`, () => {
      expect(getMeetingPhase(meeting({ status }), start - 60 * minute)).toBe(
        "post",
      );
    });
  }

  it("treats a 'scheduled' status during the window as active", () => {
    expect(
      getMeetingPhase(meeting({ status: "scheduled" }), start + 5 * minute),
    ).toBe("active");
  });
});

describe("getTimeUntilStart", () => {
  it("returns null once the meeting has started", () => {
    expect(getTimeUntilStart(meeting(), start)).toBeNull();
    expect(getTimeUntilStart(meeting(), start + minute)).toBeNull();
  });

  it("formats sub-minute differences in seconds", () => {
    expect(getTimeUntilStart(meeting(), start - 30 * 1000)).toBe("30s");
  });

  it("formats sub-hour differences as 'Xm Ys'", () => {
    expect(getTimeUntilStart(meeting(), start - 5 * minute - 12 * 1000)).toBe(
      "5m 12s",
    );
  });

  it("formats hour-plus differences as 'Xh Ym'", () => {
    expect(getTimeUntilStart(meeting(), start - 2 * 60 * minute - 30 * minute)).toBe(
      "2h 30m",
    );
  });
});
