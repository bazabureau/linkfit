"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "./api";

export type NotificationType =
  | "booking_reminder"
  | "game_invite"
  | "game_update"
  | "tournament_invite"
  | "message_received"
  | "system";
export type NotificationSeverity = "info" | "warning" | "critical";
export type NotificationTargetRole = "admins" | "partners" | "customers" | "all";

export interface AdminNotificationUser {
  id: string;
  email: string | null;
  display_name: string | null;
  photo_url: string | null;
}

export interface AdminNotification {
  id: string;
  user_id: string;
  user: AdminNotificationUser;
  type: NotificationType;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  severity: NotificationSeverity | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string | null;
}

export interface NotificationsResponse {
  items: AdminNotification[];
  pagination: { limit: number; offset: number; total: number };
  summary: { unread: number; system: number; critical: number };
}

export interface NotificationsParams {
  q?: string;
  type?: NotificationType;
  severity?: NotificationSeverity;
  read?: "true" | "false";
  user_id?: string;
  limit?: number;
  offset?: number;
}

export interface SendNotificationPayload {
  title: string;
  body: string;
  type?: NotificationType;
  severity?: NotificationSeverity;
  target_role?: NotificationTargetRole;
  user_ids?: string[];
}

export interface SendNotificationResult {
  recipient_count: number;
  type: NotificationType;
  severity: NotificationSeverity;
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

export const notificationKeys = {
  all: ["admin", "notifications"] as const,
  list: (p: NotificationsParams) => [...notificationKeys.all, "list", p] as const,
};

export function useAdminNotifications(
  params: NotificationsParams = {},
): UseQueryResult<NotificationsResponse> {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => api.get<NotificationsResponse>(`/api/v1/admin/notifications${qs(params)}`),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useSendNotification(): UseMutationResult<
  SendNotificationResult,
  Error,
  SendNotificationPayload
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) =>
      api.post<SendNotificationResult>("/api/v1/admin/notifications", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkNotificationRead(): UseMutationResult<
  AdminNotification,
  Error,
  { id: string; read: boolean }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, read }) =>
      api.post<AdminNotification>(
        `/api/v1/admin/notifications/${id}/${read ? "read" : "unread"}`,
        {},
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useDeleteNotification(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete<void>(`/api/v1/admin/notifications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
