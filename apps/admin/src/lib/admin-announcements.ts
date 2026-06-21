"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "./api";

export type AnnouncementAudience = "all" | "az" | "en" | "ru";
export type AnnouncementStatus = "all" | "active" | "scheduled" | "expired";

export interface AnnouncementCreator {
  id: string;
  display_name: string | null;
  email: string | null;
}

export interface Announcement {
  id: string;
  title_az: string;
  title_en: string;
  title_ru: string;
  body_az: string | null;
  body_en: string | null;
  body_ru: string | null;
  cta_label_az: string | null;
  cta_label_en: string | null;
  cta_label_ru: string | null;
  cta_url: string | null;
  audience: AnnouncementAudience;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string | null;
  created_by_user_id: string | null;
  creator: AnnouncementCreator | null;
  dismissals_count: number;
  is_scheduled: boolean;
  is_expired: boolean;
  is_active: boolean;
}

export interface AnnouncementsResponse {
  items: Announcement[];
  pagination: { limit: number; offset: number; total: number };
}

export interface AnnouncementsParams {
  q?: string;
  audience?: AnnouncementAudience;
  status?: AnnouncementStatus;
  limit?: number;
  offset?: number;
}

export interface AnnouncementPayload {
  title_az: string;
  title_en: string;
  title_ru: string;
  body_az?: string | null;
  body_en?: string | null;
  body_ru?: string | null;
  cta_label_az?: string | null;
  cta_label_en?: string | null;
  cta_label_ru?: string | null;
  cta_url?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  audience?: AnnouncementAudience;
  priority?: number;
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

export const announcementKeys = {
  all: ["admin", "announcements"] as const,
  list: (p: AnnouncementsParams) => [...announcementKeys.all, "list", p] as const,
};

export function useAnnouncements(
  params: AnnouncementsParams = {},
): UseQueryResult<AnnouncementsResponse> {
  return useQuery({
    queryKey: announcementKeys.list(params),
    queryFn: () => api.get<AnnouncementsResponse>(`/api/v1/admin/announcements${qs(params)}`),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useCreateAnnouncement(): UseMutationResult<Announcement, Error, AnnouncementPayload> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post<Announcement>("/api/v1/admin/announcements", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.all }),
  });
}

export function useUpdateAnnouncement(): UseMutationResult<
  Announcement,
  Error,
  { id: string; data: Partial<AnnouncementPayload> }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) =>
      api.patch<Announcement>(`/api/v1/admin/announcements/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.all }),
  });
}

export function useExpireAnnouncement(): UseMutationResult<Announcement, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.post<Announcement>(`/api/v1/admin/announcements/${id}/expire`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.all }),
  });
}

export function useDeleteAnnouncement(): UseMutationResult<{ ok: boolean }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete<{ ok: boolean }>(`/api/v1/admin/announcements/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.all }),
  });
}
