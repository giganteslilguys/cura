import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { getMe, signIn, signOut, signUp } from "./auth";

type FetchArgs = Parameters<typeof fetch>;
type FetchMock = ReturnType<typeof mock<(...args: FetchArgs) => Promise<Response>>>;

let fetchMock: FetchMock;
let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchMock = mock<(...args: FetchArgs) => Promise<Response>>(async () =>
    new Response(JSON.stringify({ ok: true }), {
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

describe("auth API wrappers", () => {
  it("signUp POSTs the full payload to /api/auth/sign_up", async () => {
    await signUp({
      email: "a@b.com",
      password: "pw",
      first_name: "Ana",
      last_name: "Costa",
      role: "doctor",
    });

    const { url, init } = lastCall();
    expect(url).toMatch(/\/api\/auth\/sign_up$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "a@b.com",
      password: "pw",
      first_name: "Ana",
      last_name: "Costa",
      role: "doctor",
    });
  });

  it("signIn POSTs only credentials", async () => {
    await signIn({ email: "a@b.com", password: "pw" });

    const { url, init } = lastCall();
    expect(url).toMatch(/\/api\/auth\/sign_in$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "a@b.com",
      password: "pw",
    });
  });

  it("signOut DELETEs with bearer token and no body", async () => {
    await signOut("token-123");

    const { url, init } = lastCall();
    expect(url).toMatch(/\/api\/auth\/sign_out$/);
    expect(init.method).toBe("DELETE");
    expect(header(init, "Authorization")).toBe("Bearer token-123");
    expect(init.body).toBeUndefined();
  });

  it("getMe sends bearer token and disables cache", async () => {
    await getMe("token-abc");

    const { url, init } = lastCall();
    expect(url).toMatch(/\/api\/me$/);
    expect(header(init, "Authorization")).toBe("Bearer token-abc");
    expect(init.cache).toBe("no-store");
  });
});
