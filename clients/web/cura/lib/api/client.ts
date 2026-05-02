import { PUBLIC_API_BASE_URL } from "./config";
import { ApiError, type ApiErrorBody } from "./errors";

export type ApiFetchOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  // Forwarded to the underlying `fetch` (e.g. `cache`, `next.revalidate`,
  // `signal`). Lets callers opt into Next.js fetch caching/revalidation.
  next?: RequestInit["next"];
  cache?: RequestInit["cache"];
  signal?: AbortSignal;
};

/**
 * Generic JSON API client for the Phoenix backend.
 *
 * - Serialises `body` as JSON and sets matching headers.
 * - Adds `Authorization: Bearer <token>` when a token is supplied.
 * - Throws `ApiError` on non-2xx responses, with the parsed body attached.
 * - Returns `T` parsed from JSON, or `undefined` for empty responses (204).
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { method = "GET", body, token, headers, next, cache, signal } = options;

  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...headers,
  };

  if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
  }
  if (token) {
    finalHeaders["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(joinUrl(PUBLIC_API_BASE_URL, path), {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    next,
    cache,
    signal,
  });

  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    throw new ApiError(response.status, (payload ?? {}) as ApiErrorBody);
  }

  return payload as T;
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
