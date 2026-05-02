import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { apiFetch } from "./client";
import { ApiError } from "./errors";

type FetchArgs = Parameters<typeof fetch>;
type FetchMock = ReturnType<typeof mock<(...args: FetchArgs) => Promise<Response>>>;

let fetchMock: FetchMock;
let originalFetch: typeof fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchMock = mock<(...args: FetchArgs) => Promise<Response>>(async () =>
    jsonResponse({ ok: true }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function lastInit(): RequestInit {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error("fetch was not called");
  const init = call[1];
  if (!init) throw new Error("fetch was called without an init object");
  return init;
}

function lastUrl(): string {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error("fetch was not called");
  return String(call[0]);
}

function header(init: RequestInit, name: string): string | undefined {
  const h = init.headers as Record<string, string> | undefined;
  return h?.[name];
}

describe("apiFetch", () => {
  it("issues a GET to the configured base URL with Accept header", async () => {
    const result = await apiFetch<{ ok: boolean }>("/api/me");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastUrl()).toMatch(/\/api\/me$/);
    expect(lastInit().method).toBe("GET");
    expect(header(lastInit(), "Accept")).toBe("application/json");
    expect(lastInit().body).toBeUndefined();
  });

  it("does not set Content-Type when there is no body", async () => {
    await apiFetch("/api/me");
    expect(header(lastInit(), "Content-Type")).toBeUndefined();
  });

  it("serialises the body as JSON and sets Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "1" }, 201));

    await apiFetch("/api/things", {
      method: "POST",
      body: { name: "thing" },
    });

    const init = lastInit();
    expect(init.method).toBe("POST");
    expect(header(init, "Content-Type")).toBe("application/json");
    // Use JSON.parse so we don't depend on key ordering.
    expect(JSON.parse(init.body as string)).toEqual({ name: "thing" });
  });

  it("attaches Authorization: Bearer when a token is supplied", async () => {
    await apiFetch("/api/me", { token: "secret-token" });
    expect(header(lastInit(), "Authorization")).toBe("Bearer secret-token");
  });

  it("does not attach Authorization when token is null", async () => {
    await apiFetch("/api/me", { token: null });
    expect(header(lastInit(), "Authorization")).toBeUndefined();
  });

  it("merges caller-provided headers with the defaults", async () => {
    await apiFetch("/api/me", { headers: { "X-Trace-Id": "abc" } });
    const init = lastInit();
    expect(header(init, "X-Trace-Id")).toBe("abc");
    expect(header(init, "Accept")).toBe("application/json");
  });

  it("returns undefined for 204 responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await apiFetch("/api/things/1", { method: "DELETE" });
    expect(result).toBeUndefined();
  });

  it("returns undefined for 200 responses with empty body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    const result = await apiFetch("/api/empty");
    expect(result).toBeUndefined();
  });

  it("throws ApiError on non-2xx with parsed body and field errors", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: "unauthorized", errors: { email: ["bad"] } },
        401,
      ),
    );

    let caught: unknown;
    try {
      await apiFetch("/api/me");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.status).toBe(401);
    expect(err.message).toBe("unauthorized");
    expect(err.fieldErrors).toEqual({ email: ["bad"] });
  });

  it("wraps non-JSON error bodies in { error: text }", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 500 }));

    let caught: unknown;
    try {
      await apiFetch("/api/oops");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).body).toEqual({ error: "not json" });
  });

  it("forwards AbortSignal to underlying fetch", async () => {
    const controller = new AbortController();
    await apiFetch("/api/me", { signal: controller.signal });
    expect(lastInit().signal).toBe(controller.signal);
  });

  it("passes absolute URLs through unchanged", async () => {
    await apiFetch("https://example.com/api/me");
    expect(lastUrl()).toBe("https://example.com/api/me");
  });
});
