import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { completeMeeting, createOnSiteMeeting } from "./meetings";

type FetchArgs = Parameters<typeof fetch>;
type FetchMock = ReturnType<typeof mock<(...args: FetchArgs) => Promise<Response>>>;

let fetchMock: FetchMock;
let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchMock = mock<(...args: FetchArgs) => Promise<Response>>(async () =>
    new Response(JSON.stringify({ meeting: { id: "m-1" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error("fetch was not called");
  const init = call[1];
  if (!init) throw new Error("fetch was called without an init object");
  return { url: String(call[0]), init };
}

function header(init: RequestInit, name: string): string | undefined {
  const h = init.headers as Record<string, string> | undefined;
  return h?.[name];
}

describe("createOnSiteMeeting", () => {
  it("POSTs the patient email to /api/meetings/on_site with bearer token", async () => {
    await createOnSiteMeeting(
      { patient_email: "p@x.com", title: "Sore throat", duration: 30 },
      "tok",
    );

    const { url, init } = lastCall();
    expect(url).toMatch(/\/api\/meetings\/on_site$/);
    expect(init.method).toBe("POST");
    expect(header(init, "Authorization")).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({
      patient_email: "p@x.com",
      title: "Sore throat",
      duration: 30,
    });
  });

  it("omits optional fields when not provided", async () => {
    await createOnSiteMeeting({ patient_email: "p@x.com" }, "tok");
    const body = JSON.parse(lastCall().init.body as string);
    expect(body).toEqual({ patient_email: "p@x.com" });
  });
});

describe("completeMeeting", () => {
  it("PATCHes /api/meetings/:id/complete with bearer token and no body", async () => {
    await completeMeeting("m-1", "tok");

    const { url, init } = lastCall();
    expect(url).toMatch(/\/api\/meetings\/m-1\/complete$/);
    expect(init.method).toBe("PATCH");
    expect(header(init, "Authorization")).toBe("Bearer tok");
    expect(init.body).toBeUndefined();
  });
});
