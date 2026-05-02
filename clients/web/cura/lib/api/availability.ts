import { apiFetch } from "./client";
import type {
  DoctorAvailability,
  DoctorSummary,
  Meeting,
  TimeSlot,
} from "./types";

export function listDoctors(
  token: string,
): Promise<{ doctors: DoctorSummary[] }> {
  return apiFetch("/api/doctors", { token, cache: "no-store" });
}

export function getDoctorSlots(
  doctorId: string,
  date: string,
  token: string,
): Promise<{ slots: TimeSlot[] }> {
  return apiFetch(`/api/doctors/${doctorId}/slots?date=${date}`, {
    token,
    cache: "no-store",
  });
}

export type AnyTimeSlot = {
  time: string;
  duration: number;
  doctor_id: string;
  doctor_first_name: string;
  doctor_last_name: string;
};

export function getAnySlots(
  date: string,
  token: string,
): Promise<{ slots: AnyTimeSlot[] }> {
  return apiFetch(`/api/slots?date=${date}`, { token, cache: "no-store" });
}

export function bookSlot(
  body: { doctor_id: string; date: string; time: string; title: string },
  token: string,
): Promise<{ meeting: Meeting }> {
  return apiFetch("/api/book", { method: "POST", body, token });
}

export function getMyAvailability(
  token: string,
): Promise<{ availability: DoctorAvailability[] }> {
  return apiFetch("/api/availability", { token, cache: "no-store" });
}

export function createAvailability(
  body: {
    day_of_week: number;
    start_time: string;
    end_time: string;
    slot_duration: number;
  },
  token: string,
): Promise<{ availability: DoctorAvailability }> {
  return apiFetch("/api/availability", { method: "POST", body, token });
}

export function deleteAvailability(
  id: string,
  token: string,
): Promise<undefined> {
  return apiFetch(`/api/availability/${id}`, { method: "DELETE", token });
}
