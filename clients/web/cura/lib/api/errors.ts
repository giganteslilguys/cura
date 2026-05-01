import type { FieldErrors } from "./types";

export type ApiErrorBody = {
  error?: string;
  errors?: FieldErrors;
  [key: string]: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody, message?: string) {
    super(message ?? body.error ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  get fieldErrors(): FieldErrors | undefined {
    return this.body.errors;
  }
}
