import { expect, test } from "@playwright/test";
import {
  getBookerEmail,
  getBookerName,
  initialsOf,
  isDoublesBooking,
  statusMeta,
} from "../src/app/(dashboard)/bookings/booking-utils";
import type { Booking, BookingStatus } from "../src/lib/partner-queries";

/**
 * Pure unit tests for booking presentation logic — no browser, no server.
 * Guards the walk-in customer name/email fallbacks and the status mapping the
 * bookings table + drawer depend on.
 */

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "b1",
    game_id: null,
    court_id: "c1",
    court_name: "Court A",
    user_id: "u1",
    booker_display_name: "App User",
    booker_email: "app.user@example.com",
    venue_id: "v1",
    venue_name: "Padel Center Baku",
    starts_at: "2026-06-21T10:00:00Z",
    duration_minutes: 60,
    total_minor: 5000,
    currency: "AZN",
    status: "paid",
    idempotency_key: "k1",
    external_ref: null,
    created_at: "2026-06-20T10:00:00Z",
    paid_at: "2026-06-20T11:00:00Z",
    cancelled_at: null,
    ...overrides,
  };
}

test.describe("getBookerName / getBookerEmail (walk-in fallbacks)", () => {
  test("prefers customer_name over the joined account display name", () => {
    const b = makeBooking({ customer_name: "Walk In Guest" });
    expect(getBookerName(b)).toBe("Walk In Guest");
  });

  test("falls back to booker_display_name when customer_name is empty", () => {
    const b = makeBooking({ customer_name: "   " });
    expect(getBookerName(b)).toBe("App User");
  });

  test("strips the doubles/singles tags from the displayed name", () => {
    const b = makeBooking({ customer_name: "Kamran [Cütlü / Doubles]" });
    expect(getBookerName(b)).toBe("Kamran");
  });

  test("returns an em-dash when nothing usable is present", () => {
    const b = makeBooking({
      customer_name: null,
      booker_display_name: "",
    });
    expect(getBookerName(b)).toBe("—");
  });

  test("prefers customer_email over booker_email", () => {
    const b = makeBooking({ customer_email: "walkin@guest.az" });
    expect(getBookerEmail(b)).toBe("walkin@guest.az");
  });

  test("falls back to booker_email when no customer_email", () => {
    const b = makeBooking({ customer_email: null });
    expect(getBookerEmail(b)).toBe("app.user@example.com");
  });
});

test.describe("isDoublesBooking", () => {
  test("detects the Doubles tag", () => {
    expect(isDoublesBooking(makeBooking({ customer_name: "X [Cütlü / Doubles]" }))).toBe(true);
  });

  test("treats untagged bookings as singles", () => {
    expect(isDoublesBooking(makeBooking({ customer_name: "Plain Name" }))).toBe(false);
  });
});

test.describe("initialsOf", () => {
  test("uses first + last initials", () => {
    expect(initialsOf("Kamran Namazov")).toBe("KN");
  });
  test("single word → first two letters uppercased", () => {
    expect(initialsOf("madrid")).toBe("M");
  });
  test("empty → em-dash", () => {
    expect(initialsOf("   ")).toBe("—");
  });
});

test.describe("statusMeta", () => {
  const statuses: BookingStatus[] = [
    "paid",
    "pending_payment",
    "partially_paid",
    "cancelled",
    "refunded",
    "failed",
  ];
  for (const s of statuses) {
    test(`maps "${s}" to a non-empty Azerbaijani label`, () => {
      const meta = statusMeta(s);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.pill).toContain("border");
    });
  }

  test("paid status reads 'Ödənilib'", () => {
    expect(statusMeta("paid").label).toBe("Ödənilib");
  });

  test("unknown status falls back to the 'failed' meta", () => {
    expect(statusMeta("bogus" as BookingStatus)).toEqual(statusMeta("failed"));
  });
});
