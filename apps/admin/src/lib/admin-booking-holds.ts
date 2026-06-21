"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "./api";

export interface BookingHold {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  court_id: string;
  court_name: string | null;
  venue_id: string | null;
  venue_name: string | null;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  source: string;
  idempotency_key: string | null;
  expires_at: string;
  expired: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface BookingHoldsResponse {
  items: BookingHold[];
  pagination: { limit: number; offset: number; total: number };
}

export interface BookingHoldsParams {
  venue_id?: string;
  court_id?: string;
  include_expired?: boolean;
  limit?: number;
  offset?: number;
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

export const bookingHoldKeys = {
  all: ["admin", "booking-holds"] as const,
  list: (p: BookingHoldsParams) => [...bookingHoldKeys.all, "list", p] as const,
};

export function useBookingHolds(
  params: BookingHoldsParams = {},
): UseQueryResult<BookingHoldsResponse> {
  return useQuery({
    queryKey: bookingHoldKeys.list(params),
    queryFn: () => api.get<BookingHoldsResponse>(`/api/v1/admin/booking-holds${qs(params)}`),
    placeholderData: (prev) => prev,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}
