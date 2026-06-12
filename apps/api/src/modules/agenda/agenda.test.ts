import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll, type TestUser } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";

/**
 * Tests cover the four guarantees the iOS calendar relies on:
 *
 *  1. Auth required — anonymous callers can't enumerate someone else's agenda.
 *  2. Empty range returns three empty arrays (never `null`).
 *  3. Mixed kinds — one user with a game + booking + tournament entry sees
 *     all three buckets populated, scoped to themselves.
 *  4. Range bounds — items outside the [from, to] window are excluded; items
 *     belonging to a different user never leak in.
 */

const HOURLY_PRICE_MINOR = 5000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface AgendaItem {
  id: string;
  kind: "game" | "booking" | "tournament";
  starts_at: string;
  ends_at: string;
  title: string;
  venue_name: string | null;
}
interface AgendaBody {
  games: AgendaItem[];
  bookings: AgendaItem[];
  tournaments: AgendaItem[];
}

async function seedVenueAndCourt(
  db: DbHandle,
): Promise<{ venueId: string; courtId: string; sportId: string }> {
  const venue = await db.db
    .insertInto("venues")
    .values({ name: "Agenda Test Venue", address: "Addr", lat: "40.41", lng: "49.86" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const padel = await sql<{ id: string }>`SELECT id FROM sports WHERE slug='padel'`.execute(db.db);
  const sportId = padel.rows[0]!.id;
  const court = await db.db
    .insertInto("courts")
    .values({
      venue_id: venue.id,
      sport_id: sportId,
      name: "Court 1",
      hourly_price_minor: HOURLY_PRICE_MINOR,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { venueId: venue.id, courtId: court.id, sportId };
}

/** Insert a future game directly so we control `starts_at` precisely without
 *  going through the create-game validator (which forbids past times etc). */
async function insertGame(
  db: DbHandle,
  args: {
    hostId: string;
    sportId: string;
    courtId: string | null;
    startsAt: Date;
    durationMin: number;
  },
): Promise<string> {
  const row = await db.db
    .insertInto("games")
    .values({
      sport_id: args.sportId,
      court_id: args.courtId,
      host_user_id: args.hostId,
      lat: "40.41",
      lng: "49.86",
      starts_at: args.startsAt,
      duration_minutes: args.durationMin,
      capacity: 4,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db.db
    .insertInto("game_participants")
    .values({ game_id: row.id, user_id: args.hostId, status: "confirmed" })
    .execute();
  return row.id;
}

async function insertBooking(
  db: DbHandle,
  args: { userId: string; courtId: string; startsAt: Date; durationMin: number; key: string },
): Promise<string> {
  const row = await db.db
    .insertInto("bookings")
    .values({
      court_id: args.courtId,
      user_id: args.userId,
      starts_at: args.startsAt,
      duration_minutes: args.durationMin,
      total_minor: 5000,
      currency: "AZN",
      idempotency_key: args.key,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function insertTournamentAndEntry(
  db: DbHandle,
  args: {
    captainId: string;
    playerIds: string[];
    sportId: string;
    venueId: string;
    startsAt: Date;
    endsAt: Date;
    name: string;
  },
): Promise<{ tournamentId: string; entryId: string }> {
  const t = await db.db
    .insertInto("tournaments")
    .values({
      name: args.name,
      description: null,
      sport_id: args.sportId,
      venue_id: args.venueId,
      starts_at: args.startsAt,
      ends_at: args.endsAt,
      max_squads: 8,
      squad_size: 2,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const e = await db.db
    .insertInto("tournament_entries")
    .values({
      tournament_id: t.id,
      captain_user_id: args.captainId,
      squad_name: "Squad",
      player_ids: args.playerIds,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { tournamentId: t.id, entryId: e.id };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

describe("agenda routes — GET /api/v1/me/agenda", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let courtId: string;
  let venueId: string;
  let sportId: string;
  let user: TestUser;

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
    ({ courtId, venueId, sportId } = await seedVenueAndCourt(db));
    user = await createTestUser(app);
  });

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/agenda?from=2030-01-01&to=2030-01-31",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns three empty arrays when the user has nothing in range", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/agenda?from=2030-01-01&to=2030-01-31",
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<AgendaBody>();
    expect(body.games).toEqual([]);
    expect(body.bookings).toEqual([]);
    expect(body.tournaments).toEqual([]);
  });

  it("aggregates games, bookings, and tournaments where the user participates", async () => {
    const tomorrow = new Date(Date.now() + ONE_DAY_MS);
    const dayAfter = new Date(Date.now() + 2 * ONE_DAY_MS);
    const inAWeek = new Date(Date.now() + 7 * ONE_DAY_MS);

    // Game: user is host
    await insertGame(db, {
      hostId: user.id,
      sportId,
      courtId,
      startsAt: tomorrow,
      durationMin: 90,
    });

    // Booking: user is owner
    await insertBooking(db, {
      userId: user.id,
      courtId,
      startsAt: dayAfter,
      durationMin: 60,
      key: "agenda-test-booking-001",
    });

    // Tournament: user is captain
    await insertTournamentAndEntry(db, {
      captainId: user.id,
      playerIds: [],
      sportId,
      venueId,
      startsAt: inAWeek,
      endsAt: new Date(inAWeek.getTime() + ONE_DAY_MS),
      name: "Captain's Cup",
    });

    // Tournament where user is a non-captain player (player_ids contains them)
    const otherCaptain = await createTestUser(app);
    await insertTournamentAndEntry(db, {
      captainId: otherCaptain.id,
      playerIds: [user.id],
      sportId,
      venueId,
      startsAt: new Date(inAWeek.getTime() + 2 * ONE_DAY_MS),
      endsAt: new Date(inAWeek.getTime() + 3 * ONE_DAY_MS),
      name: "Player Cup",
    });

    const from = ymd(new Date(Date.now() - ONE_DAY_MS));
    const to = ymd(new Date(Date.now() + 30 * ONE_DAY_MS));
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/me/agenda?from=${from}&to=${to}`,
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<AgendaBody>();
    expect(body.games.length).toBe(1);
    expect(body.games[0]!.kind).toBe("game");
    expect(body.games[0]!.venue_name).toBe("Agenda Test Venue");
    expect(body.bookings.length).toBe(1);
    expect(body.bookings[0]!.kind).toBe("booking");
    expect(body.bookings[0]!.title).toBe("Court 1");
    expect(body.tournaments.length).toBe(2);
    expect(body.tournaments.map((t) => t.title).sort()).toEqual(["Captain's Cup", "Player Cup"]);
  });

  it("excludes items outside the date range and items owned by other users", async () => {
    const tomorrow = new Date(Date.now() + ONE_DAY_MS);
    const farFuture = new Date(Date.now() + 60 * ONE_DAY_MS);
    const stranger = await createTestUser(app);

    // In-range game for the user — should appear.
    await insertGame(db, {
      hostId: user.id,
      sportId,
      courtId,
      startsAt: tomorrow,
      durationMin: 60,
    });

    // Far-future game for the user — outside the window.
    await insertGame(db, {
      hostId: user.id,
      sportId,
      courtId: null,
      startsAt: farFuture,
      durationMin: 60,
    });

    // In-range booking — but for a stranger. Must not leak.
    await insertBooking(db, {
      userId: stranger.id,
      courtId,
      startsAt: tomorrow,
      durationMin: 60,
      key: "agenda-test-leak-001",
    });

    // Tournament — captain is the stranger, user is NOT a player.
    await insertTournamentAndEntry(db, {
      captainId: stranger.id,
      playerIds: [],
      sportId,
      venueId,
      startsAt: tomorrow,
      endsAt: new Date(tomorrow.getTime() + ONE_DAY_MS),
      name: "Not Mine",
    });

    const from = ymd(new Date(Date.now() - ONE_DAY_MS));
    const to = ymd(new Date(Date.now() + 7 * ONE_DAY_MS));
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/me/agenda?from=${from}&to=${to}`,
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<AgendaBody>();
    expect(body.games.length).toBe(1); // far-future excluded
    expect(body.bookings).toEqual([]); // stranger's, excluded
    expect(body.tournaments).toEqual([]); // stranger's, excluded
  });

  it("rejects malformed date params with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/agenda?from=not-a-date&to=2030-01-01",
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when `from` is after `to`", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/agenda?from=2030-02-01&to=2030-01-01",
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
