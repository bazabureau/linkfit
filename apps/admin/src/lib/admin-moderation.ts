"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "./api";

// ─── Shared ───────────────────────────────────────────────────────────────

export interface UserSummary {
  id: string;
  email: string;
  display_name: string;
  photo_url: string | null;
  admin_role: string | null;
  venue_id?: string | null;
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

// ─── Support tickets ────────────────────────────────────────────────────────

export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketCategory =
  | "general"
  | "booking"
  | "payment"
  | "venue"
  | "account"
  | "bug"
  | "owner";

export interface SupportTicket {
  id: string;
  user_id: string | null;
  user: UserSummary | null;
  category: TicketCategory;
  subject: string;
  message: string;
  status: TicketStatus;
  priority: TicketPriority;
  related_kind: string | null;
  related_id: string | null;
  assigned_to_user_id: string | null;
  assigned_to: UserSummary | null;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string | null;
  messages_count: number;
}

export interface SupportTicketMessage {
  id: string;
  author_user_id: string | null;
  author: UserSummary | null;
  author_role: string;
  body: string;
  created_at: string;
}

export interface SupportTicketDetail extends SupportTicket {
  messages: SupportTicketMessage[];
}

export interface SupportTicketsResponse {
  items: SupportTicket[];
  pagination: { limit: number; offset: number; total: number };
  summary: { open: number; pending: number; urgent: number };
}

export interface SupportTicketsParams {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
  q?: string;
  limit?: number;
  offset?: number;
}

export const supportKeys = {
  all: ["admin", "support"] as const,
  list: (p: SupportTicketsParams) => [...supportKeys.all, "list", p] as const,
  detail: (id: string) => [...supportKeys.all, "detail", id] as const,
};

export function useSupportTickets(
  params: SupportTicketsParams = {},
): UseQueryResult<SupportTicketsResponse> {
  return useQuery({
    queryKey: supportKeys.list(params),
    queryFn: () =>
      api.get<SupportTicketsResponse>(`/api/v1/admin/support/tickets${qs(params)}`),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useSupportTicket(
  id: string | null,
): UseQueryResult<SupportTicketDetail> {
  return useQuery({
    queryKey: id ? supportKeys.detail(id) : [...supportKeys.all, "detail", "empty"],
    queryFn: () => api.get<SupportTicketDetail>(`/api/v1/admin/support/tickets/${id}`),
    enabled: Boolean(id),
    staleTime: 5_000,
  });
}

export interface UpdateTicketPayload {
  status?: TicketStatus;
  priority?: TicketPriority;
  assigned_to_user_id?: string | null;
  resolution_note?: string | null;
}

export function useUpdateSupportTicket(): UseMutationResult<
  SupportTicketDetail,
  Error,
  { id: string; data: UpdateTicketPayload }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) =>
      api.patch<SupportTicketDetail>(`/api/v1/admin/support/tickets/${id}`, data),
    onSuccess: (ticket) => {
      qc.setQueryData(supportKeys.detail(ticket.id), ticket);
      qc.invalidateQueries({ queryKey: supportKeys.all });
    },
  });
}

export function useAddTicketMessage(): UseMutationResult<
  SupportTicketDetail,
  Error,
  { id: string; body: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      api.post<SupportTicketDetail>(`/api/v1/admin/support/tickets/${id}/messages`, {
        body,
      }),
    onSuccess: (ticket) => {
      qc.setQueryData(supportKeys.detail(ticket.id), ticket);
      qc.invalidateQueries({ queryKey: supportKeys.all });
    },
  });
}

// ─── Owner applications ─────────────────────────────────────────────────────

export type OwnerAppStatus = "pending" | "approved" | "rejected";

export interface OwnerApplication {
  id: string;
  user_id: string | null;
  user: UserSummary | null;
  venue_id: string | null;
  venue: { id: string; name: string; address: string; status: string | null; is_partner: boolean } | null;
  venue_name: string | null;
  venue_address: string | null;
  lat: number | null;
  lng: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  message: string | null;
  status: OwnerAppStatus;
  reviewed_by_user_id: string | null;
  reviewed_by: UserSummary | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface OwnerApplicationsResponse {
  items: OwnerApplication[];
  pagination: { limit: number; offset: number; total: number };
}

export interface OwnerApplicationsParams {
  status?: OwnerAppStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export const ownerAppKeys = {
  all: ["admin", "owner-applications"] as const,
  list: (p: OwnerApplicationsParams) => [...ownerAppKeys.all, "list", p] as const,
  detail: (id: string) => [...ownerAppKeys.all, "detail", id] as const,
};

export function useOwnerApplications(
  params: OwnerApplicationsParams = {},
): UseQueryResult<OwnerApplicationsResponse> {
  return useQuery({
    queryKey: ownerAppKeys.list(params),
    queryFn: () =>
      api.get<OwnerApplicationsResponse>(`/api/v1/admin/owner-applications${qs(params)}`),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useApproveOwnerApplication(): UseMutationResult<
  OwnerApplication,
  Error,
  { id: string; venue_id?: string | null; review_note?: string | null; status?: "published" | "draft" }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }) =>
      api.post<OwnerApplication>(`/api/v1/admin/owner-applications/${id}/approve`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ownerAppKeys.all });
      qc.invalidateQueries({ queryKey: ["venues"] });
    },
  });
}

export function useRejectOwnerApplication(): UseMutationResult<
  OwnerApplication,
  Error,
  { id: string; review_note?: string | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }) =>
      api.post<OwnerApplication>(`/api/v1/admin/owner-applications/${id}/reject`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ownerAppKeys.all });
    },
  });
}

// ─── Venue reviews ──────────────────────────────────────────────────────────

export interface VenueReview {
  id: string;
  venue_id: string;
  venue_name: string | null;
  author_user_id: string;
  display_name: string;
  author_photo_url: string | null;
  author: { id: string; display_name: string; email: string | null; photo_url: string | null };
  rating: number;
  body: string | null;
  photo_url: string | null;
  review_photo_url: string | null;
  created_at: string;
  updated_at: string | null;
  removed_at: string | null;
}

export interface VenueReviewsResponse {
  items: VenueReview[];
  total: number;
  summary: {
    avg_rating: number | null;
    active_count: number;
    removed_count: number;
  };
}

export interface VenueReviewsParams {
  venue_id?: string;
  rating?: number;
  q?: string;
  include_removed?: boolean;
  limit?: number;
  offset?: number;
}

export const reviewKeys = {
  all: ["admin", "reviews"] as const,
  list: (p: VenueReviewsParams) => [...reviewKeys.all, "list", p] as const,
};

export function useVenueReviews(
  params: VenueReviewsParams = {},
): UseQueryResult<VenueReviewsResponse> {
  return useQuery({
    queryKey: reviewKeys.list(params),
    queryFn: () =>
      api.get<VenueReviewsResponse>(`/api/v1/admin/reviews${qs(params)}`),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useRemoveReview(): UseMutationResult<VenueReview, Error, { id: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post<VenueReview>(`/api/v1/admin/reviews/${id}/remove`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: reviewKeys.all }),
  });
}

export function useRestoreReview(): UseMutationResult<VenueReview, Error, { id: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post<VenueReview>(`/api/v1/admin/reviews/${id}/restore`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: reviewKeys.all }),
  });
}
