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

import Stripe from "stripe";
import { type Logger } from "pino";
import { isPlaceholderStripeSecretKey } from "../../shared/config/stripePlaceholders.js";

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
  return isPlaceholderStripeSecretKey(secret);
}

export interface LiveStripeMembershipAdapterConfig {
  secretKey: string;
  plusPriceId: string;
  premiumPriceId: string;
  publicAppUrl: string;
  logger: Logger;
}

/** Production / staging implementation for recurring subscriptions. */
export class LiveStripeMembershipAdapter implements StripeMembershipAdapter {
  private readonly client: Stripe;
  private readonly priceByTier: Record<"plus" | "premium", string>;
  private readonly publicAppUrl: string;

  constructor(config: LiveStripeMembershipAdapterConfig) {
    this.client = new Stripe(config.secretKey, {
      apiVersion: "2026-04-22.dahlia",
      typescript: true,
      appInfo: { name: "Linkfit", version: "0.1.0" },
    });
    this.priceByTier = {
      plus: config.plusPriceId,
      premium: config.premiumPriceId,
    };
    this.publicAppUrl = config.publicAppUrl.replace(/\/+$/, "");
    this.logger = config.logger;
  }

  private readonly logger: Logger;

  async ensureCustomer(args: { email: string; user_id: string }): Promise<{ id: string }> {
    const existing = await this.client.customers.search({
      query: `metadata['linkfit_user_id']:'${args.user_id}'`,
      limit: 1,
    });
    if (existing.data[0]) {
      this.logger.debug(
        { stripe_customer_id: existing.data[0].id, user_id: args.user_id },
        "membership stripe: customer found",
      );
      return { id: existing.data[0].id };
    }

    const created = await this.client.customers.create({
      email: args.email,
      metadata: { linkfit_user_id: args.user_id },
    });
    this.logger.info(
      { stripe_customer_id: created.id, user_id: args.user_id },
      "membership stripe: customer created",
    );
    return { id: created.id };
  }

  async createCheckoutSession(args: CreateCheckoutSessionArgs): Promise<CheckoutSession> {
    const session = await this.client.checkout.sessions.create(
      {
        mode: "subscription",
        customer: args.customer_id,
        line_items: [{ price: this.priceByTier[args.tier], quantity: 1 }],
        success_url: `${this.publicAppUrl}/membership?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.publicAppUrl}/membership?checkout=cancelled`,
        metadata: {
          linkfit_kind: "membership",
          linkfit_user_id: args.user_id,
          linkfit_tier: args.tier,
        },
        subscription_data: {
          metadata: {
            linkfit_kind: "membership",
            linkfit_user_id: args.user_id,
            linkfit_tier: args.tier,
          },
        },
        allow_promotion_codes: true,
      },
      { idempotencyKey: args.idempotency_key },
    );
    if (session.url === null) {
      throw new Error("Stripe checkout session did not return a URL");
    }
    this.logger.info(
      {
        stripe_customer_id: args.customer_id,
        session_id: session.id,
        tier: args.tier,
      },
      "membership stripe: checkout session created",
    );
    return { id: session.id, url: session.url };
  }

  async cancelAtPeriodEnd(subscriptionId: string): Promise<void> {
    await this.client.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  }

  async createBillingPortalSession(
    args: CreateBillingPortalSessionArgs,
  ): Promise<BillingPortalSession> {
    const session = await this.client.billingPortal.sessions.create({
      customer: args.customer_id,
      return_url: args.return_url,
    });
    return { id: session.id, url: session.url };
  }
}
