import { expect, test } from "@playwright/test";
import { api, apiBlob, apiHeaders, APIError } from "../src/lib/api";

/**
 * Unit tests for the partner API client header wiring — runs in the Playwright
 * runner with NO browser and NO live server. It stubs `globalThis.fetch` and a
 * minimal `document` (for the cookie helpers) and imports the REAL `src/lib/api`
 * module so we exercise the exact production code paths.
 *
 * Covers the P0 security fix (X-Linkfit-App-Key on every request, incl. the
 * blob/export path and the manual refresh fetch) and the 401 → refresh → retry
 * resilience loop.
 *
 * The app key is read once at module-eval time, so it is configured via the
 * `globalSetup`/config env (NEXT_PUBLIC_LINKFIT_APP_KEY) BEFORE this module is
 * imported. The "no key" / "API_KEY fallback" branches are covered by source
 * assertions in security-config.unit.spec.ts.
 */

const APP_KEY = process.env.NEXT_PUBLIC_LINKFIT_APP_KEY || "lk_test_partner_key";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/**
 * Install a fake `fetch` that records every call and replays a scripted queue
 * of responses. Also installs a fake `document` so the cookie helpers can read
 * the access/refresh tokens we plant.
 */
function installFakes(opts: {
  cookies?: Record<string, string>;
  responses: Array<{ status: number; body?: unknown; blob?: string }>;
}) {
  const calls: CapturedRequest[] = [];
  const queue = [...opts.responses];
  const cookieJar = { ...(opts.cookies ?? {}) };

  const renderCookie = () =>
    Object.entries(cookieJar)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("; ");

  const originalDocument = (globalThis as { document?: unknown }).document;
  (globalThis as { document: unknown }).document = {
    get cookie() {
      return renderCookie();
    },
    set cookie(raw: string) {
      const [pair] = raw.split(";");
      if (!pair) return;
      const eq = pair.indexOf("=");
      if (eq === -1) return;
      const name = pair.slice(0, eq).trim();
      const value = decodeURIComponent(pair.slice(eq + 1).trim());
      if (raw.includes("Max-Age=0")) delete cookieJar[name];
      else cookieJar[name] = value;
    },
  };

  // cookies.ts's buildCookie reads window.location.protocol when document
  // exists, so a document shim alone makes setCookie throw (window is
  // undefined in node) — which silently aborts the refresh flow. Provide a
  // matching window shim with an http origin (so the Secure flag is omitted).
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window: unknown }).window = {
    location: { protocol: "http:", pathname: "/owner", assign() {} },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const headersObj: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((v, k) => {
      headersObj[k.toLowerCase()] = v;
    });
    calls.push({
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: headersObj,
      body: (init?.body as string | null) ?? null,
    });
    const next = queue.shift() ?? { status: 200, body: {} };
    const payload =
      next.blob !== undefined
        ? next.blob
        : next.body !== undefined
          ? JSON.stringify(next.body)
          : "";
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      statusText: "",
      text: async () => payload,
      json: async () => (payload ? JSON.parse(payload) : {}),
      blob: async () => ({ size: payload.length, type: "text/csv" }),
    } as unknown as Response;
  }) as typeof fetch;

  return {
    calls,
    cookieJar,
    restore() {
      globalThis.fetch = originalFetch;
      if (originalDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document: unknown }).document = originalDocument;
      }
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window: unknown }).window = originalWindow;
      }
    },
  };
}

test.describe("X-Linkfit-App-Key wiring (P0 security)", () => {
  test("api.get sends the app key + auth + accept headers", async () => {
    const fakes = installFakes({
      cookies: { lf_admin_access: "access-token-aaa" },
      responses: [{ status: 200, body: { items: [] } }],
    });
    try {
      await api.get("/api/v1/partner/courts");

      expect(fakes.calls).toHaveLength(1);
      const req = fakes.calls[0]!;
      expect(req.url).toContain("/api/v1/partner/courts");
      expect(req.headers["x-linkfit-app-key"]).toBe(APP_KEY);
      expect(req.headers["authorization"]).toBe("Bearer access-token-aaa");
      expect(req.headers["accept"]).toBe("application/json");
    } finally {
      fakes.restore();
    }
  });

  test("api.post sends the app key and a JSON content-type", async () => {
    const fakes = installFakes({
      cookies: { lf_admin_access: "access-token-bbb" },
      responses: [{ status: 200, body: { ok: true } }],
    });
    try {
      await api.post("/api/v1/partner/bookings", { court_id: "c1" });

      const req = fakes.calls[0]!;
      expect(req.method).toBe("POST");
      expect(req.headers["x-linkfit-app-key"]).toBe(APP_KEY);
      expect(req.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(req.body!)).toEqual({ court_id: "c1" });
    } finally {
      fakes.restore();
    }
  });

  test("api.patch / api.put / api.delete all carry the app key", async () => {
    const fakes = installFakes({
      cookies: { lf_admin_access: "t" },
      responses: [
        { status: 200, body: {} },
        { status: 200, body: {} },
        { status: 204 },
      ],
    });
    try {
      await api.patch("/api/v1/partner/account", { display_name: "X" });
      await api.put("/api/v1/partner/rules", { booking_slot_minutes: 30 });
      await api.delete("/api/v1/partner/staff/123");

      for (const req of fakes.calls) {
        expect(req.headers["x-linkfit-app-key"]).toBe(APP_KEY);
      }
      expect(fakes.calls.map((c) => c.method)).toEqual(["PATCH", "PUT", "DELETE"]);
    } finally {
      fakes.restore();
    }
  });

  test("apiBlob (CSV export) carries the app key + auth headers", async () => {
    const fakes = installFakes({
      cookies: { lf_admin_access: "access-token-ccc" },
      responses: [{ status: 200, blob: "col1,col2\n1,2\n" }],
    });
    try {
      const blob = await apiBlob("/api/v1/partner/revenue/export.csv");
      const req = fakes.calls[0]!;
      expect(req.headers["x-linkfit-app-key"]).toBe(APP_KEY);
      expect(req.headers["authorization"]).toBe("Bearer access-token-ccc");
      expect(blob).toBeTruthy();
    } finally {
      fakes.restore();
    }
  });

  test("apiHeaders() (used by refresh + image upload) injects the app key", async () => {
    const h = apiHeaders({ "Content-Type": "application/json" }, "tok-xyz");
    expect(h.get("X-Linkfit-App-Key")).toBe(APP_KEY);
    expect(h.get("Authorization")).toBe("Bearer tok-xyz");
    expect(h.get("Accept")).toBe("application/json");
  });
});

test.describe("401 → refresh → retry keeps the app key (auth resilience)", () => {
  test("refreshes, retries, and both the refresh + retried calls carry the app key", async () => {
    const fakes = installFakes({
      cookies: {
        lf_admin_access: "stale-access",
        lf_admin_refresh: "refresh-token-1",
      },
      responses: [
        { status: 401, body: { error: { code: "token_expired" } } },
        {
          status: 200,
          body: {
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            access_token_expires_in_seconds: 3600,
          },
        },
        { status: 200, body: { ok: true } },
      ],
    });
    try {
      const result = await api.get<{ ok: boolean }>("/api/v1/partner/venue");
      expect(result).toEqual({ ok: true });

      expect(fakes.calls).toHaveLength(3);
      const [orig, refresh, retried] = fakes.calls as [
        CapturedRequest,
        CapturedRequest,
        CapturedRequest,
      ];

      expect(refresh.url).toContain("/api/v1/auth/refresh");
      expect(refresh.method).toBe("POST");
      expect(refresh.headers["x-linkfit-app-key"]).toBe(APP_KEY);

      expect(orig.headers["authorization"]).toBe("Bearer stale-access");
      expect(retried.headers["authorization"]).toBe("Bearer fresh-access");
      expect(retried.headers["x-linkfit-app-key"]).toBe(APP_KEY);
    } finally {
      fakes.restore();
    }
  });
});

test.describe("APIError shape", () => {
  test("non-2xx surfaces the backend error code + message", async () => {
    const fakes = installFakes({
      cookies: { lf_admin_access: "t" },
      responses: [
        {
          status: 409,
          body: { error: { code: "court_block_conflict", message: "Overlaps" } },
        },
      ],
    });
    try {
      let caught: unknown;
      try {
        await api.post("/api/v1/partner/blocks", {}, { skipRefresh: true });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(APIError);
      const err = caught as APIError;
      expect(err.status).toBe(409);
      expect(err.code).toBe("court_block_conflict");
      expect(err.message).toBe("Overlaps");
    } finally {
      fakes.restore();
    }
  });
});
