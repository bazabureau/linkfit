"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api, API_BASE_URL, apiFetch, APIError } from "./api";
import { ACCESS_TOKEN_COOKIE, getCookie } from "./cookies";

// ---------- Types ----------

export interface Venue {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  is_partner: boolean;
  phone: string | null;
  description: string | null;
  photo_url: string | null;
  distance_km: number | null;
  created_at?: string | null;
}

export interface Court {
  id: string;
  venue_id: string;
  sport_id: string;
  sport_slug: string;
  name: string;
  hourly_price_minor: number;
  currency: string;
  created_at?: string | null;
}

export interface VenueDetail extends Venue {
  courts: Court[];
}

export interface VenuesListResponse {
  items: Venue[];
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
  photo_url?: string | null;
  is_partner: boolean;
}

export interface CourtPayload {
  sport_id: string;
  name: string;
  hourly_price_minor: number;
  currency?: string;
}

// ---------- Query keys ----------

export const venuesKeys = {
  all: ["venues"] as const,
  list: (params: { limit?: number; offset?: number } = {}) =>
    [...venuesKeys.all, "list", params] as const,
  detail: (id: string) => [...venuesKeys.all, "detail", id] as const,
  courts: (venueId: string) => [...venuesKeys.all, "courts", venueId] as const,
};

// ---------- Hooks ----------

export function useVenues(params: { limit?: number; offset?: number } = {}): UseQueryResult<Venue[]> {
  const { limit = 100, offset = 0 } = params;
  return useQuery({
    queryKey: venuesKeys.list({ limit, offset }),
    queryFn: async () => {
      const res = await api.get<VenuesListResponse>(
        `/api/v1/venues?limit=${limit}&offset=${offset}`,
      );
      return res.items ?? [];
    },
  });
}

export function useVenue(id: string | undefined): UseQueryResult<VenueDetail> {
  return useQuery({
    queryKey: venuesKeys.detail(id ?? ""),
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await api.get<VenueDetail>(`/api/v1/venues/${id}`);
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
  const accessToken = getCookie(ACCESS_TOKEN_COOKIE);
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE_URL}/api/v1/messages/upload-image`, {
    method: "POST",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    body: form,
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
