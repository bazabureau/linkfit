import { z } from "zod";

export const BookingStatusEnum = z.enum([
  "pending_payment",
  "partially_paid",
  "paid",
  "cancelled",
  "refunded",
  "failed",
]);

export const PaymentSplitStatusEnum = z.enum([
  "pending",
  "authorized",
  "captured",
  "refunded",
  "failed",
]);

export const PaymentSplitSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  amount_minor: z.number().int().positive(),
  status: PaymentSplitStatusEnum,
  external_ref: z.string().nullable(),
});

export const BookingSchema = z.object({
  id: z.string().uuid(),
  game_id: z.string().uuid().nullable(),
  court_id: z.string().uuid(),
  user_id: z.string().uuid(),
  venue_id: z.string().uuid(),
  venue_name: z.string(),
  court_name: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  duration_minutes: z.number().int().positive(),
  total_minor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: BookingStatusEnum,
  idempotency_key: z.string(),
  external_ref: z.string().nullable(),
  created_at: z.string(),
  paid_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  splits: z.array(PaymentSplitSchema),
});
export type BookingResponse = z.infer<typeof BookingSchema>;

export const CreateBookingRequest = z.object({
  court_id: z.string().uuid(),
  starts_at: z.string().datetime({ offset: true }),
  duration_minutes: z.number().int().min(15).max(480),
  idempotency_key: z.string().min(8).max(200),
  game_id: z.string().uuid().nullish(),
});
export type CreateBookingRequest = z.infer<typeof CreateBookingRequest>;

export const BookingsListResponse = z.object({
  upcoming: z.array(BookingSchema),
  past: z.array(BookingSchema),
});
export type BookingsListResponse = z.infer<typeof BookingsListResponse>;

// ─────────────────────────────────────────────────────────────────────────
// Court availability — iOS booking grid asks the API which 30-minute slots
// on a given day are already taken so it can render the time-picker without
// a separate round-trip per slot.
// ─────────────────────────────────────────────────────────────────────────

/** Query for `GET /api/v1/courts/:id/availability` — `?date=YYYY-MM-DD`. */
export const CourtAvailabilityQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format"),
});
export type CourtAvailabilityQuery = z.infer<typeof CourtAvailabilityQuery>;

export const AvailabilitySlotStatusEnum = z.enum(["free", "booked"]);

export const AvailabilitySlotSchema = z.object({
  start_at: z.string(),
  end_at: z.string(),
  status: AvailabilitySlotStatusEnum,
  /** Present only when `status === "booked"`. Lets the iOS UI deep-link
   *  into the booking detail if the viewer owns it. */
  booking_id: z.string().uuid().nullable(),
});
export type AvailabilitySlot = z.infer<typeof AvailabilitySlotSchema>;

export const CourtAvailabilityResponse = z.object({
  court_id: z.string().uuid(),
  date: z.string(),
  open_hour: z.number().int().min(0).max(24),
  close_hour: z.number().int().min(0).max(24),
  slots: z.array(AvailabilitySlotSchema),
});
export type CourtAvailabilityResponse = z.infer<typeof CourtAvailabilityResponse>;
