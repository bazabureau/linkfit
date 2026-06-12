import { z } from "zod";

/** PaymentSheet bundle returned by every intent-creation endpoint. The iOS
 *  app passes these three opaque strings into Stripe's `STPPaymentSheet`. */
export const PaymentSheetResponseSchema = z.object({
  payment_intent_id: z.string().min(1),
  client_secret: z.string().min(1),
  ephemeral_key: z.string(),
  customer_id: z.string().min(1),
  /** Optional hint so the iOS app can warn on key mismatch in dev builds.
   *  Always `null` for now — the real publishable key lives on-device. */
  publishable_key_hint: z.string().nullable(),
});
export type PaymentSheetResponse = z.infer<typeof PaymentSheetResponseSchema>;

/** Booking-intent response — extends PaymentSheet with the amount/currency
 *  echo and a booking_id back-reference so the iOS layer doesn't have to
 *  thread state across the create call. */
export const BookingIntentResponseSchema = PaymentSheetResponseSchema.extend({
  booking_id: z.string().uuid(),
  amount_minor: z.number().int().nonnegative(),
  currency: z.string().min(3).max(3),
});
export type BookingIntentResponse = z.infer<typeof BookingIntentResponseSchema>;

/** Status snapshot used by `GET /api/v1/payments/booking/:id/status`. iOS
 *  polls this after PaymentSheet returns to confirm the webhook landed. */
export const BookingPaymentStatusSchema = z.object({
  status: z.enum(["pending", "succeeded", "failed"]),
  paid_at: z.string().datetime().optional(),
});
export type BookingPaymentStatus = z.infer<typeof BookingPaymentStatusSchema>;

/** Body for `POST /api/v1/payments/tournament/:id/entry-intent`. The squad
 *  composition is captured at intent time and replayed by the webhook when
 *  the charge succeeds. Validation mirrors `RegisterSquadRequest` in the
 *  tournaments module so the two paths cannot diverge silently. */
export const CreateTournamentIntentRequest = z.object({
  squad_name: z.string().min(2).max(80),
  player_ids: z.array(z.string().uuid()).max(11),
});
export type CreateTournamentIntentRequest = z.infer<typeof CreateTournamentIntentRequest>;

export const WebhookAck = z.object({ received: z.boolean() });
