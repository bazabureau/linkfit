"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "./api";

export interface MediaAsset {
  id: string;
  user_id: string | null;
  disk: string;
  path: string;
  url: string;
  mime: string | null;
  size_bytes: number;
  width: number | null;
  height: number | null;
  purpose: string | null;
  cleanup_reason: string | null;
  deleted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface MediaResponse {
  items: MediaAsset[];
}

export interface MediaParams {
  limit?: number;
}

export interface MediaCleanupPayload {
  older_than_days?: number;
  limit?: number;
  dry_run?: boolean;
  purpose?: string;
}

export interface MediaCleanupResult {
  selected: number;
  deleted: number;
  dry_run: boolean;
  errors: { id: string; error: string }[];
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

export const mediaKeys = {
  all: ["admin", "media"] as const,
  list: (p: MediaParams) => [...mediaKeys.all, "list", p] as const,
};

export function useMediaAssets(params: MediaParams = {}): UseQueryResult<MediaResponse> {
  return useQuery({
    queryKey: mediaKeys.list(params),
    queryFn: () => api.get<MediaResponse>(`/api/v1/admin/media${qs(params)}`),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useDeleteMediaAsset(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete<void>(`/api/v1/admin/media/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: mediaKeys.all }),
  });
}

export function useCleanupMedia(): UseMutationResult<
  MediaCleanupResult,
  Error,
  MediaCleanupPayload
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post<MediaCleanupResult>("/api/v1/admin/media/cleanup", payload),
    onSuccess: (res) => {
      if (!res.dry_run) qc.invalidateQueries({ queryKey: mediaKeys.all });
    },
  });
}
