"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "./api";
import { formatDateRange as formatDateRangeValue } from "./date-format";

// ─── Status enums (mirror backend tournament_status enum) ──────────────

export type TournamentStatus =
  | "announced"
  | "registration_open"
  | "registration_closed"
  | "in_progress"
  | "completed"
  | "cancelled";

export type TournamentEntryStatus =
  | "pending"
  | "confirmed"
  | "withdrawn"
  | "disqualified";

export const TOURNAMENT_STATUSES: TournamentStatus[] = [
  "announced",
  "registration_open",
  "registration_closed",
  "in_progress",
  "completed",
  "cancelled",
];

export const TOURNAMENT_STATUS_LABEL: Record<TournamentStatus, string> = {
  announced: "Announced",
  registration_open: "Registration open",
  registration_closed: "Registration closed",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

// ─── Domain types ──────────────────────────────────────────────────────

export interface Sport {
  id: string;
  slug: string;
  name: string;
  min_players: number;
  max_players: number;
}

export interface Tournament {
  id: string;
  name: string;
  description: string | null;
  sport_id: string;
  sport_slug?: string | null;
  sport_name?: string | null;
  venue_id: string | null;
  venue_name?: string | null;
  starts_at: string;
  ends_at: string;
  registration_deadline: string | null;
  max_squads: number;
  squad_size: number;
  entry_fee_minor: number;
  currency: string;
  status: TournamentStatus;
  entries_count?: number;
  created_at?: string | null;
}

export interface TournamentEntry {
  id: string;
  tournament_id: string;
  captain_user_id: string;
  captain_display_name: string;
  captain_photo_url: string | null;
  captain_email?: string | null;
  squad_name: string;
  player_ids: string[];
  player_names: string[];
  status: TournamentEntryStatus;
  created_at: string;
}

/** Admin tournament detail GET returns the row + an embedded entries array. */
export interface TournamentDetail extends Tournament {
  entries?: TournamentEntry[];
}

export interface TournamentEntriesResponse {
  items: TournamentEntry[];
}

export interface TournamentsListPage {
  items: Tournament[];
  total?: number;
  /** Backend always returns null here — we page with limit/offset, not cursors. */
  next_cursor: string | null;
}

export interface SportsListResponse {
  items: Sport[];
}

export interface TournamentPayload {
  name: string;
  description?: string | null;
  sport_id: string;
  venue_id?: string | null;
  starts_at: string;
  ends_at: string;
  registration_deadline?: string | null;
  max_squads: number;
  squad_size: number;
  entry_fee_minor: number;
  currency: string;
  status?: TournamentStatus;
}

export interface TournamentListFilters {
  status?: TournamentStatus;
  sport?: string; // slug
  q?: string;
  limit?: number;
}

// ─── Query keys ────────────────────────────────────────────────────────

export const tournamentsKeys = {
  all: ["admin-tournaments"] as const,
  list: (filters: TournamentListFilters) =>
    [...tournamentsKeys.all, "list", filters] as const,
  detail: (id: string) => [...tournamentsKeys.all, "detail", id] as const,
  entries: (id: string) => [...tournamentsKeys.all, "entries", id] as const,
};

export const sportsKeys = {
  all: ["sports"] as const,
  list: () => [...sportsKeys.all, "list"] as const,
};

// ─── Hooks ─────────────────────────────────────────────────────────────

/**
 * Limit/offset-paginated admin tournaments listing. The backend
 * (AdminOpsController::tournaments) returns `{items, total, next_cursor:null}`
 * and pages with limit/offset (not cursors), so the next page param is derived
 * from how many rows we've loaded vs. the reported total.
 */
export function useAdminTournaments(
  filters: TournamentListFilters = {},
): UseInfiniteQueryResult<{ pages: TournamentsListPage[]; pageParams: unknown[] }, Error> {
  const limit = filters.limit ?? 25;
  return useInfiniteQuery({
    queryKey: tournamentsKeys.list(filters),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const offset = pageParam as number;
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.sport) params.set("sport", filters.sport);
      if (filters.q && filters.q.trim().length > 0) params.set("q", filters.q.trim());
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      const res = await api.get<TournamentsListPage>(
        `/api/v1/admin/tournaments?${params.toString()}`,
      );
      return res;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.items.length < limit) return undefined;
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
      if (typeof lastPage.total === "number" && loaded >= lastPage.total) return undefined;
      return loaded; // next offset
    },
  });
}

export function useTournament(id: string | undefined): UseQueryResult<TournamentDetail> {
  return useQuery({
    queryKey: id ? tournamentsKeys.detail(id) : ["admin-tournaments", "detail", "none"],
    enabled: Boolean(id),
    queryFn: async () => {
      // Admin single-tournament GET returns the admin-shaped row (entries_count,
      // created_at, …) plus an embedded `entries` array. The public endpoint is
      // a different shape and omits non-active entries, so we must use this one.
      const res = await api.get<TournamentDetail>(`/api/v1/admin/tournaments/${id ?? ""}`);
      return res;
    },
  });
}

export function useTournamentEntries(
  id: string | undefined,
): UseQueryResult<TournamentEntry[]> {
  return useQuery({
    queryKey: id ? tournamentsKeys.entries(id) : ["admin-tournaments", "entries", "none"],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await api.get<TournamentEntriesResponse>(
        `/api/v1/admin/tournaments/${id ?? ""}/entries`,
      );
      return res.items ?? [];
    },
  });
}

export function useSports(): UseQueryResult<Sport[]> {
  return useQuery({
    queryKey: sportsKeys.list(),
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const res = await api.get<SportsListResponse>("/api/v1/sports");
      return res.items ?? [];
    },
  });
}

export function useCreateTournament(): UseMutationResult<
  Tournament,
  Error,
  TournamentPayload
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TournamentPayload) => {
      const res = await api.post<Tournament>("/api/v1/admin/tournaments", payload);
      return res;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tournamentsKeys.all });
    },
  });
}

export function useUpdateTournament(): UseMutationResult<
  Tournament,
  Error,
  { id: string; data: Partial<TournamentPayload> }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }) => {
      const res = await api.patch<Tournament>(`/api/v1/admin/tournaments/${id}`, data);
      return res;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: tournamentsKeys.all });
      void qc.invalidateQueries({ queryKey: tournamentsKeys.detail(vars.id) });
    },
  });
}

/** Soft-cancel a tournament. Backend flips status to `cancelled`. */
export function useDeleteTournament(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete<void>(`/api/v1/admin/tournaments/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tournamentsKeys.all });
    },
  });
}

export function useRemoveTournamentEntry(): UseMutationResult<
  void,
  Error,
  { tournamentId: string; entryId: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tournamentId, entryId }) => {
      await api.delete<void>(
        `/api/v1/admin/tournaments/${tournamentId}/entries/${entryId}`,
      );
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: tournamentsKeys.entries(vars.tournamentId) });
      void qc.invalidateQueries({ queryKey: tournamentsKeys.detail(vars.tournamentId) });
      void qc.invalidateQueries({ queryKey: tournamentsKeys.all });
    },
  });
}

/**
 * Set an entry's moderation status — confirm a pending squad, disqualify a
 * cheater, or re-open a withdrawn one. Backed by
 * `PATCH /admin/tournaments/:id/entries/:entryId`.
 */
export function useUpdateTournamentEntry(): UseMutationResult<
  TournamentEntry,
  Error,
  { tournamentId: string; entryId: string; status: TournamentEntryStatus }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tournamentId, entryId, status }) => {
      return api.patch<TournamentEntry>(
        `/api/v1/admin/tournaments/${tournamentId}/entries/${entryId}`,
        { status },
      );
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: tournamentsKeys.entries(vars.tournamentId) });
      void qc.invalidateQueries({ queryKey: tournamentsKeys.detail(vars.tournamentId) });
      void qc.invalidateQueries({ queryKey: tournamentsKeys.all });
    },
  });
}

// ─── Formatters ────────────────────────────────────────────────────────

const CURRENCY_SIGN: Record<string, string> = { AZN: "₼", USD: "$", EUR: "€" };

export function formatMoney(minor: number, currency: string): string {
  if (minor === 0) return "Free";
  const major = (minor / 100).toFixed(2);
  const sign = CURRENCY_SIGN[currency] ?? "";
  return `${sign}${major} ${currency}`;
}

export function formatDateRange(starts: string, ends: string): string {
  return formatDateRangeValue(starts, ends);
}
