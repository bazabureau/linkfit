import { sql } from "kysely";
import { type DbHandle } from "../../src/shared/db/pool.js";
import { type LinkfitServer } from "../../src/shared/http/server.js";

export interface TestUser {
  id: string;
  email: string;
  access_token: string;
  refresh_token: string;
}

let userCounter = 0;
export async function createTestUser(
  app: LinkfitServer,
  overrides: { email?: string; password?: string; display_name?: string } = {},
): Promise<TestUser> {
  userCounter += 1;
  const email = overrides.email ?? `t-${Date.now()}-${userCounter}@example.com`;
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: {
      email,
      password: overrides.password ?? "CorrectHorse42",
      display_name: overrides.display_name ?? `T${String(userCounter)}`,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createTestUser failed: ${String(res.statusCode)} ${res.body}`);
  }
  const body = res.json<{
    user: { id: string; email: string };
    access_token: string;
    refresh_token: string;
  }>();
  return {
    id: body.user.id,
    email: body.user.email,
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  };
}

/**
 * Reusable fixture helpers for integration tests. Keep these tight — they
 * insert just enough to make a scenario meaningful, never realistic survey
 * data.
 */

export async function truncateAll(db: DbHandle): Promise<void> {
  await sql`
    TRUNCATE TABLE
      notification_preferences,
      feed_event_reactions,
      feed_cursor,
      feed_events,
      data_export_requests,
      account_deletion_requests,
      venue_reviews,
      payment_splits,
      bookings,
      reports,
      follows,
      medical_profiles,
      tournament_waivers,
      tournament_entries,
      tournaments,
      messages,
      conversation_participants,
      conversations,
      device_tokens,
      daily_digest_sent,
      notifications,
      audit_log,
      ratings,
      player_sport_stats,
      game_invitations,
      game_participants,
      games,
      game_series,
      refresh_tokens,
      signup_attempts,
      users,
      courts,
      venues
    RESTART IDENTITY CASCADE
  `.execute(db.db);
}

export interface SeedVenue {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/**
 * Seed three venues around (40.4093, 49.8671) [central Baku] with one Padel
 * court each. Distance from origin:
 *   - "Padel Hub Sahil"    ~ 200 m  N
 *   - "Padel Yasamal"      ~ 3.5 km W
 *   - "Padel Khirdalan"    ~ 18 km  NW
 */
export async function seedBakuPadelVenues(db: DbHandle): Promise<SeedVenue[]> {
  const venues: SeedVenue[] = [
    { id: "", name: "Padel Hub Sahil",  lat: 40.41110, lng: 49.86710 },
    { id: "", name: "Padel Yasamal",    lat: 40.40930, lng: 49.82610 },
    { id: "", name: "Padel Khirdalan",  lat: 40.55000, lng: 49.74000 },
  ];

  for (const v of venues) {
    const row = await db.db
      .insertInto("venues")
      .values({
        name: v.name,
        address: v.name + " address",
        lat: v.lat.toString(),
        lng: v.lng.toString(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    v.id = row.id;

    const sport = await db.db
      .selectFrom("sports")
      .select("id")
      .where("slug", "=", "padel")
      .executeTakeFirstOrThrow();

    await db.db
      .insertInto("courts")
      .values({
        venue_id: v.id,
        sport_id: sport.id,
        name: "Court 1",
        hourly_price_minor: 5000,
      })
      .execute();
  }
  return venues;
}

/**
 * Promote an existing test user directly to admin (or moderator). Used by
 * admin-suite tests to bypass the bootstrap seed and pick a specific actor.
 */
export async function promoteToAdmin(
  db: DbHandle,
  userId: string,
  role: "admin" | "moderator" = "admin",
): Promise<void> {
  await db.db
    .updateTable("users")
    .set({ admin_role: role })
    .where("id", "=", userId)
    .execute();
}
