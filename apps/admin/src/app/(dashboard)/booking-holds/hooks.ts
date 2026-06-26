"use client";

// Data-layer hooks scoped to the booking-holds operations page.
//
// Lives inside the page directory (rather than src/lib) so the booking-holds
// area owns its own mutations without touching shared lib files. Reuses the
// existing list query + keys from `@/lib/admin-booking-holds` and the typed API
// client from `@/lib/api`.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { bookingHoldKeys } from "@/lib/admin-booking-holds";

// ─── Booking-hold release ─────────────────────────────────────────────────────

export function useReleaseBookingHold(): UseMutationResult<
  { id: string; released: boolean },
  Error,
  { id: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      api.delete<{ id: string; released: boolean }>(
        `/api/v1/admin/booking-holds/${id}`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: bookingHoldKeys.all }),
  });
}

// ─── Launch waitlist ("coming soon" web signups) ──────────────────────────────
//
// Distinct from the court-booking waitlist (admin/waitlist). Stored in
// launch_waitlist_entries; managed through a pending → invited → joined/declined
// pipeline.

export type LaunchWaitlistStatus = "pending" | "invited" | "joined" | "declined";

export interface LaunchWaitlistEntry {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: string | null;
  locale: string | null;
  source: string | null;
  message: string | null;
  status: LaunchWaitlistStatus;
  created_at: string | null;
  updated_at: string | null;
}

export interface LaunchWaitlistResponse {
  items: LaunchWaitlistEntry[];
  pagination: { limit: number; offset: number; total: number };
}

export interface LaunchWaitlistParams {
  status?: LaunchWaitlistStatus;
  role?: string;
  q?: string;
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

export const launchWaitlistKeys = {
  all: ["admin", "launch-waitlist"] as const,
  list: (p: LaunchWaitlistParams) =>
    [...launchWaitlistKeys.all, "list", p] as const,
};

export function useLaunchWaitlist(
  params: LaunchWaitlistParams = {},
): UseQueryResult<LaunchWaitlistResponse> {
  return useQuery({
    queryKey: launchWaitlistKeys.list(params),
    queryFn: () =>
      api.get<LaunchWaitlistResponse>(`/api/v1/admin/launch-waitlist${qs(params)}`),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useUpdateLaunchWaitlistEntry(): UseMutationResult<
  LaunchWaitlistEntry,
  Error,
  { id: string; status: LaunchWaitlistStatus }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) =>
      api.patch<LaunchWaitlistEntry>(`/api/v1/admin/launch-waitlist/${id}`, {
        status,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: launchWaitlistKeys.all }),
  });
}
