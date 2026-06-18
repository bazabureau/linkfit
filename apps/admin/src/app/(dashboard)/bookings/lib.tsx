"use client";

import * as React from "react";
import { Label } from "@/components/ui/input";
import type { Booking, BookingStatus } from "@/lib/admin-queries";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAGE_SIZE = 25;

export const BOOKING_STATUSES: Array<{ value: BookingStatus; label: string }> = [
  { value: "pending_payment", label: "Ödəniş gözləyir" },
  { value: "partially_paid", label: "Qismən ödənib" },
  { value: "paid", label: "Ödənib" },
  { value: "cancelled", label: "Ləğv edilib" },
  { value: "refunded", label: "Refund edilib" },
  { value: "failed", label: "Uğursuz" },
];

export const PAYMENT_METHODS = [
  { value: "manual", label: "Manual" },
  { value: "cash", label: "Nağd" },
  { value: "bank_transfer", label: "Bank köçürməsi" },
  { value: "onsite", label: "Məkanda" },
] as const;

export const REFUND_STATUSES = [
  { value: "pending_manual_review", label: "Yoxlama gözləyir" },
  { value: "approved", label: "Təsdiqlənib" },
  { value: "processed", label: "İcra olunub" },
  { value: "rejected", label: "Rədd edilib" },
  { value: "not_required", label: "Lazım deyil" },
] as const;

// ─── Status presentation ──────────────────────────────────────────────────────

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const STATUS_TONE: Record<BookingStatus, Tone> = {
  paid: "success",
  pending_payment: "warning",
  partially_paid: "warning",
  cancelled: "danger",
  refunded: "danger",
  failed: "danger",
};

/** Solid status pill — lime for paid, amber for pending, red for closed. */
export function statusPillClass(status: BookingStatus): string {
  const tone = STATUS_TONE[status];
  if (tone === "success") return "bg-accent/15 text-[#3f6b00] ring-1 ring-inset ring-accent/40";
  if (tone === "warning") return "bg-warning/12 text-warning ring-1 ring-inset ring-warning/30";
  if (tone === "danger") return "bg-danger/10 text-danger ring-1 ring-inset ring-danger/25";
  if (tone === "info") return "bg-info/10 text-info ring-1 ring-inset ring-info/25";
  return "bg-surfaceElevated text-foregroundMuted ring-1 ring-inset ring-border";
}

/** Small leading dot colour for the pill. */
export function statusDotClass(status: BookingStatus): string {
  const tone = STATUS_TONE[status];
  if (tone === "success") return "bg-accent";
  if (tone === "warning") return "bg-warning";
  if (tone === "danger") return "bg-danger";
  if (tone === "info") return "bg-info";
  return "bg-muted";
}

export function statusLabel(status: BookingStatus): string {
  return BOOKING_STATUSES.find((item) => item.value === status)?.label ?? status;
}

export function paymentMethodLabel(method: Booking["payment_method"]): string {
  return (
    PAYMENT_METHODS.find((item) => item.value === method)?.label ?? "Qeyd yoxdur"
  );
}

// ─── Booking helpers ──────────────────────────────────────────────────────────

export function customerName(booking: Booking): string {
  return booking.customer_name || booking.booker_display_name || "Adsız müştəri";
}

export function customerEmail(booking: Booking): string {
  return booking.customer_email || booking.booker_email || "Email yoxdur";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase() || "?";
}

export function isClosed(status: BookingStatus): boolean {
  return status === "cancelled" || status === "refunded" || status === "failed";
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function money(minor: number | null | undefined, currency = "AZN"): string {
  return `${((minor ?? 0) / 100).toFixed(2)} ${currency || "AZN"}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} dəq.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}s ${rest}dəq.` : `${hours} saat`;
}

// ─── Date <-> input conversions ───────────────────────────────────────────────

export function dateInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00`).toISOString();
}

export function dateTimeLocalToIso(value: string): string {
  return new Date(value).toISOString();
}

export function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ─── Shared primitives ────────────────────────────────────────────────────────

export function SelectBox({
  value,
  onChange,
  children,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <select
      value={value}
      disabled={disabled}
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
      {hint ? <span className="block text-xs text-foregroundMuted">{hint}</span> : null}
    </Label>
  );
}
