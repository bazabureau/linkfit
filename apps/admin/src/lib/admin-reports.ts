"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";

export type ReportStatus = "pending" | "reviewed" | "dismissed";
export type ReportTargetKind = "user" | "game" | "venue" | "message" | string;

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
  limit?: number;
  offset?: number;
};

export const REPORTS_KEY = (filter: ReportsFilter) =>
  ["admin", "reports", filter] as const;

export function useReports(filter: ReportsFilter) {
  return useQuery<ReportsResponse>({
    queryKey: REPORTS_KEY(filter),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filter.status && filter.status !== "all") {
        params.set("status", filter.status);
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
