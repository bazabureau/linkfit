import { z } from "zod";

export const PartnerVenueSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  address: z.string(),
  phone: z.string().nullable(),
  photo_url: z.string().nullable(),
  created_at: z.string(),
});
export type PartnerVenueSchema = z.infer<typeof PartnerVenueSchema>;

export const PartnerVenueUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  address: z.string().min(1).max(255).optional(),
  phone: z.string().max(50).optional(),
  photo_url: z.string().url().max(1000).optional(),
});
export type PartnerVenueUpdateSchema = z.infer<typeof PartnerVenueUpdateSchema>;

export const PartnerCourtSchema = z.object({
  id: z.string().uuid(),
  venue_id: z.string().uuid(),
  sport_id: z.string().uuid(),
  sport_slug: z.string(),
  name: z.string(),
  hourly_price_minor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  created_at: z.string(),
});
export type PartnerCourtSchema = z.infer<typeof PartnerCourtSchema>;

export const PartnerCourtCreateSchema = z.object({
  sport_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  hourly_price_minor: z.number().int().nonnegative().max(100_000_00),
  currency: z.string().length(3).optional(),
});
export type PartnerCourtCreateSchema = z.infer<typeof PartnerCourtCreateSchema>;

export const PartnerCourtUpdateSchema = z.object({
  sport_id: z.string().uuid().optional(),
  name: z.string().min(1).max(120).optional(),
  hourly_price_minor: z.number().int().nonnegative().max(100_000_00).optional(),
  currency: z.string().length(3).optional(),
});
export type PartnerCourtUpdateSchema = z.infer<typeof PartnerCourtUpdateSchema>;

export const PartnerBookingStatusEnum = z.enum([
  "pending_payment",
  "partially_paid",
  "paid",
  "cancelled",
  "refunded",
  "failed",
]);

export type PartnerBookingStatusValue = z.infer<typeof PartnerBookingStatusEnum>;

export const PartnerBookingRowSchema = z.object({
  id: z.string().uuid(),
  game_id: z.string().uuid().nullable(),
  court_id: z.string().uuid(),
  court_name: z.string(),
  user_id: z.string().uuid(),
  booker_display_name: z.string(),
  booker_email: z.string(),
  venue_id: z.string().uuid(),
  venue_name: z.string(),
  starts_at: z.string(),
  duration_minutes: z.number().int().positive(),
  total_minor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: PartnerBookingStatusEnum,
  idempotency_key: z.string(),
  external_ref: z.string().nullable(),
  created_at: z.string(),
  paid_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
});
export type PartnerBookingRowSchema = z.infer<typeof PartnerBookingRowSchema>;

export const PartnerBookingsListQuery = z.object({
  status: PartnerBookingStatusEnum.optional(),
  court_id: z.string().uuid().optional(),
  q: z.string().min(1).max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type PartnerBookingsListQuery = z.infer<typeof PartnerBookingsListQuery>;

export const PartnerBookingsListResponse = z.object({
  items: z.array(PartnerBookingRowSchema),
  total: z.number().int().nonnegative(),
});
export type PartnerBookingsListResponse = z.infer<typeof PartnerBookingsListResponse>;

export const PartnerStatsResponse = z.object({
  total_bookings: z.number().int().nonnegative(),
  paid_bookings: z.number().int().nonnegative(),
  pending_bookings: z.number().int().nonnegative(),
  cancelled_bookings: z.number().int().nonnegative(),
  total_revenue_minor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  occupancy_rate: z.number().nonnegative(),
});
export type PartnerStatsResponse = z.infer<typeof PartnerStatsResponse>;

export const PartnerBookingCreateSchema = z.object({
  court_id: z.string().uuid(),
  starts_at: z.string().datetime(),
  duration_minutes: z.number().int().min(15).max(480),
  booker_display_name: z.string().min(1).max(80),
  booker_email: z.string().email().max(254),
  idempotency_key: z.string().min(8).max(200),
});
export type PartnerBookingCreateSchema = z.infer<typeof PartnerBookingCreateSchema>;
