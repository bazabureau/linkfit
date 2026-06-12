import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll, type TestUser } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const HOURLY_PRICE_MINOR = 5000;

interface BookingBody {
  id: string;
  user_id: string;
  court_id: string;
  total_minor: number;
  duration_minutes: number;
  status: string;
  idempotency_key: string;
  starts_at: string;
  ends_at: string;
  venue_name: string;
  court_name: string;
  paid_at: string | null;
  cancelled_at: string | null;
  splits: { user_id: string; amount_minor: number; status: string }[];
}

interface BookingsListBody {
  upcoming: BookingBody[];
  past: BookingBody[];
}

async function seedCourt(db: DbHandle): Promise<{ courtId: string; venueId: string }> {
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
  return { courtId: court.id, venueId: venue.id };
}

function isoIn(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

async function postCreate(
  app: LinkfitServer,
  user: TestUser,
  body: Record<string, unknown>,
) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/bookings",
    headers: { authorization: `Bearer ${user.access_token}` },
    payload: body,
  });
  if (res.statusCode >= 400) {
    console.error("POST /api/v1/bookings FAIL:", res.statusCode, res.body);
  }
  return res;
}

describe("bookings routes — court-window flow", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let courtId: string;
  let venueId: string;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
    ({ courtId, venueId } = await seedCourt(db));
  });

  it("creates a booking with correctly computed total and a single payment split", async () => {
    const user = await createTestUser(app);
    const res = await postCreate(app, user, {
      court_id: courtId,
      starts_at: isoIn(120),
      duration_minutes: 90,
      idempotency_key: "create-success-key-001",
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<BookingBody>();
    // 5000 minor / hour * 90 / 60 = 7500
    expect(body.total_minor).toBe(7500);
    expect(body.duration_minutes).toBe(90);
    expect(body.status).toBe("pending_payment");
    expect(body.user_id).toBe(user.id);
    expect(body.court_id).toBe(courtId);
    expect(body.venue_name).toBe("Test Venue");
    expect(body.court_name).toBe("Court 1");
    expect(body.splits.length).toBe(1);
    expect(body.splits[0]!.user_id).toBe(user.id);
    expect(body.splits[0]!.amount_minor).toBe(7500);
    expect(body.splits[0]!.status).toBe("pending");
    expect(body.cancelled_at).toBeNull();
    expect(body.paid_at).toBeNull();
    // ends_at = starts_at + 90 min
    expect(new Date(body.ends_at).getTime() - new Date(body.starts_at).getTime()).toBe(
      90 * 60_000,
    );
    expect(venueId).toBe(body.venue_name ? (await db.db.selectFrom("venues").select("id").where("name", "=", "Test Venue").executeTakeFirstOrThrow()).id : venueId);
  });

  it("rejects a second booking that overlaps the same court window", async () => {
    const userA = await createTestUser(app);
    const userB = await createTestUser(app);
    const startsAt = isoIn(180);
    const first = await postCreate(app, userA, {
      court_id: courtId,
      starts_at: startsAt,
      duration_minutes: 60,
      idempotency_key: "double-book-key-001",
    });
    if (first.statusCode !== 201) console.error("FIRST FAIL BODY:", first.body);
    expect(first.statusCode).toBe(201);

    // Second user tries to grab the same hour.
    const overlap = await postCreate(app, userB, {
      court_id: courtId,
      starts_at: startsAt,
      duration_minutes: 60,
      idempotency_key: "double-book-key-002",
    });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json<{ error: { code: string } }>().error.code).toBe("CONFLICT");

    // Partial overlap (30 min later) also blocked.
    const partial = await postCreate(app, userB, {
      court_id: courtId,
      starts_at: new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString(),
      duration_minutes: 60,
      idempotency_key: "double-book-key-003",
    });
    expect(partial.statusCode).toBe(409);

    // Adjacent (right after) succeeds — windows are half-open.
    const adjacent = await postCreate(app, userB, {
      court_id: courtId,
      starts_at: new Date(new Date(startsAt).getTime() + 60 * 60_000).toISOString(),
      duration_minutes: 60,
      idempotency_key: "double-book-key-004",
    });
    expect(adjacent.statusCode).toBe(201);
  });

  it("is idempotent — replaying the same key returns the same booking, no duplicate row", async () => {
    const user = await createTestUser(app);
    const payload = {
      court_id: courtId,
      starts_at: isoIn(240),
      duration_minutes: 60,
      idempotency_key: "idem-key-aaaaaaaa",
    };
    const first = await postCreate(app, user, payload);
    const second = await postCreate(app, user, payload);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json<BookingBody>().id).toBe(second.json<BookingBody>().id);

    const count = await sql<{ c: string }>`SELECT count(*)::text AS c FROM bookings`.execute(db.db);
    expect(Number(count.rows[0]!.c)).toBe(1);
  });

  it("cancels a future booking and releases the slot for someone else", async () => {
    const userA = await createTestUser(app);
    const userB = await createTestUser(app);
    const startsAt = isoIn(300);

    const created = await postCreate(app, userA, {
      court_id: courtId,
      starts_at: startsAt,
      duration_minutes: 60,
      idempotency_key: "cancel-key-aaaa1111",
    });
    expect(created.statusCode).toBe(201);
    const bookingId = created.json<BookingBody>().id;

    // Cancel as the owner.
    const cancel = await app.inject({
      method: "POST",
      url: `/api/v1/bookings/${bookingId}/cancel`,
      headers: { authorization: `Bearer ${userA.access_token}` },
    });
    expect(cancel.statusCode).toBe(200);
    const cancelled = cancel.json<BookingBody>();
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelled_at).not.toBeNull();

    // The slot should now be available — another user can grab it.
    const reBook = await postCreate(app, userB, {
      court_id: courtId,
      starts_at: startsAt,
      duration_minutes: 60,
      idempotency_key: "cancel-key-bbbb2222",
    });
    expect(reBook.statusCode).toBe(201);

    // Cancelling a second time fails with 422 PRECONDITION.
    const cancelAgain = await app.inject({
      method: "POST",
      url: `/api/v1/bookings/${bookingId}/cancel`,
      headers: { authorization: `Bearer ${userA.access_token}` },
    });
    expect(cancelAgain.statusCode).toBe(422);
  });

  it("GET /bookings/me splits the caller's bookings into upcoming and past", async () => {
    const user = await createTestUser(app);
    const otherUser = await createTestUser(app);

    // Upcoming booking.
    await postCreate(app, user, {
      court_id: courtId,
      starts_at: isoIn(120),
      duration_minutes: 60,
      idempotency_key: "list-key-upcoming-001",
    });

    // Past booking (insert directly to bypass the future-time guard).
    await db.db
      .insertInto("bookings")
      .values({
        court_id: courtId,
        user_id: user.id,
        starts_at: new Date(Date.now() - 2 * ONE_HOUR_MS),
        duration_minutes: 60,
        total_minor: 5000,
        currency: "AZN",
        idempotency_key: "list-key-past-direct-001",
      })
      .execute();

    // A booking owned by someone else — must not show up in our list.
    await postCreate(app, otherUser, {
      court_id: courtId,
      starts_at: isoIn(400),
      duration_minutes: 60,
      idempotency_key: "list-key-other-001",
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/bookings/me",
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json<BookingsListBody>();
    expect(body.upcoming.length).toBe(1);
    expect(body.past.length).toBe(1);
    expect(body.upcoming[0]!.user_id).toBe(user.id);
    expect(body.past[0]!.user_id).toBe(user.id);
    // No leak from `otherUser`.
    expect(body.upcoming.every((b) => b.user_id === user.id)).toBe(true);
    expect(body.past.every((b) => b.user_id === user.id)).toBe(true);
  });

  it("GET /bookings/:id is owner-scoped — non-owner gets 403", async () => {
    const owner = await createTestUser(app);
    const stranger = await createTestUser(app);
    const created = await postCreate(app, owner, {
      court_id: courtId,
      starts_at: isoIn(500),
      duration_minutes: 60,
      idempotency_key: "auth-scope-key-1111",
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<BookingBody>().id;

    const mine = await app.inject({
      method: "GET",
      url: `/api/v1/bookings/${id}`,
      headers: { authorization: `Bearer ${owner.access_token}` },
    });
    expect(mine.statusCode).toBe(200);

    const theirs = await app.inject({
      method: "GET",
      url: `/api/v1/bookings/${id}`,
      headers: { authorization: `Bearer ${stranger.access_token}` },
    });
    expect(theirs.statusCode).toBe(403);
  });

  it("mark-paid flips status to paid and captures the splits", async () => {
    const user = await createTestUser(app);
    const created = await postCreate(app, user, {
      court_id: courtId,
      starts_at: isoIn(600),
      duration_minutes: 60,
      idempotency_key: "mark-paid-key-001",
    });
    const id = created.json<BookingBody>().id;
    const paid = await app.inject({
      method: "POST",
      url: `/api/v1/bookings/${id}/mark-paid`,
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(paid.statusCode).toBe(200);
    const body = paid.json<BookingBody>();
    expect(body.status).toBe("paid");
    expect(body.paid_at).not.toBeNull();
    expect(body.splits[0]!.status).toBe("captured");
  });

  it("rejects bookings in the past, with invalid durations, or against unknown courts", async () => {
    const user = await createTestUser(app);

    const past = await postCreate(app, user, {
      court_id: courtId,
      starts_at: isoIn(-60),
      duration_minutes: 60,
      idempotency_key: "validation-key-past-1",
    });
    expect(past.statusCode).toBe(400);

    const tooShort = await postCreate(app, user, {
      court_id: courtId,
      starts_at: isoIn(60),
      duration_minutes: 5,
      idempotency_key: "validation-key-short-1",
    });
    expect(tooShort.statusCode).toBe(400);

    const unknownCourt = await postCreate(app, user, {
      court_id: "00000000-0000-0000-0000-000000000000",
      starts_at: isoIn(60),
      duration_minutes: 60,
      idempotency_key: "validation-key-court-1",
    });
    expect(unknownCourt.statusCode).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bookings",
      payload: {
        court_id: courtId,
        starts_at: isoIn(60),
        duration_minutes: 60,
        idempotency_key: "no-auth-key-1234",
      },
    });
    expect(res.statusCode).toBe(401);

    const list = await app.inject({ method: "GET", url: "/api/v1/bookings/me" });
    expect(list.statusCode).toBe(401);
  });
});

describe("bookings feature flag off", () => {
  it("returns 404 on /bookings when FEATURE_BOOKINGS is false", async () => {
    const env = buildTestEnv();
    env.FEATURE_BOOKINGS = false;
    const db = buildTestDb();
    const app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/bookings",
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
      await db.close();
    }
  });
});
