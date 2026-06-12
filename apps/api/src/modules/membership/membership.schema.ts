import { z } from "zod";

/**
 * Membership schemas — request + response shapes for the three public
 * routes (subscribe, cancel, GET /me/membership) plus the webhook payload.
 *
 * Tiers are mirrored on the iOS side with the same string values so JSON
 * decoding is a straight pass-through.
 */

export const MembershipTier = z.enum(["free", "plus", "premium"]);
export type MembershipTier = z.infer<typeof MembershipTier>;

/** Paid tiers — Stripe checkout is only valid for these. */
export const PaidTier = z.enum(["plus", "premium"]);
export type PaidTier = z.infer<typeof PaidTier>;

export const SubscribeBody = z.object({
  tier: PaidTier,
});
export type SubscribeBody = z.infer<typeof SubscribeBody>;

/**
 * Response from POST /membership/subscribe. Two shapes share the schema:
 *
 *   - Live mode: Stripe returns a Checkout Session URL; the client opens
 *     it in PaymentSheet / Safari. `mode='checkout'`.
 *   - Demo mode (no real Stripe key): the server flips the row directly
 *     and returns the new state. `mode='demo'`. iOS shows a success toast.
 */
export const SubscribeResponse = z.object({
  mode: z.enum(["checkout", "demo"]),
  checkout_url: z.string().nullable(),
  tier: MembershipTier,
  current_period_end: z.string().nullable(), // ISO-8601
});
export type SubscribeResponse = z.infer<typeof SubscribeResponse>;

export const CancelResponse = z.object({
  tier: MembershipTier,
  cancel_at_period_end: z.boolean(),
  current_period_end: z.string().nullable(),
});
export type CancelResponse = z.infer<typeof CancelResponse>;

/** Benefit row exposed to the client — server-side authoritative copy so
 *  the iOS app doesn't have to hardcode the unlock matrix. */
export const MembershipBenefit = z.object({
  key: z.string(), // stable identifier, used for icon mapping on iOS
  label: z.string(),
});
export type MembershipBenefit = z.infer<typeof MembershipBenefit>;

export const MembershipState = z.object({
  tier: MembershipTier,
  current_period_end: z.string().nullable(),
  cancel_at_period_end: z.boolean(),
  benefits: z.array(MembershipBenefit),
  /** Monthly price in minor units (qəpik for AZN). Free is 0. */
  price_minor: z.number().int().nonnegative(),
  currency: z.string(),
});
export type MembershipState = z.infer<typeof MembershipState>;

/**
 * Stripe webhook payload. We accept a permissive shape here — the real
 * verification happens via the gateway's `constructEvent` (HMAC against
 * the webhook secret). The Zod schema is just enough to route the event.
 */
export const StripeWebhookEvent = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({
    object: z.record(z.unknown()),
  }),
});
export type StripeWebhookEvent = z.infer<typeof StripeWebhookEvent>;
