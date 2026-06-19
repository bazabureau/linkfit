import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  ForbiddenError,
  PreconditionFailedError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import {
  type MembershipBenefit,
  type MembershipState,
  type MembershipTier,
  type PaidTier,
  type StripeWebhookEvent,
  type SubscribeResponse,
  type CancelResponse,
} from "./membership.schema.js";

/** Shape returned by `createPortalSession`. Mirrored in the routes file
 *  as a Zod schema for the response envelope. */
export interface PortalResponse {
  url: string;
}
import {
  isPlaceholderStripeKey,
  type StripeMembershipAdapter,
} from "./stripe-adapter.js";

export interface MembershipServiceDeps {
  db: DbHandle;
  stripe: StripeMembershipAdapter;
  logger: Logger;
  /** Caller pipes the env value here so the service can detect demo mode
   *  on its own — keeps env reads out of the route handler. */
  stripeSecretKey: string;
  /** Public app/web origin used as the Stripe portal return URL. */
  publicAppUrl: string;
}

/** AZN pricing in qəpik (minor units). Free is zero; the two paid tiers
 *  match the spec: 9.99 ₼ / 19.99 ₼ per month. */
const TIER_PRICE_MINOR: Record<MembershipTier, number> = {
  free: 0,
  plus: 999,
  premium: 1999,
};

const CURRENCY = "AZN";

/** Server-authoritative unlock matrix. The `key` strings double as iOS
 *  icon mapping hints (the client maps key → SF Symbol). Order matters —
 *  the client renders top-down. */
const BENEFITS_BY_TIER: Record<MembershipTier, MembershipBenefit[]> = {
  free: [
    { key: "basic_booking", label: "Basic court booking" },
    { key: "join_games", label: "Join public games" },
  ],
  plus: [
    { key: "unlimited_bookings", label: "Unlimited bookings per month" },
    { key: "ad_free", label: "Ad-free experience" },
    { key: "early_tournament_access", label: "Early-access to tournaments" },
    { key: "join_games", label: "Join public games" },
  ],
  premium: [
    { key: "unlimited_bookings", label: "Unlimited bookings per month" },
    { key: "ad_free", label: "Ad-free experience" },
    { key: "early_tournament_access", label: "Early-access to tournaments" },
    { key: "coach_on_demand", label: "Coach on demand (coming soon)" },
    { key: "custom_badge", label: "Custom Premium badge" },
  ],
};

/** Demo-mode grant length. We tie it to the spec ("immediately flips the
 *  row to the target tier with current_period_end = NOW() + 30 days") so
 *  the renewal cycle is observable in the iOS UI without real Stripe. */
const DEMO_PERIOD_DAYS = 30;

/**
 * Owns the recurring-subscription side of membership.
 *
 * Reads:    GET /api/v1/me/membership
 * Mutates:  POST /api/v1/membership/subscribe, POST /api/v1/membership/cancel
 * Webhook:  customer.subscription.created / .updated / .deleted
 *
 * The webhook handler is idempotent on the Stripe event id (deduped in the
 * payments module's `stripe_webhook_events` table — we share that table
 * rather than re-introduce a parallel log). When the table doesn't exist
 * in a particular test setup the service just skips the dedupe row.
 */
export class MembershipService {
  constructor(private readonly deps: MembershipServiceDeps) {}

  /** True when the env still carries the placeholder Stripe secret. */
  get isDemoMode(): boolean {
    return isPlaceholderStripeKey(this.deps.stripeSecretKey);
  }

  /** Idempotent. Reads the user's membership row, lazily creating a `free`
   *  default if missing. The migration backfills existing users but a brand
   *  new account inserted after the migration ran also needs a row. */
  async getState(userId: string): Promise<MembershipState> {
    await this.ensureRow(userId);
    const row = await this.deps.db.db
      .selectFrom("memberships")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow();

    const tier: MembershipTier = row.tier;
    return {
      tier,
      current_period_end: row.current_period_end?.toISOString() ?? null,
      cancel_at_period_end: row.cancel_at_period_end,
      benefits: BENEFITS_BY_TIER[tier],
      price_minor: TIER_PRICE_MINOR[tier],
      currency: CURRENCY,
    };
  }

  /**
   * Subscribe to a paid tier.
   *
   * In live mode we create a Stripe Checkout Session and hand the URL
   * back to the iOS client; the row flips to `plus`/`premium` only after
   * Stripe POSTs the `customer.subscription.created` webhook.
   *
   * In demo mode (placeholder Stripe key) we skip Stripe entirely and
   * flip the row server-side with a 30-day grant. iOS shows a success
   * toast and re-fetches the state.
   */
  async subscribe(userId: string, tier: PaidTier): Promise<SubscribeResponse> {
    const user = await this.deps.db.db
      .selectFrom("users")
      .select(["id", "email"])
      .where("id", "=", userId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!user) throw new ForbiddenError("User not found");

    await this.ensureRow(userId);

    if (this.isDemoMode) {
      const periodEnd = new Date(Date.now() + DEMO_PERIOD_DAYS * 24 * 60 * 60 * 1000);
      await this.deps.db.db
        .updateTable("memberships")
        .set({
          tier,
          current_period_end: periodEnd,
          cancel_at_period_end: false,
        })
        .where("user_id", "=", userId)
        .execute();
      this.deps.logger.info(
        { user_id: userId, tier },
        "membership: demo-mode upgrade",
      );
      return {
        mode: "demo",
        checkout_url: null,
        tier,
        current_period_end: periodEnd.toISOString(),
      };
    }

    // Live mode — talk to Stripe.
    const customer = await this.ensureStripeCustomer(userId, user.email);
    const session = await this.deps.stripe.createCheckoutSession({
      customer_id: customer.id,
      tier,
      user_id: userId,
      // Stripe dedupes retried Checkout Session creates on this key —
      // safe because if the user taps Upgrade twice, the second call
      // should reuse the first URL rather than mint a parallel session.
      idempotency_key: `membership:${userId}:${tier}`,
    });

    return {
      mode: "checkout",
      checkout_url: session.url,
      tier,
      current_period_end: null,
    };
  }

  /**
   * Cancel — flips `cancel_at_period_end=true`. The user keeps their tier
   * until `current_period_end`; the webhook flips it back to `free` when
   * Stripe sends `customer.subscription.deleted`.
   *
   * In demo mode we still flip the local flag but never expect a
   * follow-up webhook. The next renewal would have to be triggered by
   * the migration to live Stripe — acceptable for a placeholder build.
   */
  async cancel(userId: string): Promise<CancelResponse> {
    await this.ensureRow(userId);
    const row = await this.deps.db.db
      .selectFrom("memberships")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow();

    if (row.tier === "free") {
      throw new ValidationError("No active subscription to cancel");
    }

    // Best-effort Stripe call. We tolerate failure (log + continue) so a
    // transient Stripe outage doesn't block the user from telling us they
    // want to leave — the eventual reconciliation job can retry.
    if (!this.isDemoMode && row.stripe_subscription_id) {
      try {
        await this.deps.stripe.cancelAtPeriodEnd(row.stripe_subscription_id);
      } catch (err) {
        this.deps.logger.error(
          { err, user_id: userId },
          "membership: stripe cancelAtPeriodEnd failed",
        );
      }
    }

    await this.deps.db.db
      .updateTable("memberships")
      .set({ cancel_at_period_end: true })
      .where("user_id", "=", userId)
      .execute();

    return {
      tier: row.tier,
      cancel_at_period_end: true,
      current_period_end: row.current_period_end?.toISOString() ?? null,
    };
  }

  /**
   * Mint a Stripe Customer Portal session URL. iOS opens the URL in
   * Safari so the member can update their card, cancel, or download
   * invoices on Stripe-hosted UI — keeping us out of PCI scope and
   * preserving the platform's compliance with Stripe's billing UX.
   *
   * Returns 422 (PreconditionFailedError) when the caller has no Stripe
   * Customer on file — that means they never subscribed and there's
   * nothing for them to manage. The iOS client surfaces that as a toast
   * pointing the user at the Upgrade flow.
   *
   * The return URL is injected from the typed server env so the
   * membership-screen deep link (`/membership`) always resolves without
   * relying on process-global state.
   */
  async createPortalSession(userId: string): Promise<PortalResponse> {
    const row = await this.deps.db.db
      .selectFrom("memberships")
      .select(["stripe_customer_id"])
      .where("user_id", "=", userId)
      .executeTakeFirst();
    const customerId = row?.stripe_customer_id;
    if (!customerId) {
      // No Stripe customer means the user never went through checkout.
      // Returning 422 makes the failure surface cleanly to iOS without
      // looking like an auth or routing bug.
      throw new PreconditionFailedError("No subscription to manage");
    }

    // The adapter is allowed to be the demo-mode placeholder which has
    // no `createBillingPortalSession`. Surface that as the same 422 —
    // there is, functionally, no real subscription to manage when the
    // backend is wired to a placeholder Stripe adapter.
    if (typeof this.deps.stripe.createBillingPortalSession !== "function") {
      this.deps.logger.warn(
        { user_id: userId },
        "membership: portal requested but adapter has no createBillingPortalSession",
      );
      throw new PreconditionFailedError("No subscription to manage");
    }

    const returnUrl = `${this.deps.publicAppUrl.replace(/\/+$/, "")}/membership`;
    const session = await this.deps.stripe.createBillingPortalSession({
      customer_id: customerId,
      return_url: returnUrl,
    });
    this.deps.logger.info(
      { user_id: userId, stripe_customer_id: customerId, session_id: session.id },
      "membership: portal session minted",
    );
    return { url: session.url };
  }

  /**
   * Webhook dispatch. The router strips the raw payload off `req.body`
   * and hands us the parsed event. We handle three event types and
   * ignore the rest (Stripe sends 50+ event types; the membership
   * module only cares about subscription lifecycle).
   *
   * Idempotency: we dedupe on event id by inserting into
   * `stripe_webhook_events` after the handler runs. If the insert fails
   * with a UNIQUE-violation we know the event was already processed and
   * swallow the error — Stripe redelivers events that didn't 2xx.
   */
  async handleWebhookEvent(event: StripeWebhookEvent): Promise<{ handled: boolean }> {
    // De-dupe on event id — same pattern as the payments module.
    const replay = await this.deps.db.db
      .selectFrom("stripe_webhook_events")
      .select("id")
      .where("id", "=", event.id)
      .executeTakeFirst()
      .catch(() => undefined);
    if (replay) {
      this.deps.logger.debug({ event_id: event.id }, "membership webhook: duplicate event ignored");
      return { handled: false };
    }

    let handled = false;
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await this.onSubscriptionUpsert(event.data.object);
        handled = true;
        break;
      case "customer.subscription.deleted":
        await this.onSubscriptionDeleted(event.data.object);
        handled = true;
        break;
      default:
        this.deps.logger.debug(
          { event_type: event.type },
          "membership webhook: event type ignored",
        );
        break;
    }

    try {
      await this.deps.db.db
        .insertInto("stripe_webhook_events")
        .values({ id: event.id, type: event.type })
        .execute();
    } catch (err) {
      // 23505 = unique_violation — parallel webhook delivery. Safe to swallow.
      const code = (err as { code?: string } | null)?.code;
      if (code !== "23505") {
        this.deps.logger.error(
          { err, event_id: event.id },
          "membership webhook: stamp failed",
        );
      }
    }
    return { handled };
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private async ensureRow(userId: string): Promise<void> {
    await this.deps.db.db
      .insertInto("memberships")
      .values({ user_id: userId, tier: "free", cancel_at_period_end: false })
      .onConflict((oc) => oc.column("user_id").doNothing())
      .execute();
  }

  private async ensureStripeCustomer(
    userId: string,
    email: string,
  ): Promise<{ id: string }> {
    const row = await this.deps.db.db
      .selectFrom("memberships")
      .select(["stripe_customer_id"])
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (row?.stripe_customer_id) return { id: row.stripe_customer_id };

    const customer = await this.deps.stripe.ensureCustomer({ email, user_id: userId });
    await this.deps.db.db
      .updateTable("memberships")
      .set({ stripe_customer_id: customer.id })
      .where("user_id", "=", userId)
      .execute();
    return customer;
  }

  /**
   * Apply a Stripe Subscription payload to the local row. The object is
   * an `unknown`-shaped record because we receive it through the webhook
   * Zod schema; pulling fields off it requires narrow type guards.
   */
  private async onSubscriptionUpsert(obj: Record<string, unknown>): Promise<void> {
    const subscriptionId = asString(obj.id);
    const customerId = asString(obj.customer);
    if (!subscriptionId || !customerId) return;

    const userId = readMetadataUserId(obj);
    if (!userId) {
      this.deps.logger.warn(
        { subscription_id: subscriptionId },
        "membership webhook: subscription missing user_id metadata",
      );
      return;
    }

    const tier = readMetadataTier(obj);
    const status = asString(obj.status) ?? "active";
    const periodEnd = readPeriodEnd(obj);
    const cancelAtPeriodEnd = obj.cancel_at_period_end === true;

    // Stripe statuses we treat as "subscription gives access". Anything
    // else (incomplete, past_due, unpaid, canceled) collapses to free.
    const activeStatuses = new Set(["trialing", "active"]);
    const effectiveTier: MembershipTier =
      activeStatuses.has(status) && tier ? tier : "free";

    await this.ensureRow(userId);
    await this.deps.db.db
      .updateTable("memberships")
      .set({
        tier: effectiveTier,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        current_period_end: periodEnd,
        cancel_at_period_end: cancelAtPeriodEnd,
      })
      .where("user_id", "=", userId)
      .execute();
    this.deps.logger.info(
      { user_id: userId, tier: effectiveTier, status },
      "membership webhook: row synced",
    );
  }

  private async onSubscriptionDeleted(obj: Record<string, unknown>): Promise<void> {
    const subscriptionId = asString(obj.id);
    if (!subscriptionId) return;

    await this.deps.db.db
      .updateTable("memberships")
      .set({
        tier: "free",
        stripe_subscription_id: null,
        current_period_end: null,
        cancel_at_period_end: false,
      })
      .where("stripe_subscription_id", "=", subscriptionId)
      .execute();
    this.deps.logger.info({ subscription_id: subscriptionId }, "membership webhook: downgraded to free");
  }
}

// ── Small typed readers for the webhook object bag ───────────────────

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function readMetadataUserId(obj: Record<string, unknown>): string | null {
  const md = obj.metadata;
  if (md && typeof md === "object") {
    const userId = (md as Record<string, unknown>).linkfit_user_id;
    if (typeof userId === "string") return userId;
  }
  return null;
}

function readMetadataTier(obj: Record<string, unknown>): "plus" | "premium" | null {
  const md = obj.metadata;
  if (md && typeof md === "object") {
    const tier = (md as Record<string, unknown>).linkfit_tier;
    if (tier === "plus" || tier === "premium") return tier;
  }
  return null;
}

function readPeriodEnd(obj: Record<string, unknown>): Date | null {
  const raw = obj.current_period_end;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    // Stripe returns Unix seconds; convert to milliseconds.
    return new Date(raw * 1000);
  }
  return null;
}
