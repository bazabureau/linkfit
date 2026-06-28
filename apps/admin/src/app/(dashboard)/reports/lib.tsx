"use client";

import * as React from "react";
import {
  EyeOff,
  FileText,
  Gamepad2,
  Image as ImageIcon,
  MapPin,
  MessageSquare,
  Newspaper,
  Star,
  Timer,
  User,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useI18n } from "@/lib/i18n";
import type { AdminReport, ReportStatus, ReportTargetKind } from "@/lib/admin-reports";

export const PAGE_SIZE = 25;

// ─── Backend payload extras ─────────────────────────────────────────────────────

/**
 * User summary the backend embeds inside each report row. The Laravel
 * `ReportsController::reportPayload` always returns `reporter` (and `reviewed_by`
 * once a report is actioned), but the shared `AdminReport` type omits them.
 */
export interface ReportUserRef {
  id: string;
  display_name: string | null;
  email: string | null;
  photo_url: string | null;
  admin_role?: string | null;
}

/**
 * Report row as actually returned by `GET /admin/reports`. The extras are
 * optional, so a plain `AdminReport` remains assignable to this type — surfacing
 * the embedded `reporter` instead of a raw UUID without a shared-type change.
 */
export type AdminReportRow = AdminReport & {
  reporter?: ReportUserRef | null;
  reviewed_by?: ReportUserRef | null;
  reviewed_at?: string | null;
};

/** Human label for the reporter; falls back to a short UUID. */
export function reporterLabel(report: AdminReportRow): string {
  return (
    report.reporter?.display_name ||
    report.reporter?.email ||
    shortId(report.reporter_user_id)
  );
}

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
  story: "Story",
  feed_event: "Lent paylaşımı",
  feed_comment: "Şərh",
  venue_review: "Rəy",
  media: "Media",
};

export function targetLabel(kind: ReportTargetKind): string {
  return TARGET_LABEL_AZ[kind] ?? String(kind);
}

// ─── Reason presentation ──────────────────────────────────────────────────────

/**
 * Reasons arrive as fixed enum codes from the API
 * (spam|harassment|no_show|fake_profile|inappropriate_content|other). Map them
 * to readable labels; unknown codes fall back to the raw value.
 */
export const REPORT_REASON_AZ: Record<string, string> = {
  spam: "Spam",
  harassment: "Təcavüz / təhqir",
  no_show: "Gəlmədi (no-show)",
  fake_profile: "Saxta profil",
  inappropriate_content: "Yararsız məzmun",
  other: "Digər",
};

export function reasonLabel(reason: string): string {
  return REPORT_REASON_AZ[reason] ?? String(reason);
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
    case "feed_comment":
      return <MessageSquare className={className} />;
    case "feed_event":
      return <Newspaper className={className} />;
    case "venue_review":
      return <Star className={className} />;
    case "story":
    case "media":
      return <ImageIcon className={className} />;
    default:
      return <FileText className={className} />;
  }
}

export function targetHref(kind: string, id: string): string {
  switch (kind) {
    // NOTE: there is no `/users/[id]` detail route — the users page is a
    // list + drawer with no deep-linkable URL — so a `user` target must NOT
    // be rendered as a link (it would 404). Callers fall back to plain text.
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

// ─── SLA / takedown (Apple Guideline 1.2) ──────────────────────────────────────

/** Moderation SLA window: a pending report older than this is "overdue". */
export const SLA_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Age of a report in ms; `0` for an unparseable timestamp. */
export function reportAgeMs(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : Math.max(0, Date.now() - ms);
}

/** A report breaches the 24h SLA when it is still pending and >24h old. */
export function isReportOverdue(
  report: Pick<AdminReport, "status" | "created_at">,
): boolean {
  return (
    report.status === "pending" && reportAgeMs(report.created_at) > SLA_THRESHOLD_MS
  );
}

/** Whether the reported content is currently taken down / hidden. */
export function isTargetHidden(report: Pick<AdminReport, "target_hidden">): boolean {
  return report.target_hidden === true;
}

/** Red SLA-breach badge shown on overdue pending reports (>24h). */
export function OverdueBadge({
  className = "",
}: {
  className?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <span
      title={t("24 saatdan çox gözləyir")}
      className={`inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger ring-1 ring-inset ring-danger/30 ${className}`}
    >
      <Timer className="h-3 w-3" />
      {t("Gecikib")} · 24s+
    </span>
  );
}

/** Neutral badge marking content that is currently hidden (taken down). */
export function HiddenBadge({
  className = "",
}: {
  className?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <span
      title={t("Məzmun gizlədilib")}
      className={`inline-flex items-center gap-1 rounded-full bg-surfaceElevated px-2 py-0.5 text-[10px] font-semibold text-foregroundMuted ring-1 ring-inset ring-border ${className}`}
    >
      <EyeOff className="h-3 w-3" />
      {t("Gizlədilib")}
    </span>
  );
}
