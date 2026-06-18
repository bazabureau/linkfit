"use client";

import * as React from "react";
import { Label } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { GameStatus } from "@/lib/admin-games";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAGE_SIZE = 20;

export const GAME_STATUSES: Array<{ value: GameStatus; label: string }> = [
  { value: "open", label: "Açıq" },
  { value: "full", label: "Dolu" },
  { value: "completed", label: "Bitib" },
  { value: "cancelled", label: "Ləğv" },
];

export type SportFilter = "all" | "padel" | "tennis";

export const SPORT_OPTIONS: Array<{ value: SportFilter; label: string }> = [
  { value: "all", label: "Hamısı" },
  { value: "padel", label: "Padel" },
  { value: "tennis", label: "Tenis" },
];

export type DateFilter = "all" | "this_week" | "next_30" | "past_30";

export const DATE_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: "all", label: "Bütün tarixlər" },
  { value: "this_week", label: "Bu həftə" },
  { value: "next_30", label: "Növbəti 30 gün" },
  { value: "past_30", label: "Son 30 gün" },
];

export type ParticipantStatus = "confirmed" | "cancelled" | "no_show" | "played";

export const PARTICIPANT_STATUSES: Array<{ value: ParticipantStatus; label: string }> = [
  { value: "confirmed", label: "Təsdiqli" },
  { value: "played", label: "Oynayıb" },
  { value: "no_show", label: "Gəlmədi" },
  { value: "cancelled", label: "Ləğv" },
];

// ─── Status presentation ──────────────────────────────────────────────────────

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const STATUS_TONE: Record<GameStatus, Tone> = {
  open: "success",
  full: "info",
  completed: "neutral",
  cancelled: "danger",
};

/** Soft status pill — lime for open, blue for full, red for cancelled. */
export function statusPillClass(status: GameStatus): string {
  const tone = STATUS_TONE[status];
  if (tone === "success") return "bg-accent/15 text-[#3f6b00] ring-1 ring-inset ring-accent/40";
  if (tone === "warning") return "bg-warning/12 text-warning ring-1 ring-inset ring-warning/30";
  if (tone === "danger") return "bg-danger/10 text-danger ring-1 ring-inset ring-danger/25";
  if (tone === "info") return "bg-info/10 text-info ring-1 ring-inset ring-info/25";
  return "bg-surfaceElevated text-foregroundMuted ring-1 ring-inset ring-border";
}

/** Small leading dot colour for the pill. */
export function statusDotClass(status: GameStatus): string {
  const tone = STATUS_TONE[status];
  if (tone === "success") return "bg-accent";
  if (tone === "warning") return "bg-warning";
  if (tone === "danger") return "bg-danger";
  if (tone === "info") return "bg-info";
  return "bg-muted";
}

export function statusLabel(status: GameStatus): string {
  return GAME_STATUSES.find((item) => item.value === status)?.label ?? status;
}

const PARTICIPANT_TONE: Record<ParticipantStatus, Tone> = {
  confirmed: "success",
  played: "info",
  no_show: "warning",
  cancelled: "danger",
};

export function participantPillClass(status: ParticipantStatus): string {
  const tone = PARTICIPANT_TONE[status] ?? "neutral";
  if (tone === "success") return "bg-accent/15 text-[#3f6b00] ring-1 ring-inset ring-accent/40";
  if (tone === "warning") return "bg-warning/12 text-warning ring-1 ring-inset ring-warning/30";
  if (tone === "danger") return "bg-danger/10 text-danger ring-1 ring-inset ring-danger/25";
  if (tone === "info") return "bg-info/10 text-info ring-1 ring-inset ring-info/25";
  return "bg-surfaceElevated text-foregroundMuted ring-1 ring-inset ring-border";
}

export function participantLabel(status: ParticipantStatus): string {
  return PARTICIPANT_STATUSES.find((item) => item.value === status)?.label ?? status;
}

// ─── Game helpers ─────────────────────────────────────────────────────────────

export function sportLabel(slug: string): string {
  if (slug === "padel") return "Padel";
  if (slug === "tennis") return "Tenis";
  return slug.replace(/_/g, " ");
}

export function visibilityLabel(visibility: "public" | "invite"): string {
  return visibility === "public" ? "Public" : "Invite";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase() || "?";
}

export function isClosed(status: GameStatus): boolean {
  return status === "cancelled" || status === "completed";
}

export function canCancel(status: GameStatus): boolean {
  return status === "open" || status === "full";
}

export function canDelete(status: GameStatus): boolean {
  return status === "cancelled" || status === "completed";
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} dəq.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}s ${rest}dəq.` : `${hours} saat`;
}

/** Date-range presets used by the toolbar's quick filters. */
export function dateRangeFor(filter: DateFilter): { from?: string; to?: string } {
  const now = new Date();
  if (filter === "this_week") {
    const day = now.getDay();
    const diffToMon = (day + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMon);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { from: monday.toISOString(), to: sunday.toISOString() };
  }
  if (filter === "next_30") {
    const to = new Date(now);
    to.setDate(now.getDate() + 30);
    return { from: now.toISOString(), to: to.toISOString() };
  }
  if (filter === "past_30") {
    const from = new Date(now);
    from.setDate(now.getDate() - 30);
    return { from: from.toISOString(), to: now.toISOString() };
  }
  return {};
}

// ─── Shared primitives ────────────────────────────────────────────────────────

/** Sport-aware avatar — photo when available, monogram fallback otherwise. */
export function Avatar({
  name,
  photoUrl,
  size = 36,
  className,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
  className?: string;
}): React.JSX.Element {
  const dim = `${size}px`;
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={name}
        style={{ width: dim, height: dim }}
        className={cn("shrink-0 rounded-full border border-border object-cover", className)}
      />
    );
  }
  return (
    <span
      style={{ width: dim, height: dim }}
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-ink font-bold text-accent",
        className,
      )}
    >
      <span style={{ fontSize: Math.max(10, Math.round(size * 0.34)) }}>{initials(name)}</span>
    </span>
  );
}

/** Compact capacity meter — fill + count, info tint once the game is full. */
export function CapacityBar({
  confirmed,
  capacity,
  className,
}: {
  confirmed: number;
  capacity: number;
  className?: string;
}): React.JSX.Element {
  const pct = Math.min(100, Math.round((confirmed / Math.max(1, capacity)) * 100));
  const full = confirmed >= capacity;
  return (
    <div className={cn("inline-flex w-36 max-w-full flex-col items-end gap-1.5", className)}>
      <div className="font-display text-sm font-bold tabular-nums text-foreground">
        {confirmed}
        <span className="text-foregroundMuted">/{capacity}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surfaceElevated">
        <div
          className={cn("h-full rounded-full transition-all", full ? "bg-info" : "bg-accent")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

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
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 text-sm text-foreground outline-none transition focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
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
