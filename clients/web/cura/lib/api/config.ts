const DEFAULT_API_BASE_URL = "http://localhost:4000";

export const API_BASE_URL: string =
  process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL;
