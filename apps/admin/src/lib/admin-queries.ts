/**
 * React Query hooks for admin endpoints.
 *
 * Wraps the typed API client (`@/lib/api`) and parses on non-2xx (throws).
 *
 * Users:
 *   - useAdminUsers(params)        — paginated list: search (q) + role/status/verification/vip + offset
 *   - useAdminUser(id)             — single user detail (extended stats)
 *   - useUpdateUserRole()          — POST /role          { role: 'admin' | 'moderator' | null }
 *   - useUpdateUserVerification()  — POST /email-verification { verified }
 *   - useUpdateUserVip()           — POST /vip           { is_vip, vip_badge_label?, vip_expires_at? }
 *   - useSuspendUser()             — POST /suspend       { reason }
 *   - useUnsuspendUser()           — POST /unsuspend
 *   - useSoftDeleteUser()          — POST /soft-delete   (optimistic)
 *   - useRestoreUser()             — POST /restore       (optimistic)
 *
 * Games / Bookings: see the matching sections below.
 *
 * Backend contracts (Laravel AdminOpsController):
 *   - `GET /admin/users?q=&role=&status=&verification=&vip=&limit=&offset=`
 *        → { results: User[], count, summary: UserSummary }
 *   - User mutations return the updated user payload; list/detail caches are kept
 *     in sync optimistically and re-validated via `invalidateQueries` on settle.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────────────

export type AdminRole = 'admin' | 'moderator' | 'partner' | null;

export interface User {
  id: string;
  email: string;
  display_name: string;
  admin_role: AdminRole;
  venue_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string | null;
  email_verified_at: string | null;
  email_is_verified: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  suspended_by_user_id: string | null;
  last_seen_at: string | null;
  is_vip: boolean;
  vip_badge_label: string | null;
  vip_expires_at: string | null;
  is_verified: boolean;
  is_ambassador?: boolean;
  username: string | null;
  membership_tier: string;
  is_premium: boolean;
  membership_period_end: string | null;
  games_played_total: number;
}

export interface UserDetail extends User {
  games_hosted_total: number;
  bookings_total: number;
  reports_filed_count: number;
  reports_received_count: number;
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
  source: string;
  payment_method: 'cash' | 'bank_transfer' | 'manual' | 'onsite' | null;
  payment_note: string | null;
  customer_name: string | null;
  customer_email: string | null;
  idempotency_key: string;
  external_ref: string | null;
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  cancelled_by_user_id: string | null;
  cancellation_reason: string | null;
  rescheduled_at: string | null;
  no_show_at: string | null;
  no_show_marked_by_user_id: string | null;
  checked_in_at: string | null;
  checked_in_by_user_id: string | null;
  internal_note: string | null;
  refund_status:
    | 'pending_manual_review'
    | 'approved'
    | 'processed'
    | 'rejected'
    | 'not_required'
    | null;
  refund_amount_minor: number | null;
  refund_note: string | null;
  refunded_at: string | null;
}

export interface BookingQuote {
  court_id: string;
  venue_id: string;
  venue_name: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  hourly_price_minor: number;
  total_minor: number;
  currency: string;
  available: boolean;
}

export interface BookingMutationPayload {
  starts_at?: string;
  duration_minutes?: number;
  status?: BookingStatus;
  payment_method?: Booking['payment_method'];
  payment_note?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  internal_note?: string | null;
  cancellation_reason?: string | null;
  refund_status?: Booking['refund_status'];
  refund_amount_minor?: number | null;
  refund_note?: string | null;
}

export interface CreateBookingPayload {
  court_id: string;
  user_id?: string | null;
  starts_at: string;
  duration_minutes: number;
  customer_name?: string | null;
  customer_email?: string | null;
  payment_method?: Booking['payment_method'];
  payment_note?: string | null;
  status?: Extract<BookingStatus, 'pending_payment' | 'paid'>;
}

export interface Paginated<T> {
  results: T[];
  count: number;
  summary?: UserSummary;
}

export interface UserSummary {
  total: number;
  active: number;
  deleted: number;
  suspended: number;
  verified: number;
  unverified: number;
  vip: number;
  regular: number;
  admin: number;
  moderator: number;
  partner: number;
  staff: number;
}

export interface AdminUsersParams {
  q?: string;
  role?: 'all' | 'user' | 'admin' | 'moderator' | 'partner' | 'staff';
  status?: 'all' | 'active' | 'suspended' | 'deleted';
  verification?: 'all' | 'verified' | 'unverified';
  vip?: 'all' | 'vip' | 'standard';
  limit?: number;
  offset?: number;
}

export interface CreateUserPayload {
  email: string;
  display_name: string;
  password: string;
  admin_role?: 'admin' | 'moderator' | null;
  email_verified?: boolean;
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
  user: (id: string) => ['admin', 'users', id] as const,
  games: (params: AdminGamesParams) => ['admin', 'games', params] as const,
  gamesAll: ['admin', 'games'] as const,
  bookings: (params: AdminBookingsParams) => ['admin', 'bookings', params] as const,
  bookingsAll: ['admin', 'bookings'] as const,
  booking: (id: string) => ['admin', 'bookings', id] as const,
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
        role: params.role && params.role !== 'all' ? params.role : undefined,
        status: params.status && params.status !== 'all' ? params.status : undefined,
        verification:
          params.verification && params.verification !== 'all'
            ? params.verification
            : undefined,
        vip: params.vip && params.vip !== 'all' ? params.vip : undefined,
        limit: params.limit ?? 20,
        offset: params.offset ?? 0,
      });
      return api.get<Paginated<User>>(`/api/v1/admin/users${qs}`);
    },
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useAdminUser(id: string | null) {
  return useQuery({
    queryKey: id ? adminKeys.user(id) : ['admin', 'users', 'empty'],
    queryFn: () => api.get<UserDetail>(`/api/v1/admin/users/${id}`),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

function setCachedUser(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
  patch: Partial<User>,
) {
  const snapshots = qc.getQueriesData<Paginated<User>>({
    queryKey: adminKeys.usersAll,
  });
  for (const [key, data] of snapshots) {
    if (!data) continue;
    qc.setQueryData<Paginated<User>>(key, {
      ...data,
      results: data.results.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    });
  }
  qc.setQueryData<UserDetail | User | undefined>(adminKeys.user(id), (current) =>
    current ? ({ ...current, ...patch } as UserDetail | User) : current,
  );
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

export function useUpdateUserVerification(
  options?: UseMutationOptions<UserDetail, Error, { id: string; verified: boolean }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, verified }) =>
      api.post<UserDetail>(`/api/v1/admin/users/${id}/email-verification`, {
        verified,
      }),
    onMutate: async ({ id, verified }) => {
      await qc.cancelQueries({ queryKey: adminKeys.usersAll });
      setCachedUser(qc, id, {
        email_is_verified: verified,
        email_verified_at: verified ? new Date().toISOString() : null,
      });
    },
    onSuccess: (user) => {
      setCachedUser(qc, user.id, user);
      qc.setQueryData(adminKeys.user(user.id), user);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminKeys.usersAll });
    },
    ...options,
  });
}

export function useUpdateUserVerifiedBadge(
  options?: UseMutationOptions<UserDetail, Error, { id: string; is_verified: boolean }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_verified }) =>
      api.post<UserDetail>(`/api/v1/admin/users/${id}/verified-badge`, {
        is_verified,
      }),
    onMutate: async ({ id, is_verified }) => {
      await qc.cancelQueries({ queryKey: adminKeys.usersAll });
      setCachedUser(qc, id, { is_verified });
    },
    onSuccess: (user) => {
      setCachedUser(qc, user.id, user);
      qc.setQueryData(adminKeys.user(user.id), user);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminKeys.usersAll });
    },
    ...options,
  });
}

export function useUpdateUserAmbassador(
  options?: UseMutationOptions<UserDetail, Error, { id: string; is_ambassador: boolean }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_ambassador }) =>
      api.post<UserDetail>(`/api/v1/admin/users/${id}/ambassador`, {
        is_ambassador,
      }),
    onMutate: async ({ id, is_ambassador }) => {
      await qc.cancelQueries({ queryKey: adminKeys.usersAll });
      setCachedUser(qc, id, { is_ambassador });
    },
    onSuccess: (user) => {
      setCachedUser(qc, user.id, user);
      qc.setQueryData(adminKeys.user(user.id), user);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminKeys.usersAll });
    },
    ...options,
  });
}

export function useUpdateUserMembership(
  options?: UseMutationOptions<UserDetail, Error, { id: string; tier: "free" | "premium"; months?: number }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tier, months }) =>
      api.post<UserDetail>(`/api/v1/admin/users/${id}/membership`, { tier, months }),
    onSuccess: (user) => {
      setCachedUser(qc, user.id, user);
      qc.setQueryData(adminKeys.user(user.id), user);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminKeys.usersAll });
    },
    ...options,
  });
}

export function useUpdateUserVip(
  options?: UseMutationOptions<
    UserDetail,
    Error,
    { id: string; is_vip: boolean; vip_badge_label?: string | null; vip_expires_at?: string | null }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_vip, vip_badge_label, vip_expires_at }) =>
      api.post<UserDetail>(`/api/v1/admin/users/${id}/vip`, {
        is_vip,
        vip_badge_label,
        vip_expires_at,
      }),
    onSuccess: (user) => {
      setCachedUser(qc, user.id, user);
      qc.setQueryData(adminKeys.user(user.id), user);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminKeys.usersAll });
    },
    ...options,
  });
}

export function useSuspendUser(
  options?: UseMutationOptions<UserDetail, Error, { id: string; reason: string }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) =>
      api.post<UserDetail>(`/api/v1/admin/users/${id}/suspend`, { reason }),
    onSuccess: (user) => {
      setCachedUser(qc, user.id, user);
      qc.setQueryData(adminKeys.user(user.id), user);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminKeys.usersAll });
    },
    ...options,
  });
}

export function useUnsuspendUser(
  options?: UseMutationOptions<UserDetail, Error, { id: string }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post<UserDetail>(`/api/v1/admin/users/${id}/unsuspend`, {}),
    onSuccess: (user) => {
      setCachedUser(qc, user.id, user);
      qc.setQueryData(adminKeys.user(user.id), user);
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
    mutationFn: ({ id }) => api.post<void>(`/api/v1/admin/users/${id}/soft-delete`, {}),
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

export function useCreateUser(
  options?: UseMutationOptions<User, Error, CreateUserPayload>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post<User>('/api/v1/admin/users', payload),
    onSuccess: () => {
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

function syncBookingCaches(
  qc: ReturnType<typeof useQueryClient>,
  booking: Booking,
) {
  const snapshots = qc.getQueriesData<Paginated<Booking>>({
    queryKey: adminKeys.bookingsAll,
  });
  for (const [key, data] of snapshots) {
    if (!data) continue;
    qc.setQueryData<Paginated<Booking>>(key, {
      ...data,
      results: data.results.map((b) => (b.id === booking.id ? booking : b)),
    });
  }
  qc.setQueryData(adminKeys.booking(booking.id), booking);
}

function invalidateBookings(qc: ReturnType<typeof useQueryClient>, id?: string) {
  qc.invalidateQueries({ queryKey: adminKeys.bookingsAll });
  if (id) {
    qc.invalidateQueries({ queryKey: adminKeys.booking(id) });
  }
}

export function useAdminBooking(id: string | null) {
  return useQuery({
    queryKey: id ? adminKeys.booking(id) : ['admin', 'bookings', 'empty'],
    queryFn: () => api.get<Booking>(`/api/v1/admin/bookings/${id}`),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useCreateBooking(
  options?: UseMutationOptions<Booking, Error, CreateBookingPayload>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post<Booking>('/api/v1/admin/bookings', payload),
    onSuccess: (booking) => {
      syncBookingCaches(qc, booking);
      invalidateBookings(qc, booking.id);
    },
    ...options,
  });
}

export function useQuoteBooking(
  options?: UseMutationOptions<
    BookingQuote,
    Error,
    Pick<CreateBookingPayload, 'court_id' | 'starts_at' | 'duration_minutes'>
  >,
) {
  return useMutation({
    mutationFn: (payload) =>
      api.post<BookingQuote>('/api/v1/admin/bookings/quote', payload),
    ...options,
  });
}

export function useUpdateBooking(
  options?: UseMutationOptions<
    Booking,
    Error,
    { id: string; data: BookingMutationPayload }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) =>
      api.patch<Booking>(`/api/v1/admin/bookings/${id}`, data),
    onSuccess: (booking) => {
      syncBookingCaches(qc, booking);
      invalidateBookings(qc, booking.id);
    },
    ...options,
  });
}

export function useCancelBooking(
  options?: UseMutationOptions<
    Booking,
    Error,
    {
      id: string;
      reason?: string | null;
      refund_status?: Booking['refund_status'];
      refund_amount_minor?: number | null;
      refund_note?: string | null;
    },
    { snapshots: Array<[readonly unknown[], Paginated<Booking> | undefined]> }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }) =>
      api.post<Booking>(`/api/v1/admin/bookings/${id}/cancel`, payload),
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
    onSuccess: (booking) => {
      syncBookingCaches(qc, booking);
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
    mutationFn: ({ id }) => api.post<void>(`/api/v1/admin/bookings/${id}/mark-paid`, {}),
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

export function useRefundBooking(
  options?: UseMutationOptions<
    Booking,
    Error,
    {
      id: string;
      refund_status?: Booking['refund_status'];
      refund_amount_minor?: number | null;
      refund_note?: string | null;
    }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }) =>
      api.post<Booking>(`/api/v1/admin/bookings/${id}/refund`, payload),
    onSuccess: (booking) => {
      syncBookingCaches(qc, booking);
      invalidateBookings(qc, booking.id);
    },
    ...options,
  });
}

export function useNoShowBooking(
  options?: UseMutationOptions<Booking, Error, { id: string }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      api.post<Booking>(`/api/v1/admin/bookings/${id}/no-show`, {}),
    onSuccess: (booking) => {
      syncBookingCaches(qc, booking);
      invalidateBookings(qc, booking.id);
    },
    ...options,
  });
}

export function useClearNoShowBooking(
  options?: UseMutationOptions<Booking, Error, { id: string }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      api.post<Booking>(`/api/v1/admin/bookings/${id}/clear-no-show`, {}),
    onSuccess: (booking) => {
      syncBookingCaches(qc, booking);
      invalidateBookings(qc, booking.id);
    },
    ...options,
  });
}

export function useCheckInBooking(
  options?: UseMutationOptions<Booking, Error, { id: string }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      api.post<Booking>(`/api/v1/admin/bookings/${id}/check-in`, {}),
    onSuccess: (booking) => {
      syncBookingCaches(qc, booking);
      invalidateBookings(qc, booking.id);
    },
    ...options,
  });
}

export function useUndoCheckInBooking(
  options?: UseMutationOptions<Booking, Error, { id: string }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      api.post<Booking>(`/api/v1/admin/bookings/${id}/undo-check-in`, {}),
    onSuccess: (booking) => {
      syncBookingCaches(qc, booking);
      invalidateBookings(qc, booking.id);
    },
    ...options,
  });
}

export function useBulkUpdateBookings(
  options?: UseMutationOptions<
    { updated: number },
    Error,
    {
      ids: string[];
      status: BookingStatus;
      payment_method?: Booking['payment_method'];
      payment_note?: string | null;
      cancellation_reason?: string | null;
      refund_status?: Booking['refund_status'];
      refund_amount_minor?: number | null;
      refund_note?: string | null;
    }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) =>
      api.post<{ updated: number }>('/api/v1/admin/bookings/bulk-status', payload),
    onSuccess: () => {
      invalidateBookings(qc);
    },
    ...options,
  });
}
