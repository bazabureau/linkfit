"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "./api";

export type WaitlistStatus = "active" | "notified" | "cancelled" | "expired";

export interface WaitlistUser {
  id: string;
  display_name: string | null;
  email: string | null;
  photo_url: string | null;
}

export interface WaitlistEntry {
  id: string;
  user_id: string;
  user: WaitlistUser;
  court_id: string;
  court_name: string;
  venue_id: string;
  venue_name: string;
  sport_slug: string | null;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  status: WaitlistStatus;
  notified_at: string | null;
  cancelled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface WaitlistResponse {
  items: WaitlistEntry[];
  pagination: { limit: number; offset: number; total: number };
}

export interface WaitlistParams {
  status?: WaitlistStatus;
  court_id?: string;
  venue_id?: string;
  date?: string;
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

export const waitlistKeys = {
  all: ["admin", "waitlist"] as const,
  list: (p: WaitlistParams) => [...waitlistKeys.all, "list", p] as const,
};

export function useWaitlist(params: WaitlistParams = {}): UseQueryResult<WaitlistResponse> {
  return useQuery({
    queryKey: waitlistKeys.list(params),
    queryFn: () => api.get<WaitlistResponse>(`/api/v1/admin/waitlist${qs(params)}`),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useUpdateWaitlistEntry(): UseMutationResult<
  WaitlistEntry,
  Error,
  { id: string; status: WaitlistStatus }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) =>
      api.patch<WaitlistEntry>(`/api/v1/admin/waitlist/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: waitlistKeys.all }),
  });
}
