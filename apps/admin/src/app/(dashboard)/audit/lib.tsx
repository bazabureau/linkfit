"use client";

import { formatDistanceToNow } from "date-fns";
import { formatDateTime } from "@/lib/date-format";

/**
 * Entity types the backend records in `audit_log.entity`
 * (see AdminOpsController::auditWrite call sites).
 */
export const ENTITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All entities" },
  { value: "users", label: "Users" },
  { value: "bookings", label: "Bookings" },
  { value: "games", label: "Games" },
  { value: "venues", label: "Venues" },
  { value: "courts", label: "Courts" },
  { value: "court_blocks", label: "Court blocks" },
  { value: "tournaments", label: "Tournaments" },
  { value: "tournament_entries", label: "Tournament entries" },
  { value: "promo_codes", label: "Promo codes" },
  { value: "owner_applications", label: "Owner applications" },
  { value: "notifications", label: "Notifications" },
  { value: "conversations", label: "Conversations" },
  { value: "feed_comments", label: "Feed comments" },
  { value: "match_scores", label: "Match scores" },
  { value: "media_assets", label: "Media assets" },
  { value: "booking_waitlist_entries", label: "Waitlist" },
];

const ENTITY_LABELS: Record<string, string> = Object.fromEntries(
  ENTITY_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label]),
);

export function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity;
}

export type ActionTone = "success" | "warning" | "danger" | "info" | "neutral";

/** Classify a free-form action slug into a coloured tone. */
export function actionTone(action: string): ActionTone {
  const lower = action.toLowerCase();
  if (lower.includes("delete") || lower.includes("remove") || lower.includes("suspend"))
    return "danger";
  if (lower.includes("create") || lower.includes("add") || lower.includes("approve"))
    return "success";
  if (lower.includes("update") || lower.includes("edit") || lower.includes("restore"))
    return "info";
  if (lower.includes("review") || lower.includes("dismiss") || lower.includes("reject"))
    return "warning";
  return "neutral";
}

export function actionPillClass(tone: ActionTone): string {
  if (tone === "success") return "bg-accent/15 text-[#3f6b00] ring-1 ring-inset ring-accent/40";
  if (tone === "warning") return "bg-warning/12 text-warning ring-1 ring-inset ring-warning/30";
  if (tone === "danger") return "bg-danger/10 text-danger ring-1 ring-inset ring-danger/25";
  if (tone === "info") return "bg-info/10 text-info ring-1 ring-inset ring-info/25";
  return "bg-surfaceElevated text-foregroundMuted ring-1 ring-inset ring-border";
}

export function actionDotClass(tone: ActionTone): string {
  if (tone === "success") return "bg-accent";
  if (tone === "warning") return "bg-warning";
  if (tone === "danger") return "bg-danger";
  if (tone === "info") return "bg-info";
  return "bg-muted";
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase() || "?";
}

export function formatTimestamp(iso: string): string {
  return formatDateTime(iso);
}

export function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

/** Convert an `<input type="date">` value into an inclusive ISO range bound. */
export function toIso(date: string, end = false): string | undefined {
  if (!date) return undefined;
  return end ? `${date}T23:59:59.999Z` : `${date}T00:00:00.000Z`;
}
