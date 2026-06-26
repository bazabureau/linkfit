"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";

export type ReportStatus = "pending" | "reviewed" | "dismissed";

/**
 * Closed enums the backend `ReportsController` validates against
 * (`target_kind` / `reason`). Kept as `as const` tuples so the filter UI can map
 * over them while `ReportTargetKind` stays a widenable string for forward-compat
 * with any future kinds the API adds.
 */
export const REPORT_TARGET_KINDS = [
  "user",
  "game",
  "message",
  "story",
  "feed_event",
  "feed_comment",
  "venue_review",
  "media",
] as const;

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "no_show",
  "fake_profile",
  "inappropriate_content",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportTargetKind = (typeof REPORT_TARGET_KINDS)[number] | string;

export type AdminReport = {
  id: string;
  reporter_user_id: string;
  target_kind: ReportTargetKind;
  target_id: string;
  reason: string;
  status: ReportStatus;
  notes?: string | null;
  created_at: string;
};

export type ReportsResponse = {
  items: AdminReport[];
  total: number;
};

export type ReportsFilter = {
  status?: ReportStatus | "all";
  reason?: ReportReason | "all";
  target_kind?: ReportTargetKind | "all";
  q?: string;
  limit?: number;
  offset?: number;
};

export const REPORTS_KEY = (filter: ReportsFilter) =>
  ["admin", "reports", "list", filter] as const;

export function useReports(filter: ReportsFilter) {
  return useQuery<ReportsResponse>({
    queryKey: REPORTS_KEY(filter),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filter.status && filter.status !== "all") {
        params.set("status", filter.status);
      }
      if (filter.reason && filter.reason !== "all") {
        params.set("reason", filter.reason);
      }
      if (filter.target_kind && filter.target_kind !== "all") {
        params.set("target_kind", filter.target_kind);
      }
      if (filter.q && filter.q.trim()) {
        params.set("q", filter.q.trim());
      }
      params.set("limit", String(filter.limit ?? 25));
      params.set("offset", String(filter.offset ?? 0));
      return api.get<ReportsResponse>(
        `/api/v1/admin/reports?${params.toString()}`,
      );
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export type ReviewReportInput = {
  id: string;
  status: "reviewed" | "dismissed";
  notes?: string;
};

export function useReviewReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReviewReportInput) =>
      api.post<AdminReport>(`/api/v1/admin/reports/${input.id}/review`, {
        status: input.status,
        notes: input.notes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "reports"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
  });
}

// ─── Report detail (GET /admin/reports/{id}) ────────────────────────────────

/** A user reference embedded inside a target preview (host/author/owner/…). */
export type ReportTargetUserRef = {
  id: string;
  display_name: string | null;
  email: string | null;
};

/**
 * The `target` blob the backend resolves for a single report. Its shape varies
 * by `kind` (the `ReportsController::targetSummary` union), so every variant
 * field is optional — the drawer reads the ones relevant to each kind.
 */
export type ReportTargetSummary = {
  id: string;
  kind: string;
  status?: string | null;
  created_at?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
  notes?: string | null;
  body?: string | null;
  caption?: string | null;
  rating?: number | null;
  court_name?: string | null;
  conversation_id?: string | null;
  event_id?: string | null;
  type?: string | null;
  visibility?: string | null;
  url?: string | null;
  mime?: string | null;
  purpose?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  deleted_at?: string | null;
  // `user` target carries the userSummary shape inline:
  email?: string | null;
  display_name?: string | null;
  photo_url?: string | null;
  admin_role?: string | null;
  // nested actor references on the various kinds:
  host?: ReportTargetUserRef | null;
  sender?: ReportTargetUserRef | null;
  author?: ReportTargetUserRef | null;
  actor?: ReportTargetUserRef | null;
  owner?: ReportTargetUserRef | null;
  venue?: { id: string; name: string | null } | null;
};

export type ReportAuditEvent = {
  id: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  actor_email: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AdminReportDetail = AdminReport & {
  reporter?: ReportTargetUserRef & { photo_url?: string | null } | null;
  reviewed_by?: (ReportTargetUserRef & { photo_url?: string | null }) | null;
  reviewed_at?: string | null;
  target?: ReportTargetSummary | null;
  same_target_pending_count?: number;
  recent_same_target_reports?: AdminReport[];
  audit?: ReportAuditEvent[];
};

export function useReportDetail(id: string | null) {
  return useQuery<AdminReportDetail>({
    queryKey: ["admin", "reports", "detail", id],
    queryFn: () => api.get<AdminReportDetail>(`/api/v1/admin/reports/${id}`),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

// ─── Moderation user (GET /admin/moderation/users/{id}) ─────────────────────

/**
 * The moderation profile for a reported user. The backend spreads the raw user
 * row (minus secrets) plus aggregate counts, so the safe fields are typed and
 * the rest stays index-accessible.
 */
export type ModerationUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  photo_url: string | null;
  admin_role: string | null;
  deleted_at: string | null;
  suspended_at?: string | null;
  suspension_reason?: string | null;
  created_at?: string | null;
  games_played_total: number;
  games_hosted_total: number;
  reports_filed_count: number;
  reports_received_count: number;
  recent_reports_filed: AdminReport[];
  recent_reports_received: AdminReport[];
};

export function useModerationUser(id: string | null) {
  return useQuery<ModerationUser>({
    queryKey: ["admin", "moderation", "user", id],
    queryFn: () =>
      api.get<ModerationUser>(`/api/v1/admin/moderation/users/${id}`),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

/**
 * Soft-deactivate a reported user (POST /admin/moderation/users/{id}/deactivate).
 * Returns 204. The backend rejects self-deactivation (409) and lets only an
 * admin disable a staff account (403) — both surface as the mutation error.
 */
export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) =>
      api.post<void>(`/api/v1/admin/moderation/users/${id}/deactivate`, {}),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["admin", "reports"] });
      qc.invalidateQueries({ queryKey: ["admin", "moderation", "user", id] });
    },
  });
}
