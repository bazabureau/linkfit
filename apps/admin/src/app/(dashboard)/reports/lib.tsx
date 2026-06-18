"use client";

import * as React from "react";
import {
  FileText,
  Gamepad2,
  MapPin,
  MessageSquare,
  User,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ReportStatus, ReportTargetKind } from "@/lib/admin-reports";

export const PAGE_SIZE = 25;

// ─── Status presentation ──────────────────────────────────────────────────────

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const STATUS_TONE: Record<ReportStatus, Tone> = {
  pending: "warning",
  reviewed: "success",
  dismissed: "neutral",
};

/** Azerbaijani labels keyed by status (English source keys stay translatable). */
export const REPORT_STATUS_AZ: Record<ReportStatus, string> = {
  pending: "Gözləyir",
  reviewed: "Baxılıb",
  dismissed: "Rədd edilib",
};

export function statusPillClass(status: ReportStatus): string {
  const tone = STATUS_TONE[status] ?? "neutral";
  if (tone === "success") return "bg-accent/15 text-[#3f6b00] ring-1 ring-inset ring-accent/40";
  if (tone === "warning") return "bg-warning/12 text-warning ring-1 ring-inset ring-warning/30";
  if (tone === "danger") return "bg-danger/10 text-danger ring-1 ring-inset ring-danger/25";
  if (tone === "info") return "bg-info/10 text-info ring-1 ring-inset ring-info/25";
  return "bg-surfaceElevated text-foregroundMuted ring-1 ring-inset ring-border";
}

export function statusDotClass(status: ReportStatus): string {
  const tone = STATUS_TONE[status] ?? "neutral";
  if (tone === "success") return "bg-accent";
  if (tone === "warning") return "bg-warning";
  if (tone === "danger") return "bg-danger";
  if (tone === "info") return "bg-info";
  return "bg-muted";
}

// ─── Target presentation ──────────────────────────────────────────────────────

export const TARGET_LABEL_AZ: Record<string, string> = {
  user: "İstifadəçi",
  game: "Oyun",
  venue: "Məkan",
  message: "Mesaj",
};

export function targetLabel(kind: ReportTargetKind): string {
  return TARGET_LABEL_AZ[kind] ?? String(kind);
}

export function TargetIcon({
  kind,
  className = "h-4 w-4 text-foregroundMuted",
}: {
  kind: string;
  className?: string;
}): React.JSX.Element {
  switch (kind) {
    case "user":
      return <User className={className} />;
    case "game":
      return <Gamepad2 className={className} />;
    case "venue":
      return <MapPin className={className} />;
    case "message":
      return <MessageSquare className={className} />;
    default:
      return <FileText className={className} />;
  }
}

export function targetHref(kind: string, id: string): string {
  switch (kind) {
    case "user":
      return `/users/${id}`;
    case "game":
      return `/games/${id}`;
    case "venue":
      return `/venues/${id}`;
    default:
      return "#";
  }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function shortId(id: string): string {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

export function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}
