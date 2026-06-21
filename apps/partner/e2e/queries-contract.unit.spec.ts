import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Contract/regression tests for the partner-queries data layer.
 *
 * The query hooks are React hooks ("use client") and can't be invoked outside a
 * component, so we (1) re-implement the exact pure transforms the queryFns use
 * and assert their behaviour, and (2) assert the source still wires those
 * transforms — guarding the specific P1/P2 fixes:
 *   • usePartnerBookings: derive count from results.length, send only from/to.
 *   • usePartnerCourts / blocks / staff / sports: unwrap the {items:[]} envelope.
 *
 * Playwright runs specs from the project root, so paths are resolved off cwd.
 */

const QUERIES_SRC = readFileSync(
  join(process.cwd(), "src/lib/partner-queries.ts"),
  "utf8",
);

// ─── Transforms mirrored from the queryFn bodies ──────────────────────────────

function unwrapItems<T>(res: { items?: T[] } | null | undefined): T[] {
  return res?.items ?? [];
}

function toBookingsPage<T>(res: { items?: T[] }): { results: T[]; count: number } {
  const results = res.items ?? [];
  return { results, count: results.length };
}

function buildBookingsQS(params: { from?: string; to?: string }): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

test.describe("bookings page transform (P1)", () => {
  test("count is derived from the number of rows, not a server total", () => {
    const page = toBookingsPage({ items: [{ id: "1" }, { id: "2" }, { id: "3" }] });
    expect(page.count).toBe(3);
    expect(page.results).toHaveLength(3);
  });

  test("empty / missing items → empty results, zero count", () => {
    expect(toBookingsPage({})).toEqual({ results: [], count: 0 });
    expect(toBookingsPage({ items: [] })).toEqual({ results: [], count: 0 });
  });

  test("only from/to make it into the query string", () => {
    expect(buildBookingsQS({ from: "2026-06-01", to: "2026-06-30" })).toBe(
      "?from=2026-06-01&to=2026-06-30",
    );
    expect(buildBookingsQS({})).toBe("");
    expect(buildBookingsQS({ from: "2026-06-01" })).toBe("?from=2026-06-01");
  });
});

test.describe("envelope unwrapping (P2)", () => {
  test("{items:[...]} → the inner array", () => {
    expect(unwrapItems({ items: [1, 2] })).toEqual([1, 2]);
  });
  test("missing / null envelope → []", () => {
    expect(unwrapItems({})).toEqual([]);
    expect(unwrapItems(null)).toEqual([]);
    expect(unwrapItems(undefined)).toEqual([]);
  });
});

// ─── Source-level regression guards ───────────────────────────────────────────

test.describe("source wiring is preserved", () => {
  test("usePartnerBookings derives count from results.length", () => {
    expect(QUERIES_SRC).toContain("count: results.length");
  });

  test("usePartnerBookings only sends from/to (dead params removed)", () => {
    // The query-string builder inside the bookings queryFn must reference only
    // from/to — the old status/court_id/q/limit/offset keys are gone.
    const bookingsFn = QUERIES_SRC.slice(
      QUERIES_SRC.indexOf("export function usePartnerBookings"),
      QUERIES_SRC.indexOf("export function useCancelPartnerBooking"),
    );
    expect(bookingsFn).toContain("from: params.from");
    expect(bookingsFn).toContain("to: params.to");
    expect(bookingsFn).not.toContain("status: params.status");
    expect(bookingsFn).not.toContain("limit: params.limit");
    expect(bookingsFn).not.toContain("offset: params.offset");
  });

  test("usePartnerCourts unwraps the items envelope", () => {
    const courtsFn = QUERIES_SRC.slice(
      QUERIES_SRC.indexOf("export function usePartnerCourts"),
      QUERIES_SRC.indexOf("export function useCreatePartnerCourt"),
    );
    expect(courtsFn).toContain("res.items ?? []");
  });

  test("the new venue-ops booking actions hit the real POST endpoints", () => {
    expect(QUERIES_SRC).toContain("/check-in`");
    expect(QUERIES_SRC).toContain("/undo-check-in`");
    expect(QUERIES_SRC).toContain("/no-show`");
    expect(QUERIES_SRC).toContain("/clear-no-show`");
    expect(QUERIES_SRC).toContain("/refund`");
  });

  test("staff / blocks / rules / account hooks target their partner endpoints", () => {
    expect(QUERIES_SRC).toContain('"/api/v1/partner/staff"');
    expect(QUERIES_SRC).toContain('"/api/v1/partner/blocks"');
    expect(QUERIES_SRC).toContain('"/api/v1/partner/rules"');
    expect(QUERIES_SRC).toContain('"/api/v1/partner/account"');
  });

  test("refund payload only includes provided fields", () => {
    // RefundPartnerBooking spreads each field conditionally so undefined keys
    // are never sent to the backend.
    expect(QUERIES_SRC).toContain("refund_status !== undefined");
    expect(QUERIES_SRC).toContain("refund_amount_minor !== undefined");
    expect(QUERIES_SRC).toContain("refund_note !== undefined");
  });
});
