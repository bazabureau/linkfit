"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "./api";

export type PushJobStatus =
  | "pending"
  | "retry"
  | "processing"
  | "sent"
  | "failed"
  | "cancelled"
  | "skipped";

export interface PushJob {
  id: string;
  user_id: string;
  user_email: string | null;
  user_display_name: string | null;
  type: string;
  title: string;
  body: string;
  status: PushJobStatus;
  attempts: number | null;
  available_at: string | null;
  sent_at: string | null;
  last_attempt_at: string | null;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PushJobsSummary {
  pending: number;
  retry: number;
  processing: number;
  deferred: number;
  sent_24h: number;
  failed: number;
  cancelled: number;
  skipped: number;
}

export interface PushJobsResponse {
  items: PushJob[];
  summary: PushJobsSummary;
}

export interface PushJobsParams {
  status?: PushJobStatus;
  user_id?: string;
  limit?: number;
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

export const pushJobKeys = {
  all: ["admin", "push-jobs"] as const,
  list: (p: PushJobsParams) => [...pushJobKeys.all, "list", p] as const,
};

export function usePushJobs(params: PushJobsParams = {}): UseQueryResult<PushJobsResponse> {
  return useQuery({
    queryKey: pushJobKeys.list(params),
    queryFn: () => api.get<PushJobsResponse>(`/api/v1/admin/push-jobs${qs(params)}`),
    placeholderData: (prev) => prev,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}

export function useRetryPushJob(): UseMutationResult<PushJob, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.post<PushJob>(`/api/v1/admin/push-jobs/${id}/retry`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: pushJobKeys.all }),
  });
}

export function useCancelPushJob(): UseMutationResult<PushJob, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.post<PushJob>(`/api/v1/admin/push-jobs/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: pushJobKeys.all }),
  });
}
