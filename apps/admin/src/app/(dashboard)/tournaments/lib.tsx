"use client";

import * as React from "react";
import { Label } from "@/components/ui/input";
import {
  TOURNAMENT_STATUS_LABEL,
  type TournamentEntryStatus,
  type TournamentStatus,
} from "@/lib/admin-tournaments";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAGE_LIMIT = 25;

/** Display order + Azerbaijani labels for the status filter chips. */
export const TOURNAMENT_STATUS_FILTERS: Array<{
  value: TournamentStatus;
  label: string;
}> = [
  { value: "announced", label: "Elan edilib" },
  { value: "registration_open", label: "Qeydiyyat açıq" },
  { value: "registration_closed", label: "Qeydiyyat bağlı" },
  { value: "in_progress", label: "Davam edir" },
  { value: "completed", label: "Tamamlanıb" },
  { value: "cancelled", label: "Ləğv edilib" },
];

/** Azerbaijani labels keyed by backend status (English keys stay translatable). */
export const TOURNAMENT_STATUS_AZ: Record<TournamentStatus, string> = {
  announced: "Elan edilib",
  registration_open: "Qeydiyyat açıq",
  registration_closed: "Qeydiyyat bağlı",
  in_progress: "Davam edir",
  completed: "Tamamlanıb",
  cancelled: "Ləğv edilib",
};

export const ENTRY_STATUS_AZ: Record<TournamentEntryStatus, string> = {
  pending: "Gözləyir",
  confirmed: "Təsdiqlənib",
  withdrawn: "Geri çəkilib",
  disqualified: "Diskvalifikasiya",
};

// ─── Status presentation ──────────────────────────────────────────────────────

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const STATUS_TONE: Record<TournamentStatus, Tone> = {
  announced: "neutral",
  registration_open: "success",
  registration_closed: "warning",
  in_progress: "info",
  completed: "neutral",
  cancelled: "danger",
};

const ENTRY_TONE: Record<TournamentEntryStatus, Tone> = {
  confirmed: "success",
  pending: "warning",
  disqualified: "danger",
  withdrawn: "neutral",
};

function toneToPill(tone: Tone): string {
  if (tone === "success") return "bg-accent/15 text-[#3f6b00] ring-1 ring-inset ring-accent/40";
  if (tone === "warning") return "bg-warning/12 text-warning ring-1 ring-inset ring-warning/30";
  if (tone === "danger") return "bg-danger/10 text-danger ring-1 ring-inset ring-danger/25";
  if (tone === "info") return "bg-info/10 text-info ring-1 ring-inset ring-info/25";
  return "bg-surfaceElevated text-foregroundMuted ring-1 ring-inset ring-border";
}

function toneToDot(tone: Tone): string {
  if (tone === "success") return "bg-accent";
  if (tone === "warning") return "bg-warning";
  if (tone === "danger") return "bg-danger";
  if (tone === "info") return "bg-info";
  return "bg-muted";
}

export function statusPillClass(status: TournamentStatus): string {
  return toneToPill(STATUS_TONE[status]);
}

export function statusDotClass(status: TournamentStatus): string {
  return toneToDot(STATUS_TONE[status]);
}

export function entryPillClass(status: TournamentEntryStatus): string {
  return toneToPill(ENTRY_TONE[status]);
}

export function entryDotClass(status: TournamentEntryStatus): string {
  return toneToDot(ENTRY_TONE[status]);
}

/** Status label that prefers the i18n source key (English) for translation. */
export function statusLabel(status: TournamentStatus): string {
  return TOURNAMENT_STATUS_LABEL[status] ?? status;
}

// ─── Tournament helpers ───────────────────────────────────────────────────────

export function isTerminalStatus(status: TournamentStatus): boolean {
  return status === "completed" || status === "cancelled";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase() || "?";
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
  error,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string;
}): React.JSX.Element {
  return (
    <Label className="space-y-2">
      <span className="block text-xs font-semibold   text-foregroundMuted">
        {label}
      </span>
      {children}
      {error ? (
        <span className="block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-foregroundMuted">{hint}</span>
      ) : null}
    </Label>
  );
}
