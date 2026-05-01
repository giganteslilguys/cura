const DEFAULT_API_BASE_URL = "http://localhost:4000";

export const API_BASE_URL: string =
  process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL;

// Public, browser-visible URL for the API. Server-only callers can use
// `API_BASE_URL`; client components must use `NEXT_PUBLIC_API_BASE_URL`.
export const PUBLIC_API_BASE_URL: string =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

// WebSocket URL derived from the public API URL (http→ws, https→wss).
export const PUBLIC_SOCKET_URL: string = PUBLIC_API_BASE_URL.replace(
  /^http/,
  "ws",
);
