"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api, apiFetch } from "./api";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Venue {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  description: string | null;
  photo_url: string | null;
  created_at: string;
}

export interface Court {
  id: string;
  venue_id: string;
  sport_id: string;
  sport_slug: string;
  name: string;
  hourly_price_minor: number;
  currency: string;
  created_at: string;
}

export type BookingStatus =
  | "pending_payment"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "refunded"
  | "failed";

export interface Booking {
  id: string;
  game_id: string | null;
  court_id: string;
  court_name: string;
  user_id: string;
  booker_display_name: string;
  booker_email: string;
  venue_id: string;
  venue_name: string;
  starts_at: string;
  duration_minutes: number;
  total_minor: number;
  currency: string;
  status: BookingStatus;
  idempotency_key: string;
  external_ref: string | null;
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
}

export interface Paginated<T> {
  results: T[];
  count: number;
}

export interface PartnerBookingsParams {
  status?: BookingStatus;
  court_id?: string;
  q?: string;
  from?: string; // ISO date
  to?: string; // ISO date
  limit?: number;
  offset?: number;
}

export interface PartnerStats {
  total_bookings: number;
  paid_bookings: number;
  pending_bookings: number;
  cancelled_bookings: number;
  total_revenue_minor: number;
  currency: string;
  occupancy_rate: number;
}

export interface SportOption {
  id: string;
  name: string;
  slug: string;
}

// ─── Query keys ─────────────────────────────────────────────────────────────

export const partnerKeys = {
  venue: ["partner", "venue"] as const,
  courts: ["partner", "courts"] as const,
  bookings: (params: PartnerBookingsParams) => ["partner", "bookings", params] as const,
  bookingsAll: ["partner", "bookings"] as const,
  stats: ["partner", "stats"] as const,
  sports: ["partner", "sports"] as const,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildQS(params: Record<string, string | number | undefined | null>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

// ─── Venue Profile ──────────────────────────────────────────────────────────

export function usePartnerVenue(): UseQueryResult<Venue> {
  return useQuery({
    queryKey: partnerKeys.venue,
    queryFn: async () => {
      return api.get<Venue>("/api/v1/partner/venue");
    },
    staleTime: 30_000,
  });
}

export function useUpdatePartnerVenue(): UseMutationResult<
  Venue,
  Error,
  Partial<Omit<Venue, "id" | "created_at">>
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data) => {
      return api.put<Venue>("/api/v1/partner/venue", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.venue });
    },
  });
}

// ─── Courts Management ──────────────────────────────────────────────────────

export function usePartnerCourts(): UseQueryResult<Court[]> {
  return useQuery({
    queryKey: partnerKeys.courts,
    queryFn: async () => {
      return api.get<Court[]>("/api/v1/partner/courts");
    },
    staleTime: 30_000,
  });
}

export function useCreatePartnerCourt(): UseMutationResult<
  Court,
  Error,
  Omit<Court, "id" | "venue_id" | "sport_slug" | "created_at">
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      return api.post<Court>("/api/v1/partner/courts", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.courts });
      qc.invalidateQueries({ queryKey: partnerKeys.stats });
    },
  });
}

export function useUpdatePartnerCourt(): UseMutationResult<
  Court,
  Error,
  { id: string; data: Partial<Omit<Court, "id" | "venue_id" | "sport_slug" | "created_at">> }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }) => {
      return api.put<Court>(`/api/v1/partner/courts/${id}`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.courts });
    },
  });
}

export function useDeletePartnerCourt(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      await api.delete<void>(`/api/v1/partner/courts/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.courts });
      qc.invalidateQueries({ queryKey: partnerKeys.stats });
    },
  });
}

// ─── Bookings / Reservations ─────────────────────────────────────────────────

export function usePartnerBookings(params: PartnerBookingsParams) {
  return useQuery({
    queryKey: partnerKeys.bookings(params),
    queryFn: async () => {
      const qs = buildQS({
        status: params.status,
        court_id: params.court_id,
        q: params.q,
        from: params.from,
        to: params.to,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      });
      const res = await api.get<{ items: Booking[]; total: number }>(
        `/api/v1/partner/bookings${qs}`,
      );
      return {
        results: res.items ?? [],
        count: res.total ?? 0,
      };
    },
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useCancelPartnerBooking(
  options?: UseMutationOptions<
    void,
    Error,
    { id: string },
    { snapshots: Array<[readonly unknown[], Paginated<Booking> | undefined]> }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post<void>(`/api/v1/partner/bookings/${id}/cancel`, {}),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: partnerKeys.bookingsAll });
      const snapshots = qc.getQueriesData<Paginated<Booking>>({
        queryKey: partnerKeys.bookingsAll,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<Paginated<Booking>>(key, {
          ...data,
          results: data.results.map((b) =>
            b.id === id ? { ...b, status: "cancelled" as BookingStatus } : b,
          ),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      const snapshots = ctx?.snapshots;
      if (snapshots) {
        for (const [key, data] of snapshots) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      qc.invalidateQueries({ queryKey: partnerKeys.stats });
    },
    ...options,
  });
}

export function useMarkPartnerBookingPaid(
  options?: UseMutationOptions<
    void,
    Error,
    { id: string },
    { snapshots: Array<[readonly unknown[], Paginated<Booking> | undefined]> }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post<void>(`/api/v1/partner/bookings/${id}/mark-paid`, {}),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: partnerKeys.bookingsAll });
      const snapshots = qc.getQueriesData<Paginated<Booking>>({
        queryKey: partnerKeys.bookingsAll,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<Paginated<Booking>>(key, {
          ...data,
          results: data.results.map((b) =>
            b.id === id ? { ...b, status: "paid" as BookingStatus } : b,
          ),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      const snapshots = ctx?.snapshots;
      if (snapshots) {
        for (const [key, data] of snapshots) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      qc.invalidateQueries({ queryKey: partnerKeys.stats });
    },
    ...options,
  });
}

export interface CreatePartnerBookingPayload {
  court_id: string;
  starts_at: string;
  duration_minutes: number;
  booker_display_name: string;
  booker_email: string;
  idempotency_key: string;
}

export function useCreatePartnerBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePartnerBookingPayload) => {
      return api.post<Booking>("/api/v1/partner/bookings", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      qc.invalidateQueries({ queryKey: partnerKeys.stats });
    },
  });
}

// ─── Analytics / Stats ──────────────────────────────────────────────────────

export function usePartnerStats(): UseQueryResult<PartnerStats> {
  return useQuery({
    queryKey: partnerKeys.stats,
    queryFn: async () => {
      return api.get<PartnerStats>("/api/v1/partner/stats");
    },
    staleTime: 30_000,
  });
}

// ─── Sports Options ─────────────────────────────────────────────────────────

export function useSportsOptions(): UseQueryResult<SportOption[]> {
  return useQuery({
    queryKey: partnerKeys.sports,
    queryFn: async () => {
      // Re-use standard catalog list of sports
      const res = await apiFetch<{ items: SportOption[] }>("/api/v1/sports");
      return res.items ?? [];
    },
    staleTime: 10 * 60 * 1000, // 10 minutes cache
  });
}
