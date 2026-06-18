"use client";

import React from "react";
import type { Booking, BookingStatus } from "@/lib/partner-queries";

// ─── Booker name / email normalisation ───────────────────────────────────────
// Walk-in bookings are recorded against the partner's own account, so the
// backend stores the real customer under `customer_name` / `customer_email`.
// Fall back to the joined user's display name for app-originated bookings.

export function getBookerName(b: Booking): string {
  const raw =
    (b as { customer_name?: string | null }).customer_name?.trim() ||
    b.booker_display_name ||
    "—";
  return raw
    .replace(/\[Cütlü \/ Doubles\]/g, "")
    .replace(/\[Təkli \/ Singles\]/g, "")
    .replace(/\[Doubles\]/g, "")
    .replace(/\[Singles\]/g, "")
    .trim();
}

export function getBookerEmail(b: Booking): string {
  return (
    (b as { customer_email?: string | null }).customer_email?.trim() ||
    b.booker_email ||
    ""
  );
}

export function isDoublesBooking(b: Booking): boolean {
  const raw = `${(b as { customer_name?: string | null }).customer_name ?? ""} ${
    b.booker_display_name ?? ""
  }`;
  // Walk-ins are tagged "[Cütlü / Doubles]" / "[Təkli / Singles]" — match the
  // actual stored substring (the old "[Doubles]"/"[Cütlü]" never occurs).
  return raw.includes("Doubles") || raw.includes("Cütlü");
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + second).toUpperCase() || "—";
}

// ─── Status visual mapping ────────────────────────────────────────────────────
// One source of truth for every status: Azerbaijani label, a leading dot colour,
// pill classes (tinted background + text on the dark canvas) and a soft tone.

export interface StatusMeta {
  label: string;
  /** Leading dot / accent colour (raw hex for arbitrary classes). */
  dot: string;
  /** Pill classes — tinted surface + matching text, dark-canvas safe. */
  pill: string;
  /** Soft tint used for left rails / calendar cards. */
  soft: string;
  text: string;
}

const STATUS_MAP: Record<BookingStatus, StatusMeta> = {
  paid: {
    label: "Ödənilib",
    dot: "bg-accent",
    pill: "border-accent/30 bg-accent/10 text-accent",
    soft: "bg-accent/[0.07] border-accent/25",
    text: "text-accent",
  },
  pending_payment: {
    label: "Ödəniş Gözləyir",
    dot: "bg-warning",
    pill: "border-warning/30 bg-warning/10 text-warning",
    soft: "bg-warning/[0.07] border-warning/25",
    text: "text-warning",
  },
  partially_paid: {
    label: "Qismən Ödənilib",
    dot: "bg-warning",
    pill: "border-warning/30 bg-warning/10 text-warning",
    soft: "bg-warning/[0.07] border-warning/25",
    text: "text-warning",
  },
  cancelled: {
    label: "Ləğv edilib",
    dot: "bg-danger",
    pill: "border-danger/30 bg-danger/10 text-danger",
    soft: "bg-danger/[0.06] border-danger/20",
    text: "text-danger",
  },
  refunded: {
    label: "Geri qaytarılıb",
    dot: "bg-info",
    pill: "border-info/30 bg-info/10 text-info",
    soft: "bg-info/[0.06] border-info/20",
    text: "text-info",
  },
  failed: {
    label: "Uğursuz",
    dot: "bg-danger",
    pill: "border-danger/30 bg-danger/10 text-danger",
    soft: "bg-danger/[0.06] border-danger/20",
    text: "text-danger",
  },
};

export function statusMeta(status: BookingStatus): StatusMeta {
  return STATUS_MAP[status] ?? STATUS_MAP.failed;
}

// Compact pill with a leading status dot — the scannable table marker.
export function StatusPill({
  status,
  className = "",
}: {
  status: BookingStatus;
  className?: string;
}): React.JSX.Element {
  const meta = statusMeta(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none ${meta.pill} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
      {meta.label}
    </span>
  );
}

export function money(minor: number, currency = "AZN"): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}
