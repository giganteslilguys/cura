import { describe, expect, it } from "bun:test";

import { ApiError } from "./errors";

describe("ApiError", () => {
  it("uses body.error as the message when provided", () => {
    const err = new ApiError(422, { error: "email is taken" });
    expect(err.message).toBe("email is taken");
    expect(err.status).toBe(422);
    expect(err.name).toBe("ApiError");
  });

  it("falls back to a status-based message when body has no error", () => {
    const err = new ApiError(500, {});
    expect(err.message).toBe("Request failed with status 500");
  });

  it("prefers an explicit message over body.error", () => {
    const err = new ApiError(400, { error: "bad" }, "explicit");
    expect(err.message).toBe("explicit");
  });

  it("exposes fieldErrors via getter", () => {
    const fieldErrors = { email: ["is required"] };
    const err = new ApiError(422, { errors: fieldErrors });
    expect(err.fieldErrors).toEqual(fieldErrors);
  });

  it("returns undefined fieldErrors when none are present", () => {
    const err = new ApiError(500, {});
    expect(err.fieldErrors).toBeUndefined();
  });

  it("is an instanceof Error", () => {
    const err = new ApiError(404, {});
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });
});
