/**
 * React Query hooks for admin endpoints.
 *
 * Wraps the typed API client (`@/lib/api`) and provides:
 *   - useAdminUsers(params)       — paginated user list with search
 *   - useUpdateUserRole()         — promote/demote a user (admin | moderator | null)
 *   - useSoftDeleteUser()         — soft-delete a user
 *   - useRestoreUser()            — restore a soft-deleted user
 *   - useAdminGames(params)       — paginated game list with filters
 *   - useCancelGame()             — force-cancel a game (admin only)
 *
 * Backend assumptions:
 *   - `GET /admin/users?q=&limit=&offset=` returns { results: User[], count: number }
 *   - `GET /admin/games?status=&from=&to=&limit=&offset=` returns { results: Game[], count: number }
 *   - Mutations return the updated entity (or 204 No Content; we just invalidate).
 *   - The typed `api` client throws on non-2xx and parses JSON automatically.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────────────

export type AdminRole = 'admin' | 'moderator' | null;

export interface User {
  id: string;
  email: string;
  display_name: string;
  admin_role: AdminRole;
  deleted_at: string | null;
  created_at: string;
  games_played_total: number;
}

export type GameStatus = 'open' | 'full' | 'cancelled' | 'completed';

export interface Game {
  id: string;
  sport_slug: string;
  host_display_name: string;
  venue_name: string;
  starts_at: string;
  capacity: number;
  participants_count: number;
  status: GameStatus;
}

export type BookingStatus =
  | 'pending_payment'
  | 'partially_paid'
  | 'paid'
  | 'cancelled'
  | 'refunded'
  | 'failed';

export interface Booking {
  id: string;
  game_id: string | null;
  court_id: string;
  court_name: string;
  user_id: string;
  booker_display_name: string;
  booker_email: string;
  venue_id: string;
  venue_name: string;
  starts_at: string;
  duration_minutes: number;
  total_minor: number;
  currency: string;
  status: BookingStatus;
  idempotency_key: string;
  external_ref: string | null;
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
}

export interface Paginated<T> {
  results: T[];
  count: number;
}

export interface AdminUsersParams {
  q?: string;
  limit?: number;
  offset?: number;
}

export interface AdminGamesParams {
  status?: GameStatus | 'all';
  from?: string; // ISO date
  to?: string; // ISO date
  limit?: number;
  offset?: number;
}

export interface AdminBookingsParams {
  status?: BookingStatus;
  venue_id?: string;
  court_id?: string;
  q?: string;
  from?: string; // ISO date
  to?: string; // ISO date
  limit?: number;
  offset?: number;
}

// ─── Query keys ─────────────────────────────────────────────────────────────

export const adminKeys = {
  users: (params: AdminUsersParams) => ['admin', 'users', params] as const,
  usersAll: ['admin', 'users'] as const,
  games: (params: AdminGamesParams) => ['admin', 'games', params] as const,
  gamesAll: ['admin', 'games'] as const,
  bookings: (params: AdminBookingsParams) => ['admin', 'bookings', params] as const,
  bookingsAll: ['admin', 'bookings'] as const,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildQS(params: Record<string, string | number | undefined | null>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// ─── Users ──────────────────────────────────────────────────────────────────

export function useAdminUsers(params: AdminUsersParams) {
  return useQuery({
    queryKey: adminKeys.users(params),
    queryFn: async () => {
      const qs = buildQS({
        q: params.q,
        limit: params.limit ?? 20,
        offset: params.offset ?? 0,
      });
      return api.get<Paginated<User>>(`/api/v1/admin/users${qs}`);
    },
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useUpdateUserRole(
  options?: UseMutationOptions<
    User,
    Error,
    { id: string; role: AdminRole },
    { snapshots: Array<[readonly unknown[], Paginated<User> | undefined]> }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }) =>
      api.post<User>(`/api/v1/admin/users/${id}/role`, { role }),
    onMutate: async ({ id, role }) => {
      // Optimistic update across all cached user lists.
      await qc.cancelQueries({ queryKey: adminKeys.usersAll });
      const snapshots = qc.getQueriesData<Paginated<User>>({
        queryKey: adminKeys.usersAll,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<Paginated<User>>(key, {
          ...data,
          results: data.results.map((u) =>
            u.id === id ? { ...u, admin_role: role } : u,
          ),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      // Rollback on failure.
      const snapshots = (ctx as { snapshots?: Array<[unknown, unknown]> })
        ?.snapshots;
      if (snapshots) {
        for (const [key, data] of snapshots) {
          qc.setQueryData(key as readonly unknown[], data);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminKeys.usersAll });
    },
    ...options,
  });
}

export function useSoftDeleteUser(
  options?: UseMutationOptions<
    void,
    Error,
    { id: string },
    { snapshots: Array<[readonly unknown[], Paginated<User> | undefined]> }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      api.post<void>(`/api/v1/admin/users/${id}/soft-delete`, {}),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: adminKeys.usersAll });
      const snapshots = qc.getQueriesData<Paginated<User>>({
        queryKey: adminKeys.usersAll,
      });
      const now = new Date().toISOString();
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<Paginated<User>>(key, {
          ...data,
          results: data.results.map((u) =>
            u.id === id ? { ...u, deleted_at: now } : u,
          ),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      const snapshots = (ctx as { snapshots?: Array<[unknown, unknown]> })
        ?.snapshots;
      if (snapshots) {
        for (const [key, data] of snapshots) {
          qc.setQueryData(key as readonly unknown[], data);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminKeys.usersAll });
    },
    ...options,
  });
}

export function useRestoreUser(
  options?: UseMutationOptions<
    void,
    Error,
    { id: string },
    { snapshots: Array<[readonly unknown[], Paginated<User> | undefined]> }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post<void>(`/api/v1/admin/users/${id}/restore`, {}),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: adminKeys.usersAll });
      const snapshots = qc.getQueriesData<Paginated<User>>({
        queryKey: adminKeys.usersAll,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<Paginated<User>>(key, {
          ...data,
          results: data.results.map((u) =>
            u.id === id ? { ...u, deleted_at: null } : u,
          ),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      const snapshots = (ctx as { snapshots?: Array<[unknown, unknown]> })
        ?.snapshots;
      if (snapshots) {
        for (const [key, data] of snapshots) {
          qc.setQueryData(key as readonly unknown[], data);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminKeys.usersAll });
    },
    ...options,
  });
}

// ─── Games ──────────────────────────────────────────────────────────────────

export function useAdminGames(params: AdminGamesParams) {
  return useQuery({
    queryKey: adminKeys.games(params),
    queryFn: async () => {
      const qs = buildQS({
        status: params.status && params.status !== 'all' ? params.status : undefined,
        from: params.from,
        to: params.to,
        limit: params.limit ?? 20,
        offset: params.offset ?? 0,
      });
      return api.get<Paginated<Game>>(`/api/v1/admin/games${qs}`);
    },
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useCancelGame(
  options?: UseMutationOptions<
    Game,
    Error,
    { id: string },
    { snapshots: Array<[readonly unknown[], Paginated<Game> | undefined]> }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post<Game>(`/api/v1/admin/games/${id}/cancel`, {}),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: adminKeys.gamesAll });
      const snapshots = qc.getQueriesData<Paginated<Game>>({
        queryKey: adminKeys.gamesAll,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<Paginated<Game>>(key, {
          ...data,
          results: data.results.map((g) =>
            g.id === id ? { ...g, status: 'cancelled' as GameStatus } : g,
          ),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      const snapshots = (ctx as { snapshots?: Array<[unknown, unknown]> })
        ?.snapshots;
      if (snapshots) {
        for (const [key, data] of snapshots) {
          qc.setQueryData(key as readonly unknown[], data);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminKeys.gamesAll });
    },
    ...options,
  });
}

// ─── Bookings ───────────────────────────────────────────────────────────────

export function useAdminBookings(params: AdminBookingsParams) {
  return useQuery({
    queryKey: adminKeys.bookings(params),
    queryFn: async () => {
      const qs = buildQS({
        status: params.status,
        venue_id: params.venue_id,
        court_id: params.court_id,
        q: params.q,
        from: params.from,
        to: params.to,
        limit: params.limit ?? 20,
        offset: params.offset ?? 0,
      });
      const res = await api.get<{ items: Booking[]; total: number }>(
        `/api/v1/admin/bookings${qs}`,
      );
      return {
        results: res.items ?? [],
        count: res.total ?? 0,
      };
    },
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useCancelBooking(
  options?: UseMutationOptions<
    void,
    Error,
    { id: string },
    { snapshots: Array<[readonly unknown[], Paginated<Booking> | undefined]> }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      api.post<void>(`/api/v1/admin/bookings/${id}/cancel`, {}),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: adminKeys.bookingsAll });
      const snapshots = qc.getQueriesData<Paginated<Booking>>({
        queryKey: adminKeys.bookingsAll,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<Paginated<Booking>>(key, {
          ...data,
          results: data.results.map((b) =>
            b.id === id ? { ...b, status: 'cancelled' as BookingStatus } : b,
          ),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      const snapshots = ctx?.snapshots;
      if (snapshots) {
        for (const [key, data] of snapshots) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminKeys.bookingsAll });
    },
    ...options,
  });
}

export function useMarkBookingPaid(
  options?: UseMutationOptions<
    void,
    Error,
    { id: string },
    { snapshots: Array<[readonly unknown[], Paginated<Booking> | undefined]> }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      api.post<void>(`/api/v1/admin/bookings/${id}/mark-paid`, {}),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: adminKeys.bookingsAll });
      const snapshots = qc.getQueriesData<Paginated<Booking>>({
        queryKey: adminKeys.bookingsAll,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<Paginated<Booking>>(key, {
          ...data,
          results: data.results.map((b) =>
            b.id === id ? { ...b, status: 'paid' as BookingStatus } : b,
          ),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      const snapshots = ctx?.snapshots;
      if (snapshots) {
        for (const [key, data] of snapshots) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminKeys.bookingsAll });
    },
    ...options,
  });
}
