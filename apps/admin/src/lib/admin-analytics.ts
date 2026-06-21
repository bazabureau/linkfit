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
  growth: (days: number) => ["admin", "analytics", "growth", days] as const,
  clubs: ["admin", "analytics", "clubs"] as const,
  engagement: ["admin", "analytics", "engagement"] as const,
  funnel: ["admin", "analytics", "funnel"] as const,
};

export function useAnalyticsOverview(): UseQueryResult<AnalyticsOverview> {
  return useQuery({
    queryKey: analyticsKeys.overview,
    queryFn: () => api.get<AnalyticsOverview>("/api/v1/admin/analytics/overview"),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

// ─── Growth time series ──────────────────────────────────────────────────────

export interface GrowthCountPoint {
  date: string;
  count: number;
}

export interface GrowthRevenuePoint {
  date: string;
  amount_minor: number;
}

export interface GrowthResponse {
  days: number;
  new_users: GrowthCountPoint[];
  new_games: GrowthCountPoint[];
  new_bookings: GrowthCountPoint[];
  revenue: GrowthRevenuePoint[];
}

export function useGrowth(days = 30): UseQueryResult<GrowthResponse> {
  return useQuery({
    queryKey: analyticsKeys.growth(days),
    queryFn: () => api.get<GrowthResponse>(`/api/v1/admin/analytics/growth?days=${days}`),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

// ─── Clubs (venue performance) ───────────────────────────────────────────────

export interface ClubRow {
  id: string;
  name: string;
  status: string;
  courts: number;
  bookings: number;
  revenue_minor: number;
  paid_revenue_minor: number;
}

export interface ClubsResponse {
  currency: string;
  items: ClubRow[];
}

export function useClubs(): UseQueryResult<ClubsResponse> {
  return useQuery({
    queryKey: analyticsKeys.clubs,
    queryFn: () => api.get<ClubsResponse>("/api/v1/admin/analytics/clubs"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

// ─── Engagement ──────────────────────────────────────────────────────────────

export interface MatchTypeBreakdown {
  match_type: string;
  count: number;
}

export interface EngagementResponse {
  games_created_30d: number;
  game_joins_30d: number;
  lesson_bookings_30d: number;
  messages_30d: number;
  follows_30d: number;
  follows_total: number;
  avg_participants_per_game: number;
  by_match_type: MatchTypeBreakdown[];
}

export function useEngagement(): UseQueryResult<EngagementResponse> {
  return useQuery({
    queryKey: analyticsKeys.engagement,
    queryFn: () => api.get<EngagementResponse>("/api/v1/admin/analytics/engagement"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

// ─── Funnel ──────────────────────────────────────────────────────────────────

export interface FunnelResponse {
  registered: number;
  played_a_game: number;
  booked_a_court: number;
  came_via_referral: number;
}

export function useFunnel(): UseQueryResult<FunnelResponse> {
  return useQuery({
    queryKey: analyticsKeys.funnel,
    queryFn: () => api.get<FunnelResponse>("/api/v1/admin/analytics/funnel"),
    staleTime: 60_000,
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
