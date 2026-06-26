"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "./api";

/**
 * Pre-launch ("coming soon") lead pipeline. Mirrors the backend
 * LaunchWaitlistController::STATUSES + the {items, pagination} list envelope.
 */
export const LAUNCH_WAITLIST_STATUSES = [
  "pending",
  "invited",
  "joined",
  "declined",
] as const;
export type LaunchWaitlistStatus = (typeof LAUNCH_WAITLIST_STATUSES)[number];

export const LAUNCH_WAITLIST_ROLES = [
  "player",
  "venue",
  "coach",
  "other",
] as const;
export type LaunchWaitlistRole = (typeof LAUNCH_WAITLIST_ROLES)[number];

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
  role?: LaunchWaitlistRole;
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

export function useUpdateLaunchWaitlistStatus(): UseMutationResult<
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
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: launchWaitlistKeys.all }),
  });
}
