import { API_BASE_URL } from "./config";
import { apiFetch } from "./client";
import { ApiError } from "./errors";

export type PatientDocument = {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  inserted_at: string;
};

export function listDocuments(
  patientId: string,
  token: string,
): Promise<{ documents: PatientDocument[] }> {
  return apiFetch(`/api/patients/${patientId}/documents`, {
    token,
    cache: "no-store",
  });
}

export async function uploadDocument(
  patientId: string,
  file: File,
  token: string,
): Promise<{ document: PatientDocument }> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch(
    `${API_BASE_URL}/api/patients/${patientId}/documents`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    },
  );

  const payload = await response.json();
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload;
}

export async function downloadDocument(
  id: string,
  token: string,
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${API_BASE_URL}/api/documents/${id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body);
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? "download";

  return { blob: await response.blob(), filename };
}

export function deleteDocument(
  id: string,
  token: string,
): Promise<undefined> {
  return apiFetch(`/api/documents/${id}`, { method: "DELETE", token });
}
