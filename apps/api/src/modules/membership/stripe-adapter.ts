/**
 * Local Stripe adapter for the Membership module.
 *
 * Why this exists at all when the Payments agent already ships a
 * `StripeGateway` interface: scope. The PaymentSheet flow they own is
 * one-shot PaymentIntents tied to bookings + tournament entries. A
 * recurring subscription needs *Customer*, *Price*, *Subscription* and
 * *Checkout Session* APIs that don't show up in their gateway.
 *
 * Rather than mutate the Payments agent's exclusive files, we define our
 * own minimal facade here. In production a thin wrapper around the real
 * `Stripe` SDK fills it in; in tests we hand the service a deterministic
 * fake. The interface is tight on purpose — keep the surface area small,
 * keep the test doubles trivial.
 */

export interface CreateCheckoutSessionArgs {
  /** Stripe Customer id — we attach the subscription to a stable Customer
   *  so the iOS PaymentSheet path can later swap to "manage subscription". */
  customer_id: string;
  /** Logical tier; the adapter maps to its Stripe Price id internally. */
  tier: "plus" | "premium";
  /** Linkfit user id stamped into the session metadata so the webhook can
   *  route the resulting subscription back to the right row. */
  user_id: string;
  /** Per-attempt idempotency key — Stripe deduplicates retried creates. */
  idempotency_key: string;
}

export interface CheckoutSession {
  /** URL the iOS app opens (Safari / SFSafariViewController / PaymentSheet
   *  in subscription mode). Stripe returns this from `checkout.sessions.create`. */
  url: string;
  /** Stripe session id. We don't persist it — it expires in 24h — but it's
   *  useful for logging. */
  id: string;
}

export interface CreateBillingPortalSessionArgs {
  /** Stripe Customer id — the portal is bound to a single customer. */
  customer_id: string;
  /** Where Stripe redirects after the user closes the portal. iOS opens
   *  the portal URL in Safari and returns to the membership screen. */
  return_url: string;
}

export interface BillingPortalSession {
  /** URL iOS opens in Safari. Single-use; expires shortly after creation. */
  url: string;
  /** Stripe session id, used only for log correlation. */
  id: string;
}

export interface StripeMembershipAdapter {
  /** Find-or-create a Stripe Customer for the Linkfit user. The
   *  membership module owns its own row in `memberships.stripe_customer_id`
   *  rather than reusing the Payments agent's `stripe_customers` table —
   *  the two tables can drift independently and that's fine. */
  ensureCustomer(args: { email: string; user_id: string }): Promise<{ id: string }>;
  /** Mint a Stripe Checkout Session (`mode: 'subscription'`) for the given
   *  tier and return the redirect URL. */
  createCheckoutSession(args: CreateCheckoutSessionArgs): Promise<CheckoutSession>;
  /** Mark a Stripe Subscription for cancellation at the end of the current
   *  billing period. Subscriptions stay active until `current_period_end`. */
  cancelAtPeriodEnd(subscriptionId: string): Promise<void>;
  /** Mint a Customer Portal session so the member can self-manage their
   *  subscription (update card, cancel, download invoices). Optional so
   *  the demo-mode placeholder + existing test fakes keep compiling — the
   *  service surfaces a 422 when the wired adapter doesn't implement it. */
  createBillingPortalSession?(
    args: CreateBillingPortalSessionArgs,
  ): Promise<BillingPortalSession>;
}

/**
 * Detect whether the live Stripe key is real or the placeholder bundled
 * in test/dev envs. We don't want to mint Checkout Sessions against a
 * fake key — when the key is a placeholder we run the demo-mode path
 * that flips the membership row server-side.
 */
export function isPlaceholderStripeKey(secret: string): boolean {
  if (secret.length === 0) return true;
  return secret === "sk_test_dummy" || secret === "sk_live_dummy";
}
