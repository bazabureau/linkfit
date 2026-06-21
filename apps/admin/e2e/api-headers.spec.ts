// IMPORTANT: set the build-time public key BEFORE importing the API module —
// src/lib/api.ts reads NEXT_PUBLIC_LINKFIT_APP_KEY at module-load time.
const APP_KEY = "lk_test_smoke_key_123";
process.env.NEXT_PUBLIC_LINKFIT_APP_KEY = APP_KEY;

import { expect, test } from "@playwright/test";
import { api, apiHeaders } from "../src/lib/api";

/**
 * Unit-level coverage for the shared header builders in src/lib/api.ts
 * (admin-1). These run in the Node Playwright worker and import the module
 * directly.
 *
 * The Cloudflare/Laravel ApiKeyGuard 403s any request lacking
 * `X-Linkfit-App-Key`, so we assert BOTH exported header paths inject it from
 * NEXT_PUBLIC_LINKFIT_APP_KEY:
 *   - buildHeaders()  → apiFetch() / api.* (every GET/POST/PATCH/DELETE)
 *   - apiHeaders()    → refresh call, CSV/audit raw exports, venue image upload
 *
 * The absent-key fallback is covered separately in api-headers-no-key.spec.ts,
 * which loads the module in its own worker without the env var set (the key is
 * captured once at load time, so it can't be toggled within one module graph).
 */

const APP_KEY_HEADER = "x-linkfit-app-key"; // Headers are case-insensitive.

test.describe("api header injection (admin-1)", () => {
  test("apiHeaders injects X-Linkfit-App-Key and defaults Accept", async () => {
    const headers = apiHeaders();
    expect(headers.get(APP_KEY_HEADER)).toBe(APP_KEY);
    expect(headers.get("accept")).toBe("application/json");
  });

  test("apiHeaders preserves an explicit Authorization + existing headers", async () => {
    const headers = apiHeaders({ "Content-Type": "multipart/form-data" }, "tok-abc");
    expect(headers.get("authorization")).toBe("Bearer tok-abc");
    expect(headers.get("content-type")).toBe("multipart/form-data");
    expect(headers.get(APP_KEY_HEADER)).toBe(APP_KEY);
  });

  test("apiHeaders does not clobber a caller-supplied app key header", async () => {
    // Exercises the `!next.has(APP_KEY_HEADER)` guard deterministically (no
    // dependency on module-load env order): a key the caller already set wins.
    const headers = apiHeaders({ "X-Linkfit-App-Key": "caller-supplied" });
    expect(headers.get(APP_KEY_HEADER)).toBe("caller-supplied");
  });

  test("apiFetch (via buildHeaders) sends the key on every request", async () => {
    const captured: Headers[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      captured.push(new Headers(init?.headers));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await api.get("/api/v1/admin/stats");
      await api.post("/api/v1/admin/venues", { name: "x" });
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(captured.length).toBe(2);
    for (const h of captured) {
      expect(h.get(APP_KEY_HEADER)).toBe(APP_KEY);
    }
    // The POST should carry the JSON content type buildHeaders sets.
    expect(captured[1]?.get("content-type")).toBe("application/json");
  });

  test("login path (skipAuth) still carries the app key", async () => {
    let captured: Headers | null = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      captured = new Headers(init?.headers);
      return new Response(JSON.stringify({ access_token: "a" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await api.post(
        "/api/v1/auth/admin/login",
        { email: "a@b.c", password: "x" },
        { skipAuth: true, skipRefresh: true },
      );
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(captured).not.toBeNull();
    const h = captured as unknown as Headers;
    // skipAuth → no Authorization, but the gate still requires the app key.
    expect(h.get(APP_KEY_HEADER)).toBe(APP_KEY);
    expect(h.has("authorization")).toBe(false);
  });
});
