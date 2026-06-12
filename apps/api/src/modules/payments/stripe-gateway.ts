import Stripe from "stripe";
import { type Logger } from "pino";

/**
 * Thin facade over the Stripe SDK. Wrapping the four calls we use behind
 * an interface keeps integration tests honest — they swap in a fake sender
 * that never touches the network. The real `LiveStripeGateway` only ships
 * to production / staging.
 *
 * We deliberately keep this surface tiny: PaymentSheet on iOS needs three
 * things from the backend — a PaymentIntent client_secret, an ephemeral
 * customer key, and the Stripe customer id. Webhook verification round-trips
 * back to the SDK via `constructEvent`, which is the *only* secure way to
 * authenticate Stripe traffic.
 */
export interface PaymentSheetCredentials {
  payment_intent_id: string;
  client_secret: string;
  ephemeral_key: string;
  customer_id: string;
}

export interface CreatePaymentIntentArgs {
  customer_id: string;
  amount_minor: number;
  currency: string;
  /** Free-form metadata copied into the PaymentIntent for webhook routing.
   *  Keys/values must be strings; Stripe rejects anything else. */
  metadata: Record<string, string>;
  /** Stable per-attempt key — Stripe deduplicates retried requests by this
   *  value so a flaky network can't mint two intents for the same booking. */
  idempotency_key: string;
}

/** Arguments for minting a Stripe Customer Portal session. The portal is a
 *  Stripe-hosted page where members manage payment methods, view invoices
 *  and cancel/resume subscriptions — we never collect that data ourselves. */
export interface CreateBillingPortalSessionArgs {
  /** Stripe Customer id we created during checkout. */
  customer_id: string;
  /** Where Stripe sends the user when they close the portal — iOS opens this
   *  URL in Safari so we land them back on the membership screen. */
  return_url: string;
}

export interface BillingPortalSession {
  /** URL the iOS app opens in Safari / SFSafariViewController. */
  url: string;
  /** Stripe session id. Useful for logs; the URL itself is single-use. */
  id: string;
}

export interface StripeGateway {
  /** Find-or-create a Stripe Customer for the Linkfit user. Returning the
   *  caller-supplied email keeps the Customer's contact info fresh without
   *  a second API call. */
  ensureCustomer(args: { email: string; user_id: string }): Promise<{ id: string }>;
  /** Mint an ephemeral key bound to the Customer — required by
   *  PaymentSheet to render saved cards. */
  createEphemeralKey(customer_id: string): Promise<{ secret: string }>;
  /** Create a PaymentIntent and return the iOS-facing credentials. */
  createPaymentIntent(args: CreatePaymentIntentArgs): Promise<PaymentSheetCredentials>;
  /** Mint a Stripe Customer Portal session so members can self-manage
   *  their subscription. iOS opens the returned URL in Safari. Optional
   *  so legacy test fakes that don't exercise the membership module can
   *  keep implementing the interface without stubbing this out. */
  createBillingPortalSession?(args: CreateBillingPortalSessionArgs): Promise<BillingPortalSession>;
  /** Verify and parse a webhook payload. Throws on signature mismatch. */
  constructEvent(payload: Buffer, signature: string): Stripe.Event;
}

/** Production / staging implementation. */
export class LiveStripeGateway implements StripeGateway {
  private readonly client: Stripe;
  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    private readonly logger: Logger,
  ) {
    this.client = new Stripe(secretKey, {
      // Pin the API version explicitly so a Stripe-side change doesn't
      // silently break our integration. Bump this consciously.
      apiVersion: "2026-04-22.dahlia",
      typescript: true,
      appInfo: { name: "Linkfit", version: "0.1.0" },
    });
  }

  async ensureCustomer(args: { email: string; user_id: string }): Promise<{ id: string }> {
    // Search by metadata.user_id — every Customer we create stamps that
    // for round-trip lookup. If none, create. (We persist the id locally in
    // `stripe_customers` so this path runs at most once per user.)
    const existing = await this.client.customers.search({
      query: `metadata['linkfit_user_id']:'${args.user_id}'`,
      limit: 1,
    });
    if (existing.data[0]) {
      this.logger.debug({ stripe_customer_id: existing.data[0].id }, "stripe: customer found");
      return { id: existing.data[0].id };
    }
    const created = await this.client.customers.create({
      email: args.email,
      metadata: { linkfit_user_id: args.user_id },
    });
    this.logger.info({ stripe_customer_id: created.id }, "stripe: customer created");
    return { id: created.id };
  }

  async createEphemeralKey(customer_id: string): Promise<{ secret: string }> {
    const key = await this.client.ephemeralKeys.create(
      { customer: customer_id },
      // Match the Stripe API version PaymentSheet expects on iOS. Setting
      // this lower than `apiVersion` is required by the SDK — PaymentSheet
      // pins its own version internally.
      { apiVersion: "2024-04-10" },
    );
    return { secret: key.secret ?? "" };
  }

  async createPaymentIntent(args: CreatePaymentIntentArgs): Promise<PaymentSheetCredentials> {
    const intent = await this.client.paymentIntents.create(
      {
        customer: args.customer_id,
        amount: args.amount_minor,
        currency: args.currency.toLowerCase(),
        // `automatic_payment_methods` lets Stripe pick (card, Apple Pay, …)
        // based on the Customer + dashboard config. Tougher to misconfigure
        // than a hand-typed list.
        automatic_payment_methods: { enabled: true },
        metadata: args.metadata,
      },
      { idempotencyKey: args.idempotency_key },
    );
    return {
      payment_intent_id: intent.id,
      client_secret: intent.client_secret ?? "",
      ephemeral_key: "", // filled in by caller via createEphemeralKey
      customer_id: args.customer_id,
    };
  }

  async createBillingPortalSession(
    args: CreateBillingPortalSessionArgs,
  ): Promise<BillingPortalSession> {
    const session = await this.client.billingPortal.sessions.create({
      customer: args.customer_id,
      return_url: args.return_url,
    });
    this.logger.info(
      { stripe_customer_id: args.customer_id, session_id: session.id },
      "stripe: billing portal session created",
    );
    return { id: session.id, url: session.url };
  }

  constructEvent(payload: Buffer, signature: string): Stripe.Event {
    return this.client.webhooks.constructEvent(payload, signature, this.webhookSecret);
  }
}
