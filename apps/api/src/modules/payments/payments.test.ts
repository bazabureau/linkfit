import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import type Stripe from "stripe";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll, type TestUser } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  type CreatePaymentIntentArgs,
  type PaymentSheetCredentials,
  type StripeGateway,
} from "./stripe-gateway.js";

const HOURLY_PRICE_MINOR = 5000;

interface PaymentSheetBody {
  payment_intent_id: string;
  client_secret: string;
  ephemeral_key: string;
  customer_id: string;
  publishable_key_hint: string | null;
}

/** In-memory recorder for every gateway call. Tests assert on it instead of
 *  hitting a Stripe sandbox. `constructEvent` returns whatever JSON the test
 *  hands the route — signature verification is exercised by passing an
 *  invalid signature into a separate test path. */
class FakeStripeGateway implements StripeGateway {
  public intents: CreatePaymentIntentArgs[] = [];
  public customers: { email: string; user_id: string }[] = [];
  public ephemerals: string[] = [];
  private intentCounter = 0;
  private customerCounter = 0;
  /** When true, `constructEvent` throws as if the signature were forged. */
  public failVerification = false;
  /** Optional override — if set, the next call resolves with this id. */
  public nextIntentId: string | null = null;

  async ensureCustomer(args: { email: string; user_id: string }): Promise<{ id: string }> {
    this.customers.push(args);
    this.customerCounter += 1;
    return Promise.resolve({ id: `cus_test_${String(this.customerCounter)}` });
  }
  async createEphemeralKey(customer_id: string): Promise<{ secret: string }> {
    this.ephemerals.push(customer_id);
    return Promise.resolve({ secret: `ek_test_${String(this.ephemerals.length)}` });
  }
  async createPaymentIntent(args: CreatePaymentIntentArgs): Promise<PaymentSheetCredentials> {
    this.intents.push(args);
    this.intentCounter += 1;
    const id = this.nextIntentId ?? `pi_test_${String(this.intentCounter)}`;
    this.nextIntentId = null;
    return Promise.resolve({
      payment_intent_id: id,
      client_secret: `${id}_secret_abc`,
      ephemeral_key: "",
      customer_id: args.customer_id,
    });
  }
  constructEvent(payload: Buffer, signature: string): Stripe.Event {
    if (this.failVerification || signature === "bad-sig") {
      throw new Error("No signatures found matching the expected signature for payload");
    }
    return JSON.parse(payload.toString("utf8")) as Stripe.Event;
  }
}

async function seedCourt(db: DbHandle): Promise<{ courtId: string }> {
  const venue = await db.db
    .insertInto("venues")
    .values({ name: "Test Venue", address: "Addr", lat: "40.41", lng: "49.86" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const padel = await sql<{ id: string }>`SELECT id FROM sports WHERE slug='padel'`.execute(db.db);
  const court = await db.db
    .insertInto("courts")
    .values({
      venue_id: venue.id,
      sport_id: padel.rows[0]!.id,
      name: "Court 1",
      hourly_price_minor: HOURLY_PRICE_MINOR,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { courtId: court.id };
}

let bookingSlotCounter = 0;
async function createBooking(
  app: LinkfitServer,
  user: TestUser,
  courtId: string,
  idemKey: string,
): Promise<string> {
  // Each call lands in a unique window so successive bookings on the same
  // court don't conflict with the half-open overlap rule.
  bookingSlotCounter += 1;
  const startsAt = new Date(
    Date.now() + (3 + bookingSlotCounter * 2) * 60 * 60_000,
  ).toISOString();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/bookings",
    headers: { authorization: `Bearer ${user.access_token}` },
    payload: {
      court_id: courtId,
      starts_at: startsAt,
      duration_minutes: 60,
      idempotency_key: idemKey,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`booking create failed: ${String(res.statusCode)} ${res.body}`);
  }
  return res.json<{ id: string }>().id;
}

async function createTournament(
  db: DbHandle,
  overrides: {
    entry_fee_minor?: number;
    squad_size?: number;
    max_squads?: number;
  } = {},
): Promise<string> {
  const sport = await sql<{ id: string }>`SELECT id FROM sports WHERE slug='padel'`.execute(db.db);
  const venue = await db.db
    .insertInto("venues")
    .values({ name: "T Venue", address: "Addr", lat: "40.41", lng: "49.86" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60_000);
  const row = await db.db
    .insertInto("tournaments")
    .values({
      name: "Open Cup",
      sport_id: sport.rows[0]!.id,
      venue_id: venue.id,
      starts_at: startsAt,
      ends_at: endsAt,
      max_squads: overrides.max_squads ?? 8,
      squad_size: overrides.squad_size ?? 2,
      entry_fee_minor: overrides.entry_fee_minor ?? 10_000,
      status: "registration_open",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

describe("payments routes — Stripe PaymentSheet integration", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let gateway: FakeStripeGateway;
  let courtId: string;

  beforeAll(async () => {
    db = buildTestDb();
    gateway = new FakeStripeGateway();
    app = await buildServer({
      env,
      logger: pino({ level: "silent" }),
      db,
      stripeGateway: gateway,
    });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
    // Wipe payments-related tables that truncateAll doesn't know about.
    await sql`TRUNCATE TABLE
      stripe_webhook_events,
      tournament_entry_payments,
      stripe_customers RESTART IDENTITY CASCADE`.execute(db.db);
    ({ courtId } = await seedCourt(db));
    gateway.intents = [];
    gateway.customers = [];
    gateway.ephemerals = [];
    gateway.failVerification = false;
    gateway.nextIntentId = null;
  });

  // ─── Booking intent ─────────────────────────────────────────────────

  it("creates a booking PaymentIntent and returns PaymentSheet credentials", async () => {
    const user = await createTestUser(app);
    const bookingId = await createBooking(app, user, courtId, "intent-key-001");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/payments/booking/${bookingId}/intent`,
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<PaymentSheetBody>();
    expect(body.payment_intent_id).toMatch(/^pi_test_/);
    expect(body.client_secret).toContain("_secret_");
    expect(body.customer_id).toMatch(/^cus_test_/);
    expect(body.ephemeral_key).toMatch(/^ek_test_/);

    // Gateway received the right amount + currency + metadata.
    expect(gateway.intents).toHaveLength(1);
    const sent = gateway.intents[0]!;
    expect(sent.amount_minor).toBe(HOURLY_PRICE_MINOR);
    expect(sent.currency).toBe("AZN");
    expect(sent.metadata.linkfit_kind).toBe("booking");
    expect(sent.metadata.linkfit_booking_id).toBe(bookingId);

    // Booking row has the intent id stashed for reconciliation.
    const stamped = await db.db
      .selectFrom("bookings")
      .select(["external_ref", "status"])
      .where("id", "=", bookingId)
      .executeTakeFirstOrThrow();
    expect(stamped.external_ref).toBe(body.payment_intent_id);
    expect(stamped.status).toBe("pending_payment");
  });

  it("rejects PaymentIntent creation for someone else's booking", async () => {
    const owner = await createTestUser(app);
    const stranger = await createTestUser(app);
    const bookingId = await createBooking(app, owner, courtId, "intent-key-403");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/payments/booking/${bookingId}/intent`,
      headers: { authorization: `Bearer ${stranger.access_token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(gateway.intents).toHaveLength(0);
  });

  it("refuses to re-intent an already-paid booking", async () => {
    const user = await createTestUser(app);
    const bookingId = await createBooking(app, user, courtId, "intent-key-paid");
    // Flip booking to paid via the existing mark-paid stub.
    const paid = await app.inject({
      method: "POST",
      url: `/api/v1/bookings/${bookingId}/mark-paid`,
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(paid.statusCode).toBe(200);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/payments/booking/${bookingId}/intent`,
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it("reuses the same Stripe customer across two intents for the same user", async () => {
    const user = await createTestUser(app);
    const b1 = await createBooking(app, user, courtId, "intent-key-r1");
    await app.inject({
      method: "POST",
      url: `/api/v1/payments/booking/${b1}/intent`,
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(gateway.customers).toHaveLength(1);
    const b2 = await createBooking(app, user, courtId, "intent-key-r2");
    await app.inject({
      method: "POST",
      url: `/api/v1/payments/booking/${b2}/intent`,
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    // Cached in stripe_customers — second call must not hit the gateway again.
    expect(gateway.customers).toHaveLength(1);
    expect(gateway.intents).toHaveLength(2);
  });

  // ─── Tournament entry intent ────────────────────────────────────────

  it("creates a tournament entry PaymentIntent and persists pending entry payment", async () => {
    const captain = await createTestUser(app);
    const teammate = await createTestUser(app);
    const tournamentId = await createTournament(db);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/payments/tournament/${tournamentId}/entry-intent`,
      headers: { authorization: `Bearer ${captain.access_token}` },
      payload: { squad_name: "Aces", player_ids: [teammate.id] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<PaymentSheetBody>();
    expect(gateway.intents).toHaveLength(1);
    expect(gateway.intents[0]!.metadata.linkfit_kind).toBe("tournament_entry");
    expect(gateway.intents[0]!.amount_minor).toBe(10_000);

    const pending = await db.db
      .selectFrom("tournament_entry_payments")
      .selectAll()
      .where("payment_intent_id", "=", body.payment_intent_id)
      .executeTakeFirstOrThrow();
    expect(pending.status).toBe("pending");
    expect(pending.squad_name).toBe("Aces");
    expect(pending.player_ids).toEqual([teammate.id]);
  });

  it("rejects tournament intent when fee is zero", async () => {
    const captain = await createTestUser(app);
    const tournamentId = await createTournament(db, { entry_fee_minor: 0 });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/payments/tournament/${tournamentId}/entry-intent`,
      headers: { authorization: `Bearer ${captain.access_token}` },
      payload: { squad_name: "Aces", player_ids: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  // ─── Webhook handling ───────────────────────────────────────────────

  it("payment_intent.succeeded webhook marks the booking paid", async () => {
    const user = await createTestUser(app);
    const bookingId = await createBooking(app, user, courtId, "intent-key-hook");
    const intentRes = await app.inject({
      method: "POST",
      url: `/api/v1/payments/booking/${bookingId}/intent`,
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    const intentId = intentRes.json<PaymentSheetBody>().payment_intent_id;
    const event = {
      id: "evt_succeed_1",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: intentId,
          metadata: {
            linkfit_kind: "booking",
            linkfit_booking_id: bookingId,
            linkfit_user_id: user.id,
          },
        },
      },
    };
    const hook = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      headers: {
        "stripe-signature": "test-sig",
        "content-type": "application/json",
      },
      payload: JSON.stringify(event),
    });
    expect(hook.statusCode).toBe(200);
    expect(hook.json<{ handled: boolean }>().handled).toBe(true);

    const after = await db.db
      .selectFrom("bookings")
      .select(["status", "paid_at"])
      .where("id", "=", bookingId)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe("paid");
    expect(after.paid_at).not.toBeNull();
  });

  it("webhook is idempotent — replaying the same event id is a no-op", async () => {
    const user = await createTestUser(app);
    const bookingId = await createBooking(app, user, courtId, "intent-key-hook2");
    await app.inject({
      method: "POST",
      url: `/api/v1/payments/booking/${bookingId}/intent`,
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    const event = {
      id: "evt_dup_1",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_anything",
          metadata: {
            linkfit_kind: "booking",
            linkfit_booking_id: bookingId,
            linkfit_user_id: user.id,
          },
        },
      },
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      headers: { "stripe-signature": "sig", "content-type": "application/json" },
      payload: JSON.stringify(event),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ handled: boolean }>().handled).toBe(true);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      headers: { "stripe-signature": "sig", "content-type": "application/json" },
      payload: JSON.stringify(event),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ handled: boolean }>().handled).toBe(false);

    const events = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM stripe_webhook_events
    `.execute(db.db);
    expect(Number(events.rows[0]!.c)).toBe(1);
  });

  it("payment_intent.succeeded materializes the tournament entry once", async () => {
    const captain = await createTestUser(app);
    const tournamentId = await createTournament(db);
    const intentRes = await app.inject({
      method: "POST",
      url: `/api/v1/payments/tournament/${tournamentId}/entry-intent`,
      headers: { authorization: `Bearer ${captain.access_token}` },
      payload: { squad_name: "Solo", player_ids: [] },
    });
    const intentId = intentRes.json<PaymentSheetBody>().payment_intent_id;

    const event = {
      id: "evt_t_succeed_1",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: intentId,
          metadata: {
            linkfit_kind: "tournament_entry",
            linkfit_tournament_id: tournamentId,
            linkfit_captain_user_id: captain.id,
          },
        },
      },
    };
    const hook = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      headers: { "stripe-signature": "sig", "content-type": "application/json" },
      payload: JSON.stringify(event),
    });
    expect(hook.statusCode).toBe(200);

    const entries = await db.db
      .selectFrom("tournament_entries")
      .selectAll()
      .where("tournament_id", "=", tournamentId)
      .execute();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.captain_user_id).toBe(captain.id);
    expect(entries[0]!.squad_name).toBe("Solo");

    // Pending payment flipped to succeeded with entry_id linked.
    const pending = await db.db
      .selectFrom("tournament_entry_payments")
      .selectAll()
      .where("payment_intent_id", "=", intentId)
      .executeTakeFirstOrThrow();
    expect(pending.status).toBe("succeeded");
    expect(pending.entry_id).toBe(entries[0]!.id);

    // Replay (different event id, same intent) must not create a second entry.
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      headers: { "stripe-signature": "sig", "content-type": "application/json" },
      payload: JSON.stringify({ ...event, id: "evt_t_succeed_2" }),
    });
    expect(replay.statusCode).toBe(200);
    const after = await db.db
      .selectFrom("tournament_entries")
      .selectAll()
      .where("tournament_id", "=", tournamentId)
      .execute();
    expect(after).toHaveLength(1);
  });

  it("rejects webhooks with bad signatures", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      headers: { "stripe-signature": "bad-sig", "content-type": "application/json" },
      payload: JSON.stringify({ id: "evt_bad", type: "payment_intent.succeeded" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("payment_intent.payment_failed flips the booking to failed", async () => {
    const user = await createTestUser(app);
    const bookingId = await createBooking(app, user, courtId, "intent-key-fail");
    await app.inject({
      method: "POST",
      url: `/api/v1/payments/booking/${bookingId}/intent`,
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    const event = {
      id: "evt_fail_1",
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: "pi_irrelevant",
          metadata: {
            linkfit_kind: "booking",
            linkfit_booking_id: bookingId,
            linkfit_user_id: user.id,
          },
        },
      },
    };
    const hook = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      headers: { "stripe-signature": "sig", "content-type": "application/json" },
      payload: JSON.stringify(event),
    });
    expect(hook.statusCode).toBe(200);
    const after = await db.db
      .selectFrom("bookings")
      .select("status")
      .where("id", "=", bookingId)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe("failed");
  });

  it("requires auth for intent endpoints", async () => {
    const a = await app.inject({
      method: "POST",
      url: "/api/v1/payments/booking/00000000-0000-0000-0000-000000000000/intent",
    });
    expect(a.statusCode).toBe(401);
    const b = await app.inject({
      method: "POST",
      url: "/api/v1/payments/tournament/00000000-0000-0000-0000-000000000000/entry-intent",
      payload: { squad_name: "Valid", player_ids: [] },
    });
    expect(b.statusCode).toBe(401);
  });
});
