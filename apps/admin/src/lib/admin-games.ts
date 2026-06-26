"use client";

/**
 * Admin Games — typed React Query hooks + zod schemas.
 *
 * This module wraps the `/api/v1/admin/games*` surface exposed by the API
 * (see `apps/api-laravel/routes/api.php` and `AdminOpsController`).
 *
 * Conventions match the rest of the admin app:
 *   - Hooks live next to schemas so a page consuming a hook also gets the
 *     type without an extra import.
 *   - `placeholderData: (prev) => prev` keeps the table populated during
 *     filter changes — no full blank-then-rerender flash.
 *   - Mutations invalidate the parent key (`gamesKeys.all`) so list AND
 *     detail caches refresh after a cancel/update/delete.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";

// ───────────────────────── Schemas ─────────────────────────

export const GameStatusEnum = z.enum(["open", "full", "cancelled", "completed"]);
export type GameStatus = z.infer<typeof GameStatusEnum>;

export const AdminGameRowSchema = z.object({
  id: z.string().uuid(),
  sport_id: z.string().uuid(),
  sport_slug: z.string(),
  host_user_id: z.string().uuid(),
  host_display_name: z.string(),
  host_photo_url: z.string().nullable(),
  venue_id: z.string().uuid().nullable(),
  venue_name: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  starts_at: z.string(),
  duration_minutes: z.number(),
  capacity: z.number(),
  participants_count: z.number(),
  status: GameStatusEnum,
  visibility: z.enum(["public", "invite"]),
  skill_min_elo: z.number().nullable(),
  skill_max_elo: z.number().nullable(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type AdminGame = z.infer<typeof AdminGameRowSchema>;

export const AdminGameParticipantSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  // Accept any backend status — an unexpected value must NOT throw a ZodError
  // and crash the whole game-detail page. Known values keep their badge;
  // unknowns fall through as a plain string.
  status: z.enum(["confirmed", "cancelled", "no_show", "played"]).or(z.string()),
  joined_at: z.string(),
  status_changed_at: z.string(),
});
export type AdminGameParticipant = z.infer<typeof AdminGameParticipantSchema>;

export const AdminGameAuditEntrySchema = z.object({
  id: z.string().uuid(),
  actor_user_id: z.string().uuid().nullable(),
  actor_display_name: z.string().nullable(),
  action: z.string(),
  // Backend `auditWrite` stores empty metadata as json_encode([]) -> JSON `[]`,
  // which z.record() rejects (would crash the whole game-detail parse). Coerce
  // any non-object (array/null) value to {}.
  metadata: z.preprocess(
    (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}),
    z.record(z.unknown()),
  ),
  created_at: z.string(),
});
export type AdminGameAuditEntry = z.infer<typeof AdminGameAuditEntrySchema>;

export const AdminGameDetailSchema = AdminGameRowSchema.extend({
  notes: z.string().nullable(),
  updated_at: z.string(),
  participants: z.array(AdminGameParticipantSchema),
  status_changes: z.array(AdminGameAuditEntrySchema),
});
export type AdminGameDetail = z.infer<typeof AdminGameDetailSchema>;

export const AdminGamesListResponseSchema = z.object({
  items: z.array(AdminGameRowSchema),
  total: z.number(),
  next_cursor: z.string().nullable(),
});
export type AdminGamesListResponse = z.infer<typeof AdminGamesListResponseSchema>;

export interface AdminGamesParams {
  status?: GameStatus | "all";
  sport?: string;
  q?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
  offset?: number;
}

export interface AdminGameUpdatePayload {
  status?: GameStatus;
  capacity?: number;
  notes?: string | null;
  skill_min_elo?: number | null;
  skill_max_elo?: number | null;
}

// ───────────────────────── Query keys ─────────────────────────

export const gamesKeys = {
  all: ["admin", "games"] as const,
  list: (params: AdminGamesParams) => ["admin", "games", "list", params] as const,
  detail: (id: string) => ["admin", "games", "detail", id] as const,
};

// ───────────────────────── Helpers ─────────────────────────

function buildQS(params: Record<string, string | number | boolean | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

// ───────────────────────── Queries ─────────────────────────

export function useAdminGames(params: AdminGamesParams): UseQueryResult<AdminGamesListResponse> {
  return useQuery({
    queryKey: gamesKeys.list(params),
    queryFn: async () => {
      const qs = buildQS({
        status: params.status && params.status !== "all" ? params.status : undefined,
        sport: params.sport,
        q: params.q,
        from: params.from,
        to: params.to,
        cursor: params.cursor,
        limit: params.limit ?? 20,
        offset: params.cursor ? undefined : params.offset ?? 0,
      });
      const raw = await api.get<unknown>(`/api/v1/admin/games${qs}`);
      return AdminGamesListResponseSchema.parse(raw);
    },
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useAdminGameDetail(id: string | undefined): UseQueryResult<AdminGameDetail> {
  return useQuery({
    queryKey: gamesKeys.detail(id ?? ""),
    enabled: Boolean(id),
    queryFn: async () => {
      const raw = await api.get<unknown>(`/api/v1/admin/games/${id ?? ""}`);
      return AdminGameDetailSchema.parse(raw);
    },
    staleTime: 5_000,
  });
}

// ───────────────────────── Mutations ─────────────────────────

interface CancelVars {
  id: string;
  reason?: string;
}

/**
 * Force-cancel a game. We optimistically flip the row to "cancelled" across
 * every cached list so the UI feels immediate; on failure we roll the
 * snapshots back and surface a toast via the caller.
 */
export function useCancelAdminGame(
  options?: UseMutationOptions<
    void,
    Error,
    CancelVars,
    { snapshots: Array<[readonly unknown[], AdminGamesListResponse | undefined]> }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }) => {
      await api.post<void>(`/api/v1/admin/games/${id}/cancel`, reason ? { reason } : {});
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: gamesKeys.all });
      const snapshots = qc.getQueriesData<AdminGamesListResponse>({ queryKey: gamesKeys.all });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<AdminGamesListResponse>(key, {
          ...data,
          items: data.items.map((g) =>
            g.id === id ? { ...g, status: "cancelled" as GameStatus } : g,
          ),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      for (const [key, data] of ctx.snapshots) {
        qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: gamesKeys.all });
    },
    ...options,
  });
}

export function useUpdateAdminGame(
  options?: UseMutationOptions<AdminGameDetail, Error, { id: string; data: AdminGameUpdatePayload }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }) => {
      const raw = await api.patch<unknown>(`/api/v1/admin/games/${id}`, data);
      return AdminGameDetailSchema.parse(raw);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: gamesKeys.all });
      qc.invalidateQueries({ queryKey: gamesKeys.detail(vars.id) });
    },
    ...options,
  });
}

export function useDeleteAdminGame(
  options?: UseMutationOptions<void, Error, { id: string }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }) => {
      await api.delete<void>(`/api/v1/admin/games/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: gamesKeys.all });
    },
    ...options,
  });
}

// ───────────────────────── Display helpers ─────────────────────────

const BAKU_CENTRE = { lat: 40.4093, lng: 49.8671 };
const EARTH_KM = 6371;

/** Haversine distance from Baku centre to the given coordinates, in km. */
export function distanceFromBakuKm(lat: number, lng: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat - BAKU_CENTRE.lat);
  const dLng = toRad(lng - BAKU_CENTRE.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(BAKU_CENTRE.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

/** Sport slug → emoji icon. Falls back to a gym icon for unknown slugs. */
export function sportIcon(slug: string): string {
  switch (slug.toLowerCase()) {
    case "padel":
    case "tennis":
      return "🎾";
    case "football":
    case "futsal":
    case "soccer":
      return "⚽️";
    case "basketball":
      return "🏀";
    case "volleyball":
      return "🏐";
    case "badminton":
      return "🏸";
    case "table_tennis":
      return "🏓";
    case "running":
      return "🏃";
    case "cycling":
      return "🚴";
    default:
      return "🏟";
  }
}
