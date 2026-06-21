"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "./api";

// ─── Analytics overview ─────────────────────────────────────────────────────

export interface AnalyticsOverview {
  currency: string;
  users: {
    total: number;
    new_30d: number;
    active_30d: number;
    vip: number;
    verified: number;
  };
  venues: { total: number; active: number };
  games: { total: number; new_30d: number };
  bookings: { total: number; new_30d: number; paid: number; cancelled: number };
  learn: { coaches: number; lessons: number; lesson_bookings: number };
  revenue: {
    gross_booking_minor: number;
    paid_booking_minor: number;
    gross_booking_30d_minor: number;
  };
}

export const analyticsKeys = {
  overview: ["admin", "analytics", "overview"] as const,
  revenue: (p: RevenueParams) => ["admin", "revenue", p] as const,
  deletions: ["admin", "data-rights", "deletions"] as const,
  exports: ["admin", "data-rights", "exports"] as const,
};

export function useAnalyticsOverview(): UseQueryResult<AnalyticsOverview> {
  return useQuery({
    queryKey: analyticsKeys.overview,
    queryFn: () => api.get<AnalyticsOverview>("/api/v1/admin/analytics/overview"),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

// ─── Revenue ────────────────────────────────────────────────────────────────

export interface RevenueRow {
  id: string;
  starts_at: string;
  duration_minutes: number;
  total_minor: number;
  currency: string;
  status: string;
  payment_method: string | null;
  court_name: string;
  venue_name: string;
}

export interface RevenueByVenue {
  venue_name: string;
  bookings_count: number;
  paid_total_minor: number;
}

export interface RevenueResponse {
  items: RevenueRow[];
  summary: {
    paid_total_minor: number;
    unpaid_total_minor: number;
    cancelled_total_minor: number;
    bookings_count: number;
  };
  by_venue: RevenueByVenue[];
}

export interface RevenueParams {
  from?: string;
  to?: string;
  venue_id?: string;
}

function qs(params: object): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export function useRevenue(params: RevenueParams = {}): UseQueryResult<RevenueResponse> {
  return useQuery({
    queryKey: analyticsKeys.revenue(params),
    queryFn: () => api.get<RevenueResponse>(`/api/v1/admin/revenue${qs(params)}`),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

// ─── Data rights ────────────────────────────────────────────────────────────

export interface DeletionRequest {
  user_id: string;
  requested_at: string;
  hard_delete_at: string;
  status: "scheduled" | "cancelled" | "completed";
  cancelled_at: string | null;
  completed_at: string | null;
}

export interface ExportRequest {
  id: string;
  user_id: string;
  status: "queued" | "processing" | "ready" | "failed";
  download_url: string | null;
  expires_at: string;
  created_at: string;
  completed_at: string | null;
}

export function useDeletionRequests(): UseQueryResult<DeletionRequest[]> {
  return useQuery({
    queryKey: analyticsKeys.deletions,
    queryFn: async () =>
      (await api.get<{ items: DeletionRequest[] }>("/api/v1/admin/data-rights/deletions"))
        .items ?? [],
    staleTime: 15_000,
  });
}

export function useExportRequests(): UseQueryResult<ExportRequest[]> {
  return useQuery({
    queryKey: analyticsKeys.exports,
    queryFn: async () =>
      (await api.get<{ items: ExportRequest[] }>("/api/v1/admin/data-rights/exports"))
        .items ?? [],
    staleTime: 15_000,
  });
}

export function useCancelDeletion(): UseMutationResult<void, Error, { userId: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId }) =>
      api.post<void>(`/api/v1/admin/data-rights/deletions/${userId}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.deletions }),
  });
}
