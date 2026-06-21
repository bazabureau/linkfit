"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api, apiFetch } from "./api";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Venue {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  description: string | null;
  photo_url: string | null;
  created_at: string;
}

export type CourtStatus = "active" | "inactive" | "maintenance";

export interface Court {
  id: string;
  venue_id: string;
  sport_id: string;
  sport_slug: string;
  sport_name?: string | null;
  name: string;
  hourly_price_minor: number;
  currency: string;
  status?: CourtStatus;
  photo_url?: string | null;
  photo_urls?: string[];
  created_at: string;
}

export type BookingStatus =
  | "pending_payment"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "refunded"
  | "failed";

export type RefundStatus =
  | "pending_manual_review"
  | "approved"
  | "processed"
  | "rejected"
  | "not_required";

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
  // Venue-ops fields surfaced by the backend bookingPayload().
  checked_in_at?: string | null;
  no_show_at?: string | null;
  refund_status?: RefundStatus | null;
  refund_amount_minor?: number | null;
  refund_note?: string | null;
  refunded_at?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
}

export interface Paginated<T> {
  results: T[];
  count: number;
}

export interface PartnerBookingsParams {
  status?: BookingStatus;
  court_id?: string;
  q?: string;
  from?: string; // ISO date
  to?: string; // ISO date
  limit?: number;
  offset?: number;
}

export interface PartnerStats {
  total_bookings: number;
  paid_bookings: number;
  pending_bookings: number;
  cancelled_bookings: number;
  total_revenue_minor: number;
  currency: string;
  occupancy_rate: number;
}

export interface SportOption {
  id: string;
  name: string;
  slug: string;
}

// ─── Staff ──────────────────────────────────────────────────────────────────

export type StaffPermission =
  | "dashboard"
  | "bookings"
  | "manual_booking"
  | "calendar"
  | "courts"
  | "maintenance"
  | "customers"
  | "reviews"
  | "reports"
  | "tournaments"
  | "staff"
  | "venue_settings"
  | "revenue";

export type StaffPermissions = Record<string, boolean>;

export interface StaffMember {
  id: string;
  email: string;
  display_name: string;
  admin_role: string;
  venue_id: string | null;
  staff_title: string | null;
  staff_permissions: StaffPermissions;
  deleted_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface StaffListResponse {
  items: StaffMember[];
  permission_options: string[];
}

export interface CreateStaffPayload {
  email: string;
  display_name: string;
  password: string;
  staff_title?: string | null;
  staff_permissions?: StaffPermissions | null;
}

export interface UpdateStaffPayload {
  display_name?: string;
  password?: string;
  staff_title?: string | null;
  staff_permissions?: StaffPermissions | null;
  restore?: boolean;
}

// ─── Court Blocks (maintenance / closure) ────────────────────────────────────

export interface CourtBlock {
  id: string;
  court_id: string;
  court_name?: string;
  created_by_user_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CreateCourtBlockPayload {
  court_id: string;
  starts_at: string;
  ends_at: string;
  reason?: string | null;
  force?: boolean;
}

export interface UpdateCourtBlockPayload {
  starts_at?: string;
  ends_at?: string;
  reason?: string | null;
  force?: boolean;
}

// ─── Venue Rules ─────────────────────────────────────────────────────────────

export interface VenueRules {
  opening_hours: Record<string, unknown> | null;
  booking_slot_minutes: number;
  min_booking_minutes: number;
  max_booking_minutes: number;
  cancellation_window_minutes: number;
}

export type UpdateVenueRulesPayload = Partial<VenueRules>;

// ─── Account ─────────────────────────────────────────────────────────────────

export interface PartnerAccount {
  id: string;
  email: string;
  display_name: string;
  admin_role: string | null;
  venue_id: string;
  staff_title: string | null;
  staff_permissions: StaffPermissions;
  is_owner: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface UpdateAccountPayload {
  display_name?: string;
  current_password?: string;
  password?: string;
}

// ─── Query keys ─────────────────────────────────────────────────────────────

export const partnerKeys = {
  venue: ["partner", "venue"] as const,
  courts: ["partner", "courts"] as const,
  bookings: (params: PartnerBookingsParams) => ["partner", "bookings", params] as const,
  bookingsAll: ["partner", "bookings"] as const,
  stats: ["partner", "stats"] as const,
  sports: ["partner", "sports"] as const,
  staff: ["partner", "staff"] as const,
  blocks: ["partner", "blocks"] as const,
  rules: ["partner", "rules"] as const,
  account: ["partner", "account"] as const,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildQS(params: Record<string, string | number | undefined | null>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

// ─── Venue Profile ──────────────────────────────────────────────────────────

export function usePartnerVenue(): UseQueryResult<Venue> {
  return useQuery({
    queryKey: partnerKeys.venue,
    queryFn: async () => {
      return api.get<Venue>("/api/v1/partner/venue");
    },
    staleTime: 30_000,
  });
}

export function useUpdatePartnerVenue(): UseMutationResult<
  Venue,
  Error,
  Partial<Omit<Venue, "id" | "created_at">>
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data) => {
      return api.put<Venue>("/api/v1/partner/venue", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.venue });
    },
  });
}

// ─── Courts Management ──────────────────────────────────────────────────────

export function usePartnerCourts(): UseQueryResult<Court[]> {
  return useQuery({
    queryKey: partnerKeys.courts,
    queryFn: async () => {
      // The controller returns `{ items: [...] }` — unwrap so consumers always
      // receive a real Court[] (was previously returning the wrapper object).
      const res = await api.get<{ items: Court[] }>("/api/v1/partner/courts");
      return res.items ?? [];
    },
    staleTime: 30_000,
  });
}

export function useCreatePartnerCourt(): UseMutationResult<
  Court,
  Error,
  Omit<Court, "id" | "venue_id" | "sport_slug" | "created_at">
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      return api.post<Court>("/api/v1/partner/courts", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.courts });
      qc.invalidateQueries({ queryKey: partnerKeys.stats });
    },
  });
}

export function useUpdatePartnerCourt(): UseMutationResult<
  Court,
  Error,
  { id: string; data: Partial<Omit<Court, "id" | "venue_id" | "sport_slug" | "created_at">> }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }) => {
      return api.put<Court>(`/api/v1/partner/courts/${id}`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.courts });
    },
  });
}

export function useDeletePartnerCourt(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      await api.delete<void>(`/api/v1/partner/courts/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.courts });
      qc.invalidateQueries({ queryKey: partnerKeys.stats });
    },
  });
}

// ─── Bookings / Reservations ─────────────────────────────────────────────────

export function usePartnerBookings(params: PartnerBookingsParams) {
  return useQuery({
    queryKey: partnerKeys.bookings(params),
    queryFn: async () => {
      // The bookings endpoint only honors `from`/`to` (it ignores
      // status/court_id/q/limit/offset and returns `{items:[]}` with no total).
      // status/court/search filtering is applied client-side by the page, so we
      // only send the date window here and derive `count` from the rows.
      const qs = buildQS({
        from: params.from,
        to: params.to,
      });
      const res = await api.get<{ items: Booking[] }>(
        `/api/v1/partner/bookings${qs}`,
      );
      const results = res.items ?? [];
      return {
        results,
        count: results.length,
      };
    },
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useCancelPartnerBooking(
  options?: UseMutationOptions<
    void,
    Error,
    { id: string },
    { snapshots: Array<[readonly unknown[], Paginated<Booking> | undefined]> }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post<void>(`/api/v1/partner/bookings/${id}/cancel`, {}),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: partnerKeys.bookingsAll });
      const snapshots = qc.getQueriesData<Paginated<Booking>>({
        queryKey: partnerKeys.bookingsAll,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<Paginated<Booking>>(key, {
          ...data,
          results: data.results.map((b) =>
            b.id === id ? { ...b, status: "cancelled" as BookingStatus } : b,
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
      qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      qc.invalidateQueries({ queryKey: partnerKeys.stats });
    },
    ...options,
  });
}

export function useMarkPartnerBookingPaid(
  options?: UseMutationOptions<
    void,
    Error,
    { id: string },
    { snapshots: Array<[readonly unknown[], Paginated<Booking> | undefined]> }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post<void>(`/api/v1/partner/bookings/${id}/mark-paid`, {}),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: partnerKeys.bookingsAll });
      const snapshots = qc.getQueriesData<Paginated<Booking>>({
        queryKey: partnerKeys.bookingsAll,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<Paginated<Booking>>(key, {
          ...data,
          results: data.results.map((b) =>
            b.id === id ? { ...b, status: "paid" as BookingStatus } : b,
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
      qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      qc.invalidateQueries({ queryKey: partnerKeys.stats });
    },
    ...options,
  });
}

export interface CreatePartnerBookingPayload {
  court_id: string;
  starts_at: string;
  duration_minutes: number;
  // Field names must match PartnerOpsController::createBooking validation.
  user_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  payment_method?: "cash" | "bank_transfer" | "manual" | "onsite";
  payment_note?: string | null;
  status?: "pending_payment" | "paid";
}

export function useCreatePartnerBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePartnerBookingPayload) => {
      return api.post<Booking>("/api/v1/partner/bookings", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      qc.invalidateQueries({ queryKey: partnerKeys.stats });
    },
  });
}

// ─── Venue-ops booking actions (check-in / no-show / refund) ─────────────────

/** Generic helper: POST a partner booking action and refresh the lists. */
function useBookingActionMutation<V extends { id: string }>(
  buildPath: (vars: V) => string,
  buildBody?: (vars: V) => unknown,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) =>
      api.post<Booking>(buildPath(vars), buildBody ? buildBody(vars) : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      qc.invalidateQueries({ queryKey: partnerKeys.stats });
    },
  });
}

export function useCheckInPartnerBooking() {
  return useBookingActionMutation<{ id: string }>(
    ({ id }) => `/api/v1/partner/bookings/${id}/check-in`,
  );
}

export function useUndoCheckInPartnerBooking() {
  return useBookingActionMutation<{ id: string }>(
    ({ id }) => `/api/v1/partner/bookings/${id}/undo-check-in`,
  );
}

export function useMarkPartnerBookingNoShow() {
  return useBookingActionMutation<{ id: string }>(
    ({ id }) => `/api/v1/partner/bookings/${id}/no-show`,
  );
}

export function useClearPartnerBookingNoShow() {
  return useBookingActionMutation<{ id: string }>(
    ({ id }) => `/api/v1/partner/bookings/${id}/clear-no-show`,
  );
}

export interface RefundPartnerBookingPayload {
  id: string;
  refund_status?: RefundStatus;
  refund_amount_minor?: number | null;
  refund_note?: string | null;
}

export function useRefundPartnerBooking() {
  return useBookingActionMutation<RefundPartnerBookingPayload>(
    ({ id }) => `/api/v1/partner/bookings/${id}/refund`,
    ({ refund_status, refund_amount_minor, refund_note }) => ({
      ...(refund_status !== undefined ? { refund_status } : {}),
      ...(refund_amount_minor !== undefined ? { refund_amount_minor } : {}),
      ...(refund_note !== undefined ? { refund_note } : {}),
    }),
  );
}

// ─── Analytics / Stats ──────────────────────────────────────────────────────

export function usePartnerStats(): UseQueryResult<PartnerStats> {
  return useQuery({
    queryKey: partnerKeys.stats,
    queryFn: async () => {
      return api.get<PartnerStats>("/api/v1/partner/stats");
    },
    staleTime: 30_000,
  });
}

// ─── Sports Options ─────────────────────────────────────────────────────────

export function useSportsOptions(): UseQueryResult<SportOption[]> {
  return useQuery({
    queryKey: partnerKeys.sports,
    queryFn: async () => {
      // Re-use standard catalog list of sports
      const res = await apiFetch<{ items: SportOption[] }>("/api/v1/sports");
      return res.items ?? [];
    },
    staleTime: 10 * 60 * 1000, // 10 minutes cache
  });
}

// ─── Staff Management ────────────────────────────────────────────────────────

export function usePartnerStaff(): UseQueryResult<StaffListResponse> {
  return useQuery({
    queryKey: partnerKeys.staff,
    queryFn: async () => {
      const res = await api.get<StaffListResponse>("/api/v1/partner/staff");
      return {
        items: res.items ?? [],
        permission_options: res.permission_options ?? [],
      };
    },
    staleTime: 30_000,
  });
}

export function useCreatePartnerStaff(): UseMutationResult<
  StaffMember,
  Error,
  CreateStaffPayload
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) =>
      api.post<StaffMember>("/api/v1/partner/staff", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.staff });
    },
  });
}

export function useUpdatePartnerStaff(): UseMutationResult<
  StaffMember,
  Error,
  { id: string; data: UpdateStaffPayload }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) =>
      api.patch<StaffMember>(`/api/v1/partner/staff/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.staff });
    },
  });
}

export function useDeletePartnerStaff(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      await api.delete<void>(`/api/v1/partner/staff/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.staff });
    },
  });
}

// ─── Court Blocks (maintenance) ──────────────────────────────────────────────

export function usePartnerBlocks(): UseQueryResult<CourtBlock[]> {
  return useQuery({
    queryKey: partnerKeys.blocks,
    queryFn: async () => {
      const res = await api.get<{ items: CourtBlock[] }>(
        "/api/v1/partner/blocks",
      );
      return res.items ?? [];
    },
    staleTime: 30_000,
  });
}

export function useCreatePartnerBlock(): UseMutationResult<
  CourtBlock,
  Error,
  CreateCourtBlockPayload
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) =>
      api.post<CourtBlock>("/api/v1/partner/blocks", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.blocks });
      qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
    },
  });
}

export function useUpdatePartnerBlock(): UseMutationResult<
  CourtBlock,
  Error,
  { id: string; data: UpdateCourtBlockPayload }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) =>
      api.patch<CourtBlock>(`/api/v1/partner/blocks/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.blocks });
      qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
    },
  });
}

export function useDeletePartnerBlock(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      await api.delete<void>(`/api/v1/partner/blocks/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.blocks });
      qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
    },
  });
}

// ─── Venue Rules ─────────────────────────────────────────────────────────────

export function usePartnerRules(): UseQueryResult<VenueRules> {
  return useQuery({
    queryKey: partnerKeys.rules,
    queryFn: async () => {
      return api.get<VenueRules>("/api/v1/partner/rules");
    },
    staleTime: 30_000,
  });
}

export function useUpdatePartnerRules(): UseMutationResult<
  VenueRules,
  Error,
  UpdateVenueRulesPayload
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.put<VenueRules>("/api/v1/partner/rules", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.rules });
      qc.invalidateQueries({ queryKey: partnerKeys.venue });
    },
  });
}

// ─── Account (credentials) ───────────────────────────────────────────────────

export function usePartnerAccount(): UseQueryResult<PartnerAccount> {
  return useQuery({
    queryKey: partnerKeys.account,
    queryFn: async () => {
      return api.get<PartnerAccount>("/api/v1/partner/account");
    },
    staleTime: 30_000,
  });
}

export function useUpdatePartnerAccount(): UseMutationResult<
  PartnerAccount,
  Error,
  UpdateAccountPayload
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) =>
      api.patch<PartnerAccount>("/api/v1/partner/account", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.account });
    },
  });
}
