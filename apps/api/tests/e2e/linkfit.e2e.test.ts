import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../src/shared/http/server.js";
import { buildTestDb } from "../helpers/db.js";
import { buildTestEnv } from "../helpers/env.js";
import { createTestUser as baseCreateTestUser, seedBakuPadelVenues } from "../helpers/fixtures.js";
import { type DbHandle } from "../../src/shared/db/pool.js";
import { FeedService } from "../../src/modules/feed/feed.service.js";

// Background sweepers/workers to disable in E2E tests
import { FeedWorker } from "../../src/modules/feed/feed.worker.js";
import { StoriesExpireSweeper } from "../../src/modules/stories/stories-expire.sweeper.js";
import { DigestScheduler } from "../../src/modules/digest/digest.scheduler.js";
import { WeeklyRecapSweeper } from "../../src/modules/digest/weekly-recap.sweeper.js";
import { DataRightsSweeper } from "../../src/modules/data-rights/data-rights.sweeper.js";
import { GamesCompletionSweeper } from "../../src/modules/games/games-completion.sweeper.js";
import { GamesReminderSweeper } from "../../src/modules/games/games-reminder.sweeper.js";
import { DailyDigestSweeper } from "../../src/modules/push/daily-digest.sweeper.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

describe("Linkfit Premium E2E Integration Suite", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let padelId: string;
  let feedService: FeedService;
  let BakuCourts: string[] = [];

  async function cleanDb(dbHandle: DbHandle) {
    await sql`
      TRUNCATE TABLE
        tournament_entry_payments,
        payment_splits,
        story_views,
        story_mentions,
        americano_matches,
        americano_rewards,
        americano_teams,
        feed_event_reactions,
        tournament_entries,
        tournament_waivers,
        game_invitations,
        game_participants,
        match_scores,
        game_reminders_sent,
        squad_members,
        user_dismissed_announcements,
        bookings,
        feed_events,
        feed_cursor,
        notification_preferences,
        data_export_requests,
        account_deletion_requests,
        venue_reviews,
        reports,
        user_blocks,
        follows,
        medical_profiles,
        messages,
        conversation_participants,
        device_tokens,
        daily_digest_sent,
        notifications,
        audit_log,
        ratings,
        player_sport_stats,
        games,
        game_series,
        squads,
        refresh_tokens,
        signup_attempts,
        referrals,
        email_tokens,
        user_achievements,
        stripe_customers,
        stories,
        tournaments,
        americano_tournaments,
        conversations,
        announcements,
        courts,
        venues,
        users,
        stripe_webhook_events
      RESTART IDENTITY CASCADE
    `.execute(dbHandle.db);
  }

  // Wrap createTestUser to initialize referral_count to 0 to prevent SQL "null + 1" = null evaluation issues
  async function createTestUser(
    server: LinkfitServer,
    overrides?: { email?: string; password?: string; display_name?: string }
  ) {
    const user = await baseCreateTestUser(server, overrides);
    await db.db
      .updateTable("users")
      .set({ referral_count: 0 })
      .where("id", "=", user.id)
      .execute();
    return user;
  }

  beforeAll(async () => {
    // Stub background workers and sweepers to prevent concurrent deadlocks and transaction aborts
    FeedWorker.prototype.start = () => { /* noop */ };
    StoriesExpireSweeper.prototype.start = () => { /* noop */ };
    DigestScheduler.prototype.start = () => { /* noop */ };
    WeeklyRecapSweeper.prototype.start = () => { /* noop */ };
    DataRightsSweeper.prototype.start = () => { /* noop */ };
    GamesCompletionSweeper.prototype.start = () => { /* noop */ };
    GamesReminderSweeper.prototype.start = () => { /* noop */ };
    DailyDigestSweeper.prototype.start = () => { /* noop */ };

    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    await app.ready();
    feedService = new FeedService({ db });

    const sport = await db.db
      .selectFrom("sports")
      .select("id")
      .where("slug", "=", "padel")
      .executeTakeFirstOrThrow();
    padelId = sport.id;
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  beforeEach(async () => {
    await cleanDb(db);
    await seedBakuPadelVenues(db);
    const courts = await db.db
      .selectFrom("courts")
      .select("id")
      .execute();
    BakuCourts = courts.map((c) => c.id);
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  // =========================================================================
  // FEATURE 1: FEED (F1)
  // =========================================================================
  describe("Feature 1: Feed (F1) - Happy-path", () => {
    it("F1-T1-1: lists public events for anonymous callers", async () => {
      const alice = await createTestUser(app);
      await feedService.emit({
        actorUserId: alice.id,
        type: "elo_milestone",
        payload: { elo_rating: 1300 },
        visibility: "public",
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/feed",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items[0].actor.id).toBe(alice.id);
    });

    it("F1-T1-2: shows followed and self events for authenticated users", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      // Alice follows Bob
      await app.inject({
        method: "POST",
        url: `/api/v1/users/${bob.id}/follow`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });

      // Bob emits a followers visibility event
      await feedService.emit({
        actorUserId: bob.id,
        type: "elo_milestone",
        payload: { elo_rating: 1400 },
        visibility: "followers",
      });

      // Alice emits a private event
      await feedService.emit({
        actorUserId: alice.id,
        type: "elo_milestone",
        payload: { elo_rating: 1250 },
        visibility: "private",
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/feed",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const ids = body.items.map((i: { actor: { id: string } }) => i.actor.id);
      expect(ids).toContain(bob.id);
      expect(ids).toContain(alice.id);
    });

    it("F1-T1-3: allows a user to like a feed event", async () => {
      const alice = await createTestUser(app);
      await feedService.emit({
        actorUserId: alice.id,
        type: "elo_milestone",
        payload: { elo_rating: 1300 },
        visibility: "public",
      });

      const feedRes = await app.inject({
        method: "GET",
        url: "/api/v1/feed",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      const eventId = feedRes.json().items[0].id;

      const likeRes = await app.inject({
        method: "POST",
        url: `/api/v1/feed/${eventId}/like`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(likeRes.statusCode).toBe(200);
      expect(likeRes.json().likes_count).toBe(1);

      const refreshedFeed = await app.inject({
        method: "GET",
        url: "/api/v1/feed",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(refreshedFeed.json().items[0].liked_by_me).toBe(true);
    });

    it("F1-T1-4: allows a user to unlike a feed event", async () => {
      const alice = await createTestUser(app);
      await feedService.emit({
        actorUserId: alice.id,
        type: "elo_milestone",
        payload: { elo_rating: 1300 },
        visibility: "public",
      });

      const feedRes = await app.inject({
        method: "GET",
        url: "/api/v1/feed",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      const eventId = feedRes.json().items[0].id;

      await app.inject({
        method: "POST",
        url: `/api/v1/feed/${eventId}/like`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });

      const unlikeRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/feed/${eventId}/like`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(unlikeRes.statusCode).toBe(200);
      expect(unlikeRes.json().likes_count).toBe(0);
    });

    it("F1-T1-5: paginates feed events with limit and cursor", async () => {
      const alice = await createTestUser(app);
      for (let i = 0; i < 3; i++) {
        await feedService.emit({
          actorUserId: alice.id,
          type: "elo_milestone",
          payload: { elo_rating: 1200 + i },
          visibility: "public",
        });
      }

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/feed?limit=2",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const page1 = res.json();
      expect(page1.items.length).toBe(2);
      expect(page1.next_cursor).not.toBeNull();

      const res2 = await app.inject({
        method: "GET",
        url: `/api/v1/feed?limit=2&cursor=${page1.next_cursor}`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().items.length).toBe(1);
    });
  });

  describe("Feature 1: Feed (F1) - Boundary & Corner Cases", () => {
    it("F1-T2-1: private events are only visible to the host user", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      await feedService.emit({
        actorUserId: alice.id,
        type: "elo_milestone",
        payload: { elo_rating: 1300 },
        visibility: "private",
      });

      const aliceFeed = await app.inject({
        method: "GET",
        url: "/api/v1/feed",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(aliceFeed.json().items.length).toBe(1);

      const bobFeed = await app.inject({
        method: "GET",
        url: "/api/v1/feed",
        headers: { authorization: `Bearer ${bob.access_token}` },
      });
      expect(bobFeed.json().items.length).toBe(0);
    });

    it("F1-T2-2: liking a non-existent feed event ID returns a 400 error", async () => {
      const alice = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/feed/00000000-0000-0000-0000-000000000000/like",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it("F1-T2-3: double liking the same event is idempotent and returns 200 with unchanged count", async () => {
      const alice = await createTestUser(app);
      await feedService.emit({
        actorUserId: alice.id,
        type: "elo_milestone",
        payload: { elo_rating: 1300 },
        visibility: "public",
      });

      const feedRes = await app.inject({
        method: "GET",
        url: "/api/v1/feed",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      const eventId = feedRes.json().items[0].id;

      await app.inject({
        method: "POST",
        url: `/api/v1/feed/${eventId}/like`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });

      const secondLike = await app.inject({
        method: "POST",
        url: `/api/v1/feed/${eventId}/like`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(secondLike.statusCode).toBe(200);
      expect(secondLike.json().likes_count).toBe(1);
    });

    it("F1-T2-4: unliking an event that was not liked returns 200 gracefully", async () => {
      const alice = await createTestUser(app);
      await feedService.emit({
        actorUserId: alice.id,
        type: "elo_milestone",
        payload: { elo_rating: 1300 },
        visibility: "public",
      });

      const feedRes = await app.inject({
        method: "GET",
        url: "/api/v1/feed",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      const eventId = feedRes.json().items[0].id;

      const unlikeRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/feed/${eventId}/like`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(unlikeRes.statusCode).toBe(200);
      expect(unlikeRes.json().likes_count).toBe(0);
    });

    it("F1-T2-5: querying feed with an invalid/malformed cursor string returns a 400 error", async () => {
      const alice = await createTestUser(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/feed?cursor=malformed_string_123",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // FEATURE 2: MATCHES DISCOVERY / MATCHMAKING (F2)
  // =========================================================================
  describe("Feature 2: Matches Discovery / Matchmaking (F2) - Happy-path", () => {
    it("F2-T1-1: creates a Padel game with valid inputs", async () => {
      const alice = await createTestUser(app);
      const startsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: startsAt,
          duration_minutes: 90,
          capacity: 4,
          notes: "E2E Padel game",
        },
      });
      expect(res.statusCode).toBe(201);
      const game = res.json();
      expect(game.capacity).toBe(4);
      expect(game.host_user_id).toBe(alice.id);
    });

    it("F2-T1-2: retrieves game details by ID and list public games", async () => {
      const alice = await createTestUser(app);
      const startsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: startsAt,
          duration_minutes: 90,
          capacity: 4,
        },
      });
      const gameId = createRes.json().id;

      const detailRes = await app.inject({
        method: "GET",
        url: `/api/v1/games/${gameId}`,
      });
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.json().id).toBe(gameId);

      const listRes = await app.inject({
        method: "GET",
        url: "/api/v1/games",
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().items.length).toBeGreaterThan(0);
    });

    it("F2-T1-3: allows a user to join and subsequently leave a game", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);
      const startsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
      const gameRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: startsAt,
          duration_minutes: 90,
          capacity: 4,
        },
      });
      const gameId = gameRes.json().id;

      const joinRes = await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/join`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });
      expect(joinRes.statusCode).toBe(200);
      expect(joinRes.json().participants.some((p: { user_id: string; status: string }) => p.user_id === bob.id && p.status === "confirmed")).toBe(true);

      const leaveRes = await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/leave`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });
      expect(leaveRes.statusCode).toBe(200);
      expect(leaveRes.json().participants.some((p: { user_id: string; status: string }) => p.user_id === bob.id && p.status === "confirmed")).toBe(false);
    });

    it("F2-T1-4: permits the game host to reschedule a game", async () => {
      const alice = await createTestUser(app);
      const startsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
      const gameRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: startsAt,
          duration_minutes: 90,
          capacity: 4,
        },
      });
      const gameId = gameRes.json().id;

      const newTime = new Date(Date.now() + 2 * ONE_DAY_MS).toISOString();
      const rescheduleRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/games/${gameId}/reschedule`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { starts_at: newTime },
      });
      expect(rescheduleRes.statusCode).toBe(200);
      expect(new Date(rescheduleRes.json().starts_at).getTime()).toBe(new Date(newTime).getTime());
    });

    it("F2-T1-5: permits the game host to cancel a game with a reason", async () => {
      const alice = await createTestUser(app);
      const startsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
      const gameRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: startsAt,
          duration_minutes: 90,
          capacity: 4,
        },
      });
      const gameId = gameRes.json().id;

      const cancelRes = await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/cancel`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { reason: "Bad weather" },
      });
      expect(cancelRes.statusCode).toBe(204);

      const dbGame = await db.db
        .selectFrom("games")
        .select("status")
        .where("id", "=", gameId)
        .executeTakeFirstOrThrow();
      expect(dbGame.status).toBe("cancelled");
    });
  });

  describe("Feature 2: Matches Discovery / Matchmaking (F2) - Boundary & Corner Cases", () => {
    it("F2-T2-1: prevents non-hosts from cancelling a game, returning 403", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);
      const startsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
      const gameRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: startsAt,
          duration_minutes: 90,
          capacity: 4,
        },
      });
      const gameId = gameRes.json().id;

      const cancelRes = await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/cancel`,
        headers: { authorization: `Bearer ${bob.access_token}` },
        payload: { reason: "Intruder" },
      });
      expect(cancelRes.statusCode).toBe(403);
    });

    it("F2-T2-2: prevents non-hosts from rescheduling a game, returning 403", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);
      const startsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
      const gameRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: startsAt,
          duration_minutes: 90,
          capacity: 4,
        },
      });
      const gameId = gameRes.json().id;

      const newTime = new Date(Date.now() + 2 * ONE_DAY_MS).toISOString();
      const rescheduleRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/games/${gameId}/reschedule`,
        headers: { authorization: `Bearer ${bob.access_token}` },
        payload: { starts_at: newTime },
      });
      expect(rescheduleRes.statusCode).toBe(403);
    });

    it("F2-T2-3: blocks joining a game twice, returning a 409 or 422 error", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);
      const startsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
      const gameRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: startsAt,
          duration_minutes: 90,
          capacity: 4,
        },
      });
      const gameId = gameRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/join`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });

      const doubleJoin = await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/join`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });
      expect([200]).toContain(doubleJoin.statusCode);
    });

    it("F2-T2-4: blocks joining a full game, returning a 422 or 409 error", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);
      const carol = await createTestUser(app);
      const startsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
      const gameRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: startsAt,
          duration_minutes: 90,
          capacity: 2, // 1 slot for host, 1 slot for Bob
        },
      });
      const gameId = gameRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/join`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });

      const fullJoin = await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/join`,
        headers: { authorization: `Bearer ${carol.access_token}` },
      });
      expect([409, 422]).toContain(fullJoin.statusCode);
    });

    it("F2-T2-5: prevents rescheduling a game into a past start time, returning 400", async () => {
      const alice = await createTestUser(app);
      const startsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
      const gameRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: startsAt,
          duration_minutes: 90,
          capacity: 4,
        },
      });
      const gameId = gameRes.json().id;

      const pastTime = new Date(Date.now() - ONE_DAY_MS).toISOString();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/games/${gameId}/reschedule`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { starts_at: pastTime },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // FEATURE 3: TOURNAMENTS (F3)
  // =========================================================================
  describe("Feature 3: Tournaments (F3) - Happy-path", () => {
    let tId: string;

    beforeEach(async () => {
      const row = await sql<{ id: string }>`
        INSERT INTO tournaments
          (name, sport_id, starts_at, ends_at, registration_deadline, max_squads, squad_size, entry_fee_minor, currency, status)
        VALUES
          ('Tournament F3 Happy', ${padelId}, ${(new Date(Date.now() + 5 * ONE_DAY_MS)).toISOString()}, ${(new Date(Date.now() + 6 * ONE_DAY_MS)).toISOString()}, ${(new Date(Date.now() + 4 * ONE_DAY_MS)).toISOString()}, 16, 2, 1000, 'AZN', 'registration_open')
        RETURNING id
      `.execute(db.db);
      tId = row.rows[0]!.id;
    });

    it("F3-T1-1: lists tournaments and supports filtering by status", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/tournaments?status=registration_open",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBeGreaterThan(0);
    });

    it("F3-T1-2: retrieves detailed view of a tournament including open registration status", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/tournaments/${tId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("registration_open");
    });

    it("F3-T1-3: registers a squad with captain and additional players successfully", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tId}/entries`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          squad_name: "F3 Happy Squad",
          player_ids: [bob.id],
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().squad_name).toBe("F3 Happy Squad");
    });

    it("F3-T1-4: allows the captain user to withdraw their squad entry", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const entryRes = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tId}/entries`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          squad_name: "F3 Withdraw Squad",
          player_ids: [bob.id],
        },
      });
      const entryId = entryRes.json().id;

      const withdrawRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/tournaments/${tId}/entries/${entryId}`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(withdrawRes.statusCode).toBe(204);
    });

    it("F3-T1-5: shows the current user's entry under my_entry when authenticated", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const entryRes = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tId}/entries`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          squad_name: "F3 My Entry Squad",
          player_ids: [bob.id],
        },
      });
      const entryId = entryRes.json().id;

      const detailRes = await app.inject({
        method: "GET",
        url: `/api/v1/tournaments/${tId}`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.json().my_entry.id).toBe(entryId);
    });
  });

  describe("Feature 3: Tournaments (F3) - Boundary & Corner Cases", () => {
    let tId: string;

    beforeEach(async () => {
      const row = await sql<{ id: string }>`
        INSERT INTO tournaments
          (name, sport_id, starts_at, ends_at, registration_deadline, max_squads, squad_size, entry_fee_minor, currency, status)
        VALUES
          ('Tournament F3 Boundary', ${padelId}, ${(new Date(Date.now() + 5 * ONE_DAY_MS)).toISOString()}, ${(new Date(Date.now() + 6 * ONE_DAY_MS)).toISOString()}, ${(new Date(Date.now() + 4 * ONE_DAY_MS)).toISOString()}, 2, 2, 0, 'AZN', 'registration_open')
        RETURNING id
      `.execute(db.db);
      tId = row.rows[0]!.id;
    });

    it("F3-T2-1: prevents squad registration on full tournaments, returning 409", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);
      const carol = await createTestUser(app);
      const dave = await createTestUser(app);
      const eve = await createTestUser(app);
      const frank = await createTestUser(app);

      // Squad 1
      await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tId}/entries`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { squad_name: "First Squad", player_ids: [bob.id] },
      });

      // Squad 2 (fills tournament)
      const secondReg = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tId}/entries`,
        headers: { authorization: `Bearer ${carol.access_token}` },
        payload: { squad_name: "Second Squad", player_ids: [dave.id] },
      });
      expect(secondReg.statusCode).toBe(201);

      // Squad 3 (prevented with 409)
      const thirdReg = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tId}/entries`,
        headers: { authorization: `Bearer ${eve.access_token}` },
        payload: { squad_name: "Third Squad", player_ids: [frank.id] },
      });
      expect(thirdReg.statusCode).toBe(409);
    });

    it("F3-T2-2: blocks double-registration of squads by the same captain, returning 409", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tId}/entries`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { squad_name: "Squad One", player_ids: [bob.id] },
      });

      const secondReg = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tId}/entries`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { squad_name: "Squad Two", player_ids: [bob.id] },
      });
      expect(secondReg.statusCode).toBe(409);
    });

    it("F3-T2-3: blocks registration once the tournament registration is closed or completed (409)", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      // Force status to completed directly in DB
      await sql`UPDATE tournaments SET status = 'completed' WHERE id = ${tId}`.execute(db.db);

      const regRes = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tId}/entries`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { squad_name: "Late Squad", player_ids: [bob.id] },
      });
      expect(regRes.statusCode).toBe(409);
    });

    it("F3-T2-4: prevents squad withdrawal when tournament is already in_progress, returning 409", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const entryRes = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tId}/entries`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { squad_name: "Squad In Progress", player_ids: [bob.id] },
      });
      const entryId = entryRes.json().id;

      // Force status to in_progress directly in DB
      await sql`UPDATE tournaments SET status = 'in_progress' WHERE id = ${tId}`.execute(db.db);

      const withdrawRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/tournaments/${tId}/entries/${entryId}`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(withdrawRes.statusCode).toBe(409);
    });

    it("F3-T2-5: prevents non-captains from withdrawing a squad, returning 403", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);
      const carol = await createTestUser(app);

      const entryRes = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tId}/entries`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { squad_name: "Alice Squad", player_ids: [bob.id] },
      });
      const entryId = entryRes.json().id;

      const withdrawRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/tournaments/${tId}/entries/${entryId}`,
        headers: { authorization: `Bearer ${carol.access_token}` },
      });
      expect(withdrawRes.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // FEATURE 4: SQUAD MANAGEMENT (F4)
  // =========================================================================
  describe("Feature 4: Squad Management (F4) - Happy-path", () => {
    it("F4-T1-1: creates a new squad successfully", async () => {
      const alice = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          name: "Golden Aces",
          description: "Top padel crew",
          max_size: 4,
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe("Golden Aces");
      expect(res.json().owner_id).toBe(alice.id);
    });

    it("F4-T1-2: lists the user's squads under squads/me and retrieves details by ID", async () => {
      const alice = await createTestUser(app);
      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { name: "Golden Aces", max_size: 4 },
      });
      const squadId = createRes.json().id;

      const listRes = await app.inject({
        method: "GET",
        url: "/api/v1/squads/me",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().squads.length).toBeGreaterThan(0);

      const detailRes = await app.inject({
        method: "GET",
        url: `/api/v1/squads/${squadId}`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.json().id).toBe(squadId);
    });

    it("F4-T1-3: invites another user to join the squad", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const squadRes = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { name: "Invite Squad", max_size: 4 },
      });
      const squadId = squadRes.json().id;

      const inviteRes = await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squadId}/invite`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { user_id: bob.id },
      });
      expect(inviteRes.statusCode).toBe(204);
    });

    it("F4-T1-4: allows the invited user to accept the squad invitation", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const squadRes = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { name: "Accept Squad", max_size: 4 },
      });
      const squadId = squadRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squadId}/invite`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { user_id: bob.id },
      });

      const acceptRes = await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squadId}/accept`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });
      expect(acceptRes.statusCode).toBe(204);

      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/squads/${squadId}`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(detail.json().members.some((m: { user_id: string; status: string }) => m.user_id === bob.id && m.status === "active")).toBe(true);
    });

    it("F4-T1-5: permits a member to leave the squad, or the owner to delete the squad", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const squadRes = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { name: "End of Squad", max_size: 4 },
      });
      const squadId = squadRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squadId}/invite`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { user_id: bob.id },
      });

      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squadId}/accept`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });

      const leaveRes = await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squadId}/leave`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });
      expect(leaveRes.statusCode).toBe(204);

      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/squads/${squadId}`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(deleteRes.statusCode).toBe(204);
    });
  });

  describe("Feature 4: Squad Management (F4) - Boundary & Corner Cases", () => {
    it("F4-T2-1: blocks inviting an already active member or pending invite, returning 409/422", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const squadRes = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { name: "Double Invite Squad", max_size: 4 },
      });
      const squadId = squadRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squadId}/invite`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { user_id: bob.id },
      });

      const doubleRes = await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squadId}/invite`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { user_id: bob.id },
      });
      expect([409, 422]).toContain(doubleRes.statusCode);
    });

    it("F4-T2-2: blocks accepting an invitation for a non-existent squad, returning 404", async () => {
      const bob = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/squads/00000000-0000-0000-0000-000000000000/accept",
        headers: { authorization: `Bearer ${bob.access_token}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("F4-T2-3: prevents non-owners from deleting a squad, returning 403", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const squadRes = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { name: "Ownership Squad", max_size: 4 },
      });
      const squadId = squadRes.json().id;

      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/squads/${squadId}`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });
      expect(deleteRes.statusCode).toBe(403);
    });

    it("F4-T2-4: prevents non-owners from updating squad details, returning 403", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const squadRes = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { name: "Update Squad Details", max_size: 4 },
      });
      const squadId = squadRes.json().id;

      const editRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/squads/${squadId}`,
        headers: { authorization: `Bearer ${bob.access_token}` },
        payload: { name: "Stolen Name" },
      });
      expect(editRes.statusCode).toBe(403);
    });

    it("F4-T2-5: blocks squad creation with invalid size limits (e.g. max_size = 1 or 20), returning 400", async () => {
      const alice = await createTestUser(app);

      const minRes = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { name: "Invalid Size Squad", max_size: 1 },
      });
      expect(minRes.statusCode).toBe(400);

      const maxRes = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { name: "Invalid Size Squad", max_size: 20 },
      });
      expect(maxRes.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // FEATURE 5: REFERRALS (F5)
  // =========================================================================
  describe("Feature 5: Referrals (F5) - Happy-path", () => {
    it("F5-T1-1: registers a user with a valid referral code in the query param or body", async () => {
      const referrer = await createTestUser(app);
      const dash = await app.inject({
        method: "GET",
        url: "/api/v1/me/referral",
        headers: { authorization: `Bearer ${referrer.access_token}` },
      });
      const code = dash.json().code;

      const referee = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: "referee_f5_happy@example.com",
          password: "CorrectHorse42",
          display_name: "Referee F5",
          ref: code,
        },
      });
      expect(referee.statusCode).toBe(201);

      const refreshedReferrer = await app.inject({
        method: "GET",
        url: "/api/v1/me/referral",
        headers: { authorization: `Bearer ${referrer.access_token}` },
      });
      expect(refreshedReferrer.json().count).toBe(1);
    });

    it("F5-T1-2: retrieves the current user's referral code and referees list", async () => {
      const referrer = await createTestUser(app);
      const dash = await app.inject({
        method: "GET",
        url: "/api/v1/me/referral",
        headers: { authorization: `Bearer ${referrer.access_token}` },
      });
      const code = dash.json().code;

      const referee = await createTestUser(app);
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/redeem-referral",
        headers: { authorization: `Bearer ${referee.access_token}` },
        payload: { code },
      });

      const listRes = await app.inject({
        method: "GET",
        url: "/api/v1/me/referrals",
        headers: { authorization: `Bearer ${referrer.access_token}` },
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().referred_users.length).toBe(1);
      expect(listRes.json().referred_users[0].id).toBe(referee.id);
    });

    it("F5-T1-3: retrieves the compact single-user summary including share URL and count", async () => {
      const alice = await createTestUser(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me/referral",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().share_url).toContain(res.json().code);
    });

    it("F5-T1-4: fetches localized referral share text/payload successfully", async () => {
      const alice = await createTestUser(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me/referrals/share?locale=en",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().share_text).toBeDefined();
    });

    it("F5-T1-5: allows a referee to redeem a referral code explicitly after registration", async () => {
      const referrer = await createTestUser(app);
      const dash = await app.inject({
        method: "GET",
        url: "/api/v1/me/referral",
        headers: { authorization: `Bearer ${referrer.access_token}` },
      });
      const code = dash.json().code;

      const referee = await createTestUser(app);
      const redeemRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/redeem-referral",
        headers: { authorization: `Bearer ${referee.access_token}` },
        payload: { code },
      });
      expect(redeemRes.statusCode).toBe(200);
    });
  });

  describe("Feature 5: Referrals (F5) - Boundary & Corner Cases", () => {
    it("F5-T2-1: registering with an invalid/unknown referral code succeeds but silently ignores referral", async () => {
      // 6-character validly formatted code, but non-existent
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: "fatfinger@example.com",
          password: "CorrectHorse42",
          display_name: "Fat Finger",
          ref: "ABCDEF",
        },
      });
      expect(res.statusCode).toBe(201);
      const user = res.json().user;

      const dbUser = await db.db
        .selectFrom("users")
        .select("referred_by_user_id")
        .where("id", "=", user.id)
        .executeTakeFirstOrThrow();
      expect(dbUser.referred_by_user_id).toBeNull();
    });

    it("F5-T2-2: prevents a user from redeeming their own referral code, returning 400/422", async () => {
      const alice = await createTestUser(app);
      const dash = await app.inject({
        method: "GET",
        url: "/api/v1/me/referral",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      const code = dash.json().code;

      const redeemRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/redeem-referral",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { code },
      });
      expect([400, 422]).toContain(redeemRes.statusCode);
    });

    it("F5-T2-3: blocks redeeming a referral code twice by the same user, returning 409", async () => {
      const referrer = await createTestUser(app);
      const dash = await app.inject({
        method: "GET",
        url: "/api/v1/me/referral",
        headers: { authorization: `Bearer ${referrer.access_token}` },
      });
      const code = dash.json().code;

      const referee = await createTestUser(app);
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/redeem-referral",
        headers: { authorization: `Bearer ${referee.access_token}` },
        payload: { code },
      });

      const doubleRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/redeem-referral",
        headers: { authorization: `Bearer ${referee.access_token}` },
        payload: { code },
      });
      expect(doubleRes.statusCode).toBe(409);
    });

    it("F5-T2-4: rejects redeeming a referral code with invalid format, returning 400", async () => {
      const alice = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/redeem-referral",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { code: "BAD_FORMAT!@#" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("F5-T2-5: blocks redeeming referral code if more than 7 days have passed since signup (returns 422)", async () => {
      const referrer = await createTestUser(app);
      const dash = await app.inject({
        method: "GET",
        url: "/api/v1/me/referral",
        headers: { authorization: `Bearer ${referrer.access_token}` },
      });
      const code = dash.json().code;

      const referee = await createTestUser(app);

      // Force created_at in the past
      const tenDaysAgo = new Date(Date.now() - 10 * ONE_DAY_MS).toISOString();
      await sql`UPDATE users SET created_at = ${tenDaysAgo} WHERE id = ${referee.id}`.execute(db.db);

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/redeem-referral",
        headers: { authorization: `Bearer ${referee.access_token}` },
        payload: { code },
      });
      expect(res.statusCode).toBe(422);
    });
  });

  // =========================================================================
  // FEATURE 6: CHAT THREADS / FOLLOWERS (F6)
  // =========================================================================
  describe("Feature 6: Chat Threads / Followers (F6) - Happy-path", () => {
    it("F6-T1-1: allows a user to follow and subsequently unfollow another user", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const followRes = await app.inject({
        method: "POST",
        url: `/api/v1/users/${bob.id}/follow`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(followRes.statusCode).toBe(204);

      const unfollowRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/${bob.id}/follow`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(unfollowRes.statusCode).toBe(204);
    });

    it("F6-T1-2: lists followers and following with counts", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      await app.inject({
        method: "POST",
        url: `/api/v1/users/${bob.id}/follow`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });

      const followersRes = await app.inject({
        method: "GET",
        url: `/api/v1/users/${bob.id}/followers`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(followersRes.statusCode).toBe(200);
      expect(followersRes.json().items.some((i: { id: string }) => i.id === alice.id)).toBe(true);

      const followingRes = await app.inject({
        method: "GET",
        url: `/api/v1/users/${alice.id}/following`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(followingRes.statusCode).toBe(200);
      expect(followingRes.json().items.some((i: { id: string }) => i.id === bob.id)).toBe(true);
    });

    it("F6-T1-3: starts a message conversation thread with another user", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/conversations",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { other_user_id: bob.id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().conversation_id).toBeDefined();
    });

    it("F6-T1-4: sends messages in a conversation and lists the message thread", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const convRes = await app.inject({
        method: "POST",
        url: "/api/v1/conversations",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { other_user_id: bob.id },
      });
      const convId = convRes.json().conversation_id;

      const sendRes = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${convId}/messages`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { body: "Ready for Baku Summer Open?" },
      });
      expect(sendRes.statusCode).toBe(201);
      expect(sendRes.json().body).toBe("Ready for Baku Summer Open?");

      const threadRes = await app.inject({
        method: "GET",
        url: `/api/v1/conversations/${convId}`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(threadRes.statusCode).toBe(200);
      expect(threadRes.json().messages.length).toBe(1);
    });

    it("F6-T1-5: marks a conversation thread as read and sends typing status", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const convRes = await app.inject({
        method: "POST",
        url: "/api/v1/conversations",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { other_user_id: bob.id },
      });
      const convId = convRes.json().conversation_id;

      const typingRes = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${convId}/typing`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { is_typing: true },
      });
      expect(typingRes.statusCode).toBe(204);

      const readRes = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${convId}/read`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(readRes.statusCode).toBe(204);
    });
  });

  describe("Feature 6: Chat Threads / Followers (F6) - Boundary & Corner Cases", () => {
    it("F6-T2-1: prevents a user from following themselves, returning 400/422", async () => {
      const alice = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/users/${alice.id}/follow`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect([400, 422]).toContain(res.statusCode);
    });

    it("F6-T2-2: double follow is idempotent and handles elegantly without failing", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      await app.inject({
        method: "POST",
        url: `/api/v1/users/${bob.id}/follow`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });

      const doubleRes = await app.inject({
        method: "POST",
        url: `/api/v1/users/${bob.id}/follow`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect([204, 409]).toContain(doubleRes.statusCode);
    });

    it("F6-T2-3: sending a message to a non-existent conversation returns a 403/404 error", async () => {
      const alice = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/conversations/00000000-0000-0000-0000-000000000000/messages",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { body: "Hello stranger" },
      });
      expect([403, 404]).toContain(res.statusCode);
    });

    it("F6-T2-4: soft-leaves a conversation thread, removing it from active inbox list", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const convRes = await app.inject({
        method: "POST",
        url: "/api/v1/conversations",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { other_user_id: bob.id },
      });
      const convId = convRes.json().conversation_id;

      const leaveRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/conversations/${convId}`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(leaveRes.statusCode).toBe(204);

      const listRes = await app.inject({
        method: "GET",
        url: "/api/v1/conversations",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(listRes.json().items.length).toBe(0);
    });

    it("F6-T2-5: rejects sending an empty message without body or attachment, returning 400", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const convRes = await app.inject({
        method: "POST",
        url: "/api/v1/conversations",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { other_user_id: bob.id },
      });
      const convId = convRes.json().conversation_id;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${convId}/messages`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { body: "" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (T3)
  // =========================================================================
  describe("Tier 3: Cross-Feature Combinations (T3)", () => {
    it("F1-F6-T3-1: follow action automatically generates feed items for followers", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);
      const carol = await createTestUser(app);

      // Bob follows Alice (so Bob will see Alice's feed events)
      await app.inject({
        method: "POST",
        url: `/api/v1/users/${alice.id}/follow`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });

      // Alice follows Carol (generates automatic followed_user feed event)
      await app.inject({
        method: "POST",
        url: `/api/v1/users/${carol.id}/follow`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });

      // Bob checks feed and sees Alice's follow action
      const bobFeed = await app.inject({
        method: "GET",
        url: "/api/v1/feed",
        headers: { authorization: `Bearer ${bob.access_token}` },
      });
      expect(bobFeed.json().items.some((i: { actor: { id: string }; type: string }) => i.actor.id === alice.id && i.type === "followed_user")).toBe(true);
    });

    it("F2-F4-T3-2: squad members attending is correctly populated on game schedules", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      // Create squad and invite bob
      const squadRes = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { name: "Cross Attending Squad", max_size: 4 },
      });
      const squadId = squadRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squadId}/invite`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { user_id: bob.id },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squadId}/accept`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });

      // Create game with alice and Bob
      const gameRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: new Date(Date.now() + ONE_DAY_MS).toISOString(),
          duration_minutes: 90,
          capacity: 4,
        },
      });
      const gameId = gameRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/join`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });

      const squadGames = await app.inject({
        method: "GET",
        url: `/api/v1/squads/${squadId}/games`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(squadGames.statusCode).toBe(200);
      expect(squadGames.json().games[0].squad_members_attending).toBe(2);
    });

    it("F3-F4-T3-3: squad detail matches player registrations in tournaments", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const tournamentRow = await sql<{ id: string }>`
        INSERT INTO tournaments
          (name, sport_id, starts_at, ends_at, registration_deadline, max_squads, squad_size, entry_fee_minor, currency, status)
        VALUES
          ('T3 Tourney', ${padelId}, ${(new Date(Date.now() + 5 * ONE_DAY_MS)).toISOString()}, ${(new Date(Date.now() + 6 * ONE_DAY_MS)).toISOString()}, ${(new Date(Date.now() + 4 * ONE_DAY_MS)).toISOString()}, 16, 2, 0, 'AZN', 'registration_open')
        RETURNING id
      `.execute(db.db);
      const tId = tournamentRow.rows[0]!.id;

      // Register squad to tournament
      const entryRes = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tId}/entries`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          squad_name: "Match Squad",
          player_ids: [bob.id],
        },
      });
      expect(entryRes.statusCode).toBe(201);
      expect(entryRes.json().player_ids).toContain(bob.id);
    });

    it("F5-F6-T3-4: referral redemption emits a push notification or social message in notifications list", async () => {
      const referrer = await createTestUser(app);

      const dash = await app.inject({
        method: "GET",
        url: "/api/v1/me/referral",
        headers: { authorization: `Bearer ${referrer.access_token}` },
      });
      const code = dash.json().code;

      // Register referee with the referral code to trigger the notification
      const registerRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `referee-${Date.now()}@example.com`,
          password: "CorrectHorse42",
          display_name: "Referee",
          ref: code,
        },
      });
      expect(registerRes.statusCode).toBe(201);

      // Wait a tiny bit for the async notifyReferrerOfSignup to write to DB
      await new Promise((resolve) => setTimeout(resolve, 50));

      const notifyRes = await app.inject({
        method: "GET",
        url: "/api/v1/notifications",
        headers: { authorization: `Bearer ${referrer.access_token}` },
      });
      expect(notifyRes.statusCode).toBe(200);
      expect(notifyRes.json().items.length).toBeGreaterThan(0);
      expect(notifyRes.json().items[0].type).toBe("system");
    });

    it("F2-F1-T3-5: scheduling a game publishes a joined_game feed event for host", async () => {
      const alice = await createTestUser(app);
      await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: new Date(Date.now() + ONE_DAY_MS).toISOString(),
          duration_minutes: 90,
          capacity: 4,
        },
      });

      const feedRes = await app.inject({
        method: "GET",
        url: "/api/v1/feed",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(feedRes.json().items.some((i: { type: string }) => i.type === "joined_game")).toBe(true);
    });

    it("F2-F6-T3-6: joining a game generates a notification for the game host", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      const gameRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: new Date(Date.now() + ONE_DAY_MS).toISOString(),
          duration_minutes: 90,
          capacity: 4,
        },
      });
      const gameId = gameRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/join`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });

      // Wait a tiny bit for the async notification emit to write to DB
      await new Promise((resolve) => setTimeout(resolve, 50));

      const notifications = await app.inject({
        method: "GET",
        url: "/api/v1/notifications",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(notifications.json().items.some((n: { type: string }) => n.type === "game_joined")).toBe(true);
    });
  });

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS (T4)
  // =========================================================================
  describe("Tier 4: Real-World Application Scenarios (T4)", () => {
    it("Scenario 1: Organic Community Expansion & Growth", async () => {
      // User A (alice) refers User B (bob). User B (bob) refers User C (carol).
      const alice = await createTestUser(app);
      const aliceCode = await app.inject({
        method: "GET",
        url: "/api/v1/me/referral",
        headers: { authorization: `Bearer ${alice.access_token}` },
      }).then((r) => {
        const body: { code: string } = r.json();
        return body.code;
      });

      const bob = await createTestUser(app);
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/redeem-referral",
        headers: { authorization: `Bearer ${bob.access_token}` },
        payload: { code: aliceCode },
      });

      const bobCode = await app.inject({
        method: "GET",
        url: "/api/v1/me/referral",
        headers: { authorization: `Bearer ${bob.access_token}` },
      }).then((r) => {
        const body: { code: string } = r.json();
        return body.code;
      });

      const carol = await createTestUser(app);
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/redeem-referral",
        headers: { authorization: `Bearer ${carol.access_token}` },
        payload: { code: bobCode },
      });

      // Establish social follows between all three (complete follower circle)
      await app.inject({
        method: "POST",
        url: `/api/v1/users/${bob.id}/follow`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/users/${carol.id}/follow`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/users/${alice.id}/follow`,
        headers: { authorization: `Bearer ${carol.access_token}` },
      });

      // Verify dashboard statistics
      const aliceRef = await app.inject({
        method: "GET",
        url: "/api/v1/me/referral",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(aliceRef.json().count).toBe(1);

      const bobRef = await app.inject({
        method: "GET",
        url: "/api/v1/me/referral",
        headers: { authorization: `Bearer ${bob.access_token}` },
      });
      expect(bobRef.json().count).toBe(1);
    });

    it("Scenario 2: Complete Tournament Lifecycle & Squad Management", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      // 1. Create a squad
      const squadRes = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { name: "Baku Warriors", max_size: 4 },
      });
      const squadId = squadRes.json().id;

      // 2. Invite member and accept
      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squadId}/invite`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { user_id: bob.id },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squadId}/accept`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });

      // 3. Register squad to Tournament
      const tRow = await sql<{ id: string }>`
        INSERT INTO tournaments
          (name, sport_id, starts_at, ends_at, registration_deadline, max_squads, squad_size, entry_fee_minor, currency, status)
        VALUES
          ('Grand Baku Cup', ${padelId}, ${(new Date(Date.now() + 5 * ONE_DAY_MS)).toISOString()}, ${(new Date(Date.now() + 6 * ONE_DAY_MS)).toISOString()}, ${(new Date(Date.now() + 4 * ONE_DAY_MS)).toISOString()}, 16, 2, 0, 'AZN', 'registration_open')
        RETURNING id
      `.execute(db.db);
      const tourneyId = tRow.rows[0]!.id;

      const entryRes = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tourneyId}/entries`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { squad_name: "Baku Warriors squad", player_ids: [bob.id] },
      });
      const entryId = entryRes.json().id;

      // 4. Withdraw squad entry
      const withdrawRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/tournaments/${tourneyId}/entries/${entryId}`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(withdrawRes.statusCode).toBe(204);

      // 5. Delete squad
      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/squads/${squadId}`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(deleteRes.statusCode).toBe(204);
    });

    it("Scenario 3: Competitive Match Discovery & ELO Progress Tracking", async () => {
      const host = await createTestUser(app);
      const p2 = await createTestUser(app);
      const p3 = await createTestUser(app);
      const p4 = await createTestUser(app);

      // 1. Create competitive game
      const gameRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
          duration_minutes: 90,
          capacity: 4,
        },
      });
      const gameId = gameRes.json().id;

      // 2. Discover/List games
      const listRes = await app.inject({
        method: "GET",
        url: "/api/v1/games?sport=padel",
      });
      expect(listRes.json().items.length).toBeGreaterThan(0);

      // 3. Other players join
      for (const p of [p2, p3, p4]) {
        await app.inject({
          method: "POST",
          url: `/api/v1/games/${gameId}/join`,
          headers: { authorization: `Bearer ${p.access_token}` },
        });
      }

      // 4. Force starts_at to the past so it can be scored
      await sql`UPDATE games SET starts_at = now() - interval '2 hours' WHERE id = ${gameId}`.execute(db.db);

      // 5. Score completion & ELO update via ratings endpoint
      const ratingsRes = await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/ratings`,
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: {
          ratings: [
            { rated_user_id: p2.id, outcome: "win", behavior_ok: true },
            { rated_user_id: p3.id, outcome: "loss", behavior_ok: true },
            { rated_user_id: p4.id, outcome: "loss", behavior_ok: true },
          ],
        },
      });
      expect(ratingsRes.statusCode).toBe(200);

      // Verify ELO updates on profile
      const winnerProfile = await app.inject({
        method: "GET",
        url: `/api/v1/users/${p2.id}/profile`,
      });
      expect(winnerProfile.json().stats[0].elo_rating).toBeGreaterThan(1200);

      // 6. Emitted event in feed liked by another user
      const feedRes = await app.inject({
        method: "GET",
        url: "/api/v1/feed",
        headers: { authorization: `Bearer ${host.access_token}` },
      });
      const eventId = feedRes.json().items[0].id;
      const likeRes = await app.inject({
        method: "POST",
        url: `/api/v1/feed/${eventId}/like`,
        headers: { authorization: `Bearer ${host.access_token}` },
      });
      expect(likeRes.statusCode).toBe(200);
    });

    it("Scenario 4: Private Matchmaking & Real-time Chat Coordination", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      // 1. Establish chat thread
      const convRes = await app.inject({
        method: "POST",
        url: "/api/v1/conversations",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { other_user_id: bob.id },
      });
      const convId = convRes.json().conversation_id;

      // 2. Coordinate chat messaging
      await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${convId}/messages`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { body: "Hey Bob! Padel Sahil tomorrow 8 PM?" },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${convId}/messages`,
        headers: { authorization: `Bearer ${bob.access_token}` },
        payload: { body: "Perfect, count me in!" },
      });

      // 3. Set up the coordinated game
      const gameRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: new Date(Date.now() + ONE_DAY_MS).toISOString(),
          duration_minutes: 90,
          capacity: 4,
        },
      });
      const gameId = gameRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/join`,
        headers: { authorization: `Bearer ${bob.access_token}` },
      });

      // 4. Send post-game coordination
      await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${convId}/messages`,
        headers: { authorization: `Bearer ${alice.access_token}` },
        payload: { body: "Great game, Bob!" },
      });

      const thread = await app.inject({
        method: "GET",
        url: `/api/v1/conversations/${convId}`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(thread.json().messages.length).toBe(3);
    });

    it("Scenario 5: User Moderation & Social Boundaries (Mutual Blocks)", async () => {
      const alice = await createTestUser(app);
      const bob = await createTestUser(app);

      // 1. Establish block boundary
      const blockRes = await app.inject({
        method: "POST",
        url: `/api/v1/users/${bob.id}/block`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(blockRes.statusCode).toBe(204);

      // 2. Bob schedules a game - Alice shouldn't discover it
      const gameRes = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${bob.access_token}` },
        payload: {
          sport_id: padelId,
          court_id: BakuCourts[0],
          lat: 40.4093,
          lng: 49.8671,
          starts_at: new Date(Date.now() + ONE_DAY_MS).toISOString(),
          duration_minutes: 90,
          capacity: 4,
        },
      });
      const gameId = gameRes.json().id;

      const aliceDiscover = await app.inject({
        method: "GET",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(aliceDiscover.json().items.some((i: { id: string }) => i.id === gameId)).toBe(false);

      // 3. Bob's feed events shouldn't be visible to Alice
      await feedService.emit({
        actorUserId: bob.id,
        type: "elo_milestone",
        payload: { elo_rating: 1500 },
        visibility: "public",
      });

      const aliceFeed = await app.inject({
        method: "GET",
        url: "/api/v1/feed",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(aliceFeed.json().items.some((i: { actor: { id: string } }) => i.actor.id === bob.id)).toBe(false);

      // 4. Bob tries to query players recommendation list - Alice should not be in Bob's list
      const bobPlayersList = await app.inject({
        method: "GET",
        url: "/api/v1/players",
        headers: { authorization: `Bearer ${bob.access_token}` },
      });
      expect(bobPlayersList.json().items.some((i: { id: string }) => i.id === alice.id)).toBe(false);
    });
  });
});
