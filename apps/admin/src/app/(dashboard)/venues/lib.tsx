"use client";

import * as React from "react";
import { Label } from "@/components/ui/input";
import type { Court, Venue } from "@/lib/admin-venues";
import type { Booking, BookingStatus } from "@/lib/admin-queries";

// ─── Venue status presentation ──────────────────────────────────────────────

export type VenueStatus = NonNullable<Venue["status"]>;

export const VENUE_STATUSES: Array<{ value: VenueStatus; label: string }> = [
  { value: "published", label: "Published" },
  { value: "pending", label: "Pending" },
  { value: "draft", label: "Draft" },
  { value: "suspended", label: "Suspended" },
];

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const VENUE_STATUS_TONE: Record<VenueStatus, Tone> = {
  published: "success",
  pending: "warning",
  draft: "neutral",
  suspended: "danger",
};

export function venueStatus(venue: Pick<Venue, "status">): VenueStatus {
  return venue.status ?? "published";
}

export function venueStatusLabel(status: VenueStatus): string {
  return VENUE_STATUSES.find((item) => item.value === status)?.label ?? status;
}

/** Solid status pill — lime for published, amber for pending, red for suspended. */
export function venueStatusPillClass(status: VenueStatus): string {
  const tone = VENUE_STATUS_TONE[status];
  if (tone === "success") return "bg-accent/15 text-[#3f6b00] ring-1 ring-inset ring-accent/40";
  if (tone === "warning") return "bg-warning/12 text-warning ring-1 ring-inset ring-warning/30";
  if (tone === "danger") return "bg-danger/10 text-danger ring-1 ring-inset ring-danger/25";
  if (tone === "info") return "bg-info/10 text-info ring-1 ring-inset ring-info/25";
  return "bg-surfaceElevated text-foregroundMuted ring-1 ring-inset ring-border";
}

export function venueStatusDotClass(status: VenueStatus): string {
  const tone = VENUE_STATUS_TONE[status];
  if (tone === "success") return "bg-accent";
  if (tone === "warning") return "bg-warning";
  if (tone === "danger") return "bg-danger";
  if (tone === "info") return "bg-info";
  return "bg-muted";
}

// ─── Court status presentation ──────────────────────────────────────────────

export type CourtStatus = NonNullable<Court["status"]>;

const COURT_STATUS_TONE: Record<CourtStatus, Tone> = {
  active: "success",
  maintenance: "warning",
  inactive: "neutral",
};

export function courtStatus(court: Pick<Court, "status">): CourtStatus {
  return court.status ?? "active";
}

export function courtStatusLabel(status: CourtStatus): string {
  if (status === "active") return "Aktiv";
  if (status === "maintenance") return "Maintenance";
  return "Passiv";
}

export function courtStatusPillClass(status: CourtStatus): string {
  const tone = COURT_STATUS_TONE[status];
  if (tone === "success") return "bg-accent/15 text-[#3f6b00] ring-1 ring-inset ring-accent/40";
  if (tone === "warning") return "bg-warning/12 text-warning ring-1 ring-inset ring-warning/30";
  return "bg-surfaceElevated text-foregroundMuted ring-1 ring-inset ring-border";
}

export function courtStatusDotClass(status: CourtStatus): string {
  const tone = COURT_STATUS_TONE[status];
  if (tone === "success") return "bg-accent";
  if (tone === "warning") return "bg-warning";
  return "bg-muted";
}

// ─── Booking status presentation (per-venue bookings tab) ────────────────────

const BOOKING_STATUS_TONE: Record<BookingStatus, Tone> = {
  paid: "success",
  pending_payment: "warning",
  partially_paid: "warning",
  cancelled: "danger",
  refunded: "danger",
  failed: "danger",
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending_payment: "Ödəniş gözləyir",
  partially_paid: "Qismən ödənib",
  paid: "Ödənib",
  cancelled: "Ləğv edilib",
  refunded: "Refund edilib",
  failed: "Uğursuz",
};

export function bookingStatusLabel(status: BookingStatus): string {
  return BOOKING_STATUS_LABELS[status] ?? status;
}

export function bookingStatusPillClass(status: BookingStatus): string {
  const tone = BOOKING_STATUS_TONE[status];
  if (tone === "success") return "bg-accent/15 text-[#3f6b00] ring-1 ring-inset ring-accent/40";
  if (tone === "warning") return "bg-warning/12 text-warning ring-1 ring-inset ring-warning/30";
  if (tone === "danger") return "bg-danger/10 text-danger ring-1 ring-inset ring-danger/25";
  return "bg-surfaceElevated text-foregroundMuted ring-1 ring-inset ring-border";
}

export function bookingStatusDotClass(status: BookingStatus): string {
  const tone = BOOKING_STATUS_TONE[status];
  if (tone === "success") return "bg-accent";
  if (tone === "warning") return "bg-warning";
  if (tone === "danger") return "bg-danger";
  return "bg-muted";
}

export function isBookingClosed(status: BookingStatus): boolean {
  return status === "cancelled" || status === "refunded" || status === "failed";
}

export function bookerName(booking: Booking): string {
  return booking.booker_display_name || booking.customer_name || "Adsız müştəri";
}

export function bookerEmail(booking: Booking): string {
  return booking.booker_email || booking.customer_email || "Email yoxdur";
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function money(minor: number | null | undefined, currency = "AZN"): string {
  return `${((minor ?? 0) / 100).toFixed(2)} ${currency || "AZN"}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} dəq.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}s ${rest}dəq.` : `${hours} saat`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase() || "?";
}

export const SPORT_EMOJI: Record<string, string> = {
  padel: "🥎",
  tennis: "🎾",
};

export function sportEmoji(slug: string | null | undefined): string {
  return SPORT_EMOJI[slug ?? ""] ?? "🏟️";
}

// ─── Shared primitives ──────────────────────────────────────────────────────

export function SelectBox({
  value,
  onChange,
  children,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}): React.JSX.Element {
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className={`h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 text-sm text-foreground outline-none transition focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}): React.JSX.Element {
  return (
    <Label className="space-y-2">
      <span className="block text-xs font-semibold   text-foregroundMuted">
        {label}
      </span>
      {children}
      {hint ? <span className="block text-xs font-normal text-foregroundMuted">{hint}</span> : null}
    </Label>
  );
}
