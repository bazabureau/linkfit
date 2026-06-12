import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  type CheckoutSession,
  type CreateCheckoutSessionArgs,
  type StripeMembershipAdapter,
} from "./stripe-adapter.js";
import {
  type CancelResponse,
  type MembershipState,
  type SubscribeResponse,
} from "./membership.schema.js";

/**
 * In-memory fake of the Stripe adapter. Captures each call so tests can
 * assert the membership service drives Stripe the way we expect.
 */
class FakeStripeAdapter implements StripeMembershipAdapter {
  ensureCustomerCalls: { email: string; user_id: string }[] = [];
  checkoutCalls: CreateCheckoutSessionArgs[] = [];
  cancelCalls: string[] = [];

  ensureCustomer = (args: { email: string; user_id: string }) => {
    this.ensureCustomerCalls.push(args);
    return Promise.resolve({ id: `cus_test_${args.user_id}` });
  };
  createCheckoutSession = (args: CreateCheckoutSessionArgs): Promise<CheckoutSession> => {
    this.checkoutCalls.push(args);
    return Promise.resolve({
      id: `cs_test_${args.user_id}_${args.tier}`,
      url: `https://checkout.stripe.test/${args.user_id}/${args.tier}`,
    });
  };
  cancelAtPeriodEnd = (id: string) => {
    this.cancelCalls.push(id);
    return Promise.resolve();
  };
}

describe("Membership module", () => {
  let app: LinkfitServer;
  let db: DbHandle;
  let stripe: FakeStripeAdapter;

  beforeAll(async () => {
    db = buildTestDb();
    stripe = new FakeStripeAdapter();
    // Demo-mode environment: STRIPE_SECRET_KEY remains the placeholder.
    // We still inject the fake adapter so live-mode tests can flip the
    // env on a per-suite basis when needed.
    const env = buildTestEnv();
    app = await buildServer({
      env,
      logger: pino({ level: "silent" }),
      db,
      membershipStripe: stripe,
    });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
    stripe.ensureCustomerCalls = [];
    stripe.checkoutCalls = [];
    stripe.cancelCalls = [];
  });

  it("requires auth on GET /me/membership", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/me/membership" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the default `free` tier for a brand-new account", async () => {
    const user = await createTestUser(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/membership",
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<MembershipState>();
    expect(body.tier).toBe("free");
    expect(body.price_minor).toBe(0);
    expect(body.currency).toBe("AZN");
    expect(body.cancel_at_period_end).toBe(false);
    expect(body.current_period_end).toBeNull();
    // Free still gets a benefit list — the iOS card renders it.
    expect(body.benefits.length).toBeGreaterThan(0);
    expect(body.benefits.some((b) => b.key === "join_games")).toBe(true);
  });

  it("subscribe in demo mode flips the row + skips Stripe entirely", async () => {
    const user = await createTestUser(app);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/membership/subscribe",
      headers: { authorization: `Bearer ${user.access_token}` },
      payload: { tier: "plus" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<SubscribeResponse>();
    expect(body.mode).toBe("demo");
    expect(body.checkout_url).toBeNull();
    expect(body.tier).toBe("plus");
    expect(body.current_period_end).toBeTruthy();

    // No Stripe calls should have happened — we're in demo mode.
    expect(stripe.checkoutCalls).toHaveLength(0);
    expect(stripe.ensureCustomerCalls).toHaveLength(0);

    // The state reflects the new tier on the next read.
    const state = await app
      .inject({
        method: "GET",
        url: "/api/v1/me/membership",
        headers: { authorization: `Bearer ${user.access_token}` },
      })
      .then((r) => r.json<MembershipState>());
    expect(state.tier).toBe("plus");
    expect(state.price_minor).toBe(999);
    expect(state.benefits.some((b) => b.key === "unlimited_bookings")).toBe(true);
    expect(state.benefits.some((b) => b.key === "ad_free")).toBe(true);

    // Period end should be ~30 days in the future (5 minute window).
    const end = new Date(state.current_period_end!).getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(end).toBeGreaterThan(Date.now() + thirtyDays - 5 * 60 * 1000);
    expect(end).toBeLessThan(Date.now() + thirtyDays + 5 * 60 * 1000);
  });

  it("subscribe rejects an invalid tier value", async () => {
    const user = await createTestUser(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/membership/subscribe",
      headers: { authorization: `Bearer ${user.access_token}` },
      payload: { tier: "free" }, // free isn't a paid tier
    });
    expect(res.statusCode).toBe(400);

    const bogus = await app.inject({
      method: "POST",
      url: "/api/v1/membership/subscribe",
      headers: { authorization: `Bearer ${user.access_token}` },
      payload: { tier: "diamond" },
    });
    expect(bogus.statusCode).toBe(400);
  });

  it("cancel sets cancel_at_period_end=true and rejects on a free tier", async () => {
    const user = await createTestUser(app);

    // Cancel without a subscription — 400.
    const tooSoon = await app.inject({
      method: "POST",
      url: "/api/v1/membership/cancel",
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(tooSoon.statusCode).toBe(400);

    // Upgrade to premium first.
    await app.inject({
      method: "POST",
      url: "/api/v1/membership/subscribe",
      headers: { authorization: `Bearer ${user.access_token}` },
      payload: { tier: "premium" },
    });

    // Now cancel — succeeds.
    const cancel = await app.inject({
      method: "POST",
      url: "/api/v1/membership/cancel",
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(cancel.statusCode).toBe(200);
    const body = cancel.json<CancelResponse>();
    expect(body.tier).toBe("premium");
    expect(body.cancel_at_period_end).toBe(true);

    // The next GET reflects the flag.
    const state = await app
      .inject({
        method: "GET",
        url: "/api/v1/me/membership",
        headers: { authorization: `Bearer ${user.access_token}` },
      })
      .then((r) => r.json<MembershipState>());
    expect(state.cancel_at_period_end).toBe(true);
    // Tier doesn't downgrade until the webhook fires.
    expect(state.tier).toBe("premium");
  });

  it("premium tier exposes coach + custom badge benefits", async () => {
    const user = await createTestUser(app);
    await app.inject({
      method: "POST",
      url: "/api/v1/membership/subscribe",
      headers: { authorization: `Bearer ${user.access_token}` },
      payload: { tier: "premium" },
    });
    const state = await app
      .inject({
        method: "GET",
        url: "/api/v1/me/membership",
        headers: { authorization: `Bearer ${user.access_token}` },
      })
      .then((r) => r.json<MembershipState>());
    expect(state.tier).toBe("premium");
    expect(state.price_minor).toBe(1999);
    expect(state.benefits.some((b) => b.key === "coach_on_demand")).toBe(true);
    expect(state.benefits.some((b) => b.key === "custom_badge")).toBe(true);
  });

  it("webhook customer.subscription.created upgrades the row", async () => {
    const user = await createTestUser(app);

    const periodEnd = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe/subscription",
      payload: {
        id: "evt_test_created_1",
        type: "customer.subscription.created",
        data: {
          object: {
            id: "sub_test_1",
            customer: "cus_test_1",
            status: "active",
            current_period_end: periodEnd,
            cancel_at_period_end: false,
            metadata: { linkfit_user_id: user.id, linkfit_tier: "plus" },
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ received: boolean; handled: boolean }>().handled).toBe(true);

    const state = await app
      .inject({
        method: "GET",
        url: "/api/v1/me/membership",
        headers: { authorization: `Bearer ${user.access_token}` },
      })
      .then((r) => r.json<MembershipState>());
    expect(state.tier).toBe("plus");
    expect(state.current_period_end).toBeTruthy();
  });

  it("webhook customer.subscription.deleted downgrades to free", async () => {
    const user = await createTestUser(app);

    // Seed an active subscription via the upsert webhook.
    await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe/subscription",
      payload: {
        id: "evt_test_created_2",
        type: "customer.subscription.created",
        data: {
          object: {
            id: "sub_test_to_delete",
            customer: "cus_test_2",
            status: "active",
            current_period_end: Math.floor(Date.now() / 1000) + 1000,
            metadata: { linkfit_user_id: user.id, linkfit_tier: "premium" },
          },
        },
      },
    });

    const deleteRes = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe/subscription",
      payload: {
        id: "evt_test_deleted_1",
        type: "customer.subscription.deleted",
        data: {
          object: { id: "sub_test_to_delete" },
        },
      },
    });
    expect(deleteRes.statusCode).toBe(200);

    const state = await app
      .inject({
        method: "GET",
        url: "/api/v1/me/membership",
        headers: { authorization: `Bearer ${user.access_token}` },
      })
      .then((r) => r.json<MembershipState>());
    expect(state.tier).toBe("free");
    expect(state.current_period_end).toBeNull();
  });

  it("webhook is idempotent on event id (duplicate delivery is a no-op)", async () => {
    const user = await createTestUser(app);

    const event = {
      id: "evt_test_dup_1",
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_test_dup",
          customer: "cus_test_dup",
          status: "active",
          current_period_end: Math.floor(Date.now() / 1000) + 1000,
          metadata: { linkfit_user_id: user.id, linkfit_tier: "plus" },
        },
      },
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe/subscription",
      payload: event,
    });
    expect(first.json<{ handled: boolean }>().handled).toBe(true);

    // Replay — `handled: false` indicates the dedupe path fired.
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe/subscription",
      payload: event,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ handled: boolean }>().handled).toBe(false);
  });

  it("fallback /membership-webhook path accepts the same payload", async () => {
    const user = await createTestUser(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/membership-webhook",
      payload: {
        id: "evt_test_fallback_1",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_test_fallback",
            customer: "cus_test_fallback",
            status: "active",
            current_period_end: Math.floor(Date.now() / 1000) + 1000,
            metadata: { linkfit_user_id: user.id, linkfit_tier: "premium" },
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);

    const state = await app
      .inject({
        method: "GET",
        url: "/api/v1/me/membership",
        headers: { authorization: `Bearer ${user.access_token}` },
      })
      .then((r) => r.json<MembershipState>());
    expect(state.tier).toBe("premium");
  });
});
