"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api, API_BASE_URL, apiFetch, APIError, apiHeaders } from "./api";

// ---------- Types ----------

export interface Venue {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  owner_user_id?: string | null;
  is_partner: boolean;
  phone: string | null;
  description: string | null;
  logo_url?: string | null;
  photo_url: string | null;
  photo_urls?: string[];
  status?: "draft" | "pending" | "published" | "suspended";
  opening_hours?: Record<string, unknown> | null;
  booking_slot_minutes?: number;
  min_booking_minutes?: number;
  max_booking_minutes?: number;
  cancellation_window_minutes?: number;
  courts_count?: number;
  bookings_count?: number;
  paid_revenue_minor?: number;
  distance_km: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Court {
  id: string;
  venue_id: string;
  venue_name?: string | null;
  sport_id: string;
  sport_slug: string;
  sport_name?: string | null;
  name: string;
  hourly_price_minor: number;
  currency: string;
  status?: "active" | "inactive" | "maintenance";
  photo_url?: string | null;
  photo_urls?: string[];
  created_at?: string | null;
}

export interface VenueDetail extends Venue {
  courts: Court[];
  partners?: PartnerAccount[];
}

export interface PartnerAccount {
  id: string;
  email: string;
  display_name: string;
  admin_role: string;
  venue_id: string;
  staff_title: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface VenuesListResponse {
  // The admin endpoint exposes both `items` (envelope) and `results` (legacy).
  items?: Venue[];
  results?: Venue[];
  total?: number;
  count?: number;
}

export interface CourtsListResponse {
  items: Court[];
}

export interface VenuePayload {
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone?: string | null;
  description?: string | null;
  logo_url?: string | null;
  photo_url?: string | null;
  photo_urls?: string[] | null;
  is_partner: boolean;
  status?: Venue["status"];
  opening_hours?: Record<string, unknown> | null;
  booking_slot_minutes?: number;
  min_booking_minutes?: number;
  max_booking_minutes?: number;
  cancellation_window_minutes?: number;
}

export interface CourtPayload {
  sport_id: string;
  name: string;
  hourly_price_minor: number;
  currency?: string;
  status?: "active" | "inactive" | "maintenance";
  photo_url?: string | null;
  photo_urls?: string[] | null;
}

export interface CourtBlock {
  id: string;
  court_id: string;
  created_by_user_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CourtBlockPayload {
  starts_at: string;
  ends_at: string;
  reason?: string | null;
  force?: boolean;
}

export interface CreateVenuePartnerPayload {
  email: string;
  display_name: string;
  password: string;
  staff_title?: string | null;
}

export interface UpdateVenuePartnerPayload {
  display_name?: string;
  staff_title?: string | null;
  password?: string;
}

// ---------- Query keys ----------

export interface VenuesListParams {
  limit?: number;
  offset?: number;
  status?: NonNullable<Venue["status"]>;
  partner?: boolean;
  q?: string;
}

export const venuesKeys = {
  all: ["venues"] as const,
  list: (params: VenuesListParams = {}) =>
    [...venuesKeys.all, "list", params] as const,
  detail: (id: string) => [...venuesKeys.all, "detail", id] as const,
  courts: (venueId: string) => [...venuesKeys.all, "courts", venueId] as const,
  blocks: (courtId: string) => [...venuesKeys.all, "court-blocks", courtId] as const,
  partners: (venueId: string) => [...venuesKeys.all, "partners", venueId] as const,
};

// ---------- Hooks ----------

export function useVenues(params: VenuesListParams = {}): UseQueryResult<Venue[]> {
  const { limit = 100, offset = 0, status, partner, q } = params;
  return useQuery({
    queryKey: venuesKeys.list({ limit, offset, status, partner, q }),
    queryFn: async () => {
      // Use the admin endpoint (not the public /venues catalog), so the picker
      // sees every venue regardless of status/slug, and can be filtered by
      // status/partner/q. The admin envelope exposes `items` (and `results`).
      const usp = new URLSearchParams();
      usp.set("limit", String(limit));
      usp.set("offset", String(offset));
      if (status) usp.set("status", status);
      if (partner !== undefined) usp.set("partner", partner ? "1" : "0");
      if (q) usp.set("q", q);
      const res = await api.get<VenuesListResponse>(
        `/api/v1/admin/venues?${usp.toString()}`,
      );
      return res.items ?? res.results ?? [];
    },
  });
}

export function useVenue(id: string | undefined): UseQueryResult<VenueDetail> {
  return useQuery({
    queryKey: venuesKeys.detail(id ?? ""),
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await api.get<VenueDetail>(`/api/v1/admin/venues/${id}`);
      return res;
    },
  });
}

export function useCreateVenue(): UseMutationResult<Venue, Error, VenuePayload> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: VenuePayload) => {
      const res = await api.post<Venue>("/api/v1/admin/venues", payload);
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: venuesKeys.all });
    },
  });
}

export function useUpdateVenue(): UseMutationResult<
  Venue,
  Error,
  { id: string; data: Partial<VenuePayload> }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }) => {
      const res = await api.patch<Venue>(`/api/v1/admin/venues/${id}`, data);
      return res;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: venuesKeys.all });
      qc.invalidateQueries({ queryKey: venuesKeys.detail(vars.id) });
    },
  });
}

export function useUpdateVenueStatus(): UseMutationResult<
  Venue,
  Error,
  { id: string; status: NonNullable<Venue["status"]> }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }) => {
      return api.patch<Venue>(`/api/v1/admin/venues/${id}/status`, { status });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: venuesKeys.all });
      qc.invalidateQueries({ queryKey: venuesKeys.detail(vars.id) });
    },
  });
}

export function useDeleteVenue(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete<void>(`/api/v1/admin/venues/${id}`);
    },
    // Optimistic delete: drop the row from every cached venues list before
    // the network confirms. If the request fails we restore the snapshot.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: venuesKeys.all });
      const snapshots = qc.getQueriesData<Venue[]>({ queryKey: venuesKeys.all });
      snapshots.forEach(([key, data]) => {
        if (Array.isArray(data)) {
          qc.setQueryData<Venue[]>(key, data.filter((v) => v.id !== id));
        }
      });
      return { snapshots };
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshots?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: venuesKeys.all });
    },
  });
}

// ---------- Courts ----------

export function useVenueCourts(venueId: string | undefined): UseQueryResult<Court[]> {
  return useQuery({
    queryKey: venuesKeys.courts(venueId ?? ""),
    enabled: Boolean(venueId),
    queryFn: async () => {
      const res = await apiFetch<CourtsListResponse>(
        `/api/v1/admin/venues/${venueId}/courts`,
      );
      return res.items ?? [];
    },
  });
}

export function useCreateCourt(
  venueId: string,
): UseMutationResult<Court, Error, CourtPayload> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CourtPayload) => {
      return api.post<Court>(`/api/v1/admin/venues/${venueId}/courts`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: venuesKeys.courts(venueId) });
      qc.invalidateQueries({ queryKey: venuesKeys.detail(venueId) });
    },
  });
}

export function useUpdateCourt(
  venueId: string,
): UseMutationResult<Court, Error, { id: string; data: Partial<CourtPayload> }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }) => {
      return api.patch<Court>(
        `/api/v1/admin/venues/${venueId}/courts/${id}`,
        data,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: venuesKeys.courts(venueId) });
      qc.invalidateQueries({ queryKey: venuesKeys.detail(venueId) });
    },
  });
}

export function useDeleteCourt(
  venueId: string,
): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete<void>(`/api/v1/admin/venues/${venueId}/courts/${id}`);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: venuesKeys.courts(venueId) });
      const prev = qc.getQueryData<Court[]>(venuesKeys.courts(venueId));
      if (prev) {
        qc.setQueryData<Court[]>(
          venuesKeys.courts(venueId),
          prev.filter((c) => c.id !== id),
        );
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(venuesKeys.courts(venueId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: venuesKeys.courts(venueId) });
      qc.invalidateQueries({ queryKey: venuesKeys.detail(venueId) });
    },
  });
}

// ---------- Court blocks ----------

export function useCourtBlocks(courtId: string | undefined): UseQueryResult<CourtBlock[]> {
  return useQuery({
    queryKey: venuesKeys.blocks(courtId ?? ""),
    enabled: Boolean(courtId),
    queryFn: async () => {
      const res = await api.get<{ items: CourtBlock[] }>(
        `/api/v1/admin/courts/${courtId}/blocks`,
      );
      return res.items ?? [];
    },
  });
}

export function useCreateCourtBlock(
  courtId: string,
): UseMutationResult<CourtBlock, Error, CourtBlockPayload> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      return api.post<CourtBlock>(`/api/v1/admin/courts/${courtId}/blocks`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: venuesKeys.blocks(courtId) });
      qc.invalidateQueries({ queryKey: venuesKeys.all });
    },
  });
}

export function useDeleteCourtBlock(
  courtId: string,
): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (blockId) => {
      await api.delete<void>(`/api/v1/admin/courts/${courtId}/blocks/${blockId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: venuesKeys.blocks(courtId) });
    },
  });
}

// ---------- Partner accounts ----------

export function useVenuePartners(
  venueId: string | undefined,
): UseQueryResult<PartnerAccount[]> {
  return useQuery({
    queryKey: venuesKeys.partners(venueId ?? ""),
    enabled: Boolean(venueId),
    queryFn: async () => {
      const res = await api.get<{ items: PartnerAccount[] }>(
        `/api/v1/admin/venues/${venueId}/partners`,
      );
      return res.items ?? [];
    },
  });
}

export function useCreateVenuePartner(
  venueId: string,
): UseMutationResult<PartnerAccount, Error, CreateVenuePartnerPayload> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      return api.post<PartnerAccount>(
        `/api/v1/admin/venues/${venueId}/partners`,
        payload,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: venuesKeys.partners(venueId) });
    },
  });
}

export function useUpdateVenuePartner(
  venueId: string,
): UseMutationResult<
  PartnerAccount,
  Error,
  { userId: string; data: UpdateVenuePartnerPayload }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, data }) => {
      return api.patch<PartnerAccount>(
        `/api/v1/admin/venues/${venueId}/partners/${userId}`,
        data,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: venuesKeys.partners(venueId) });
    },
  });
}

export function useDeleteVenuePartner(
  venueId: string,
): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await api.delete<void>(`/api/v1/admin/venues/${venueId}/partners/${userId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: venuesKeys.partners(venueId) });
    },
  });
}

// ---------- Image upload ----------

export const MAX_VENUE_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Uploads an image to the backend via the shared messages upload endpoint.
 * Returns the absolute URL the API persists. We keep this client-side instead
 * of going through `api.post` because that helper auto-stringifies JSON and we
 * need to send a `multipart/form-data` body.
 */
export async function uploadVenueImage(file: File): Promise<string> {
  if (file.size > MAX_VENUE_IMAGE_BYTES) {
    throw new APIError({
      code: "image_too_large",
      message: "Image is larger than 4 MB",
      status: 413,
    });
  }
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE_URL}/api/v1/messages/upload-image`, {
    method: "POST",
    headers: apiHeaders(),
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    let message = "Image upload failed";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* keep default */
    }
    throw new APIError({ code: "upload_failed", message, status: res.status });
  }
  const body = (await res.json()) as { url: string };
  return body.url;
}
