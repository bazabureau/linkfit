import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";

/**
 * Repository for the email-digest agent.
 *
 * We can't extend the Kysely `Database` interface from this module (the type
 * definitions live outside the digest's file-ownership boundary), so every
 * query here uses Kysely's `sql` template tag with an explicit row type.
 * That keeps the rest of the codebase happy while still giving us
 * end-to-end typing on the digest's columns.
 */

export interface DigestRecipient {
  user_id: string;
  email: string;
  display_name: string;
}

export interface UpcomingGame {
  game_id: string;
  starts_at: Date;
  sport_slug: string;
  venue_name: string | null;
  city_lat: string;
  city_lng: string;
}

export interface NewFollower {
  follower_user_id: string;
  display_name: string;
  followed_at: Date;
}

export interface FriendActivity {
  actor_user_id: string;
  actor_display_name: string;
  type: string;
  created_at: Date;
}

export interface BadgeUnlocked {
  achievement_slug: string;
  name: string;
  unlocked_at: Date;
}

export const digestRepository = {
  /**
   * Recipients of the weekly digest. The filter is:
   *
   *   - `email_verified_at IS NOT NULL` — never mail an unverified address;
   *     the email transport would deliver but the user might not be on the
   *     hook to receive (could be a typo, captured-domain, etc).
   *   - `notification_preferences->>'weekly_digest' = 'true'` — explicit
   *     opt-in. Defaulting to `{}` means no row is included until the user
   *     enables the preference via the iOS client.
   *   - `deleted_at IS NULL` — never reach into soft-deleted accounts.
   */
  async weeklyDigestRecipients(db: DbHandle): Promise<DigestRecipient[]> {
    const rows = await sql<DigestRecipient>`
      SELECT id AS user_id, email, display_name
        FROM users
       WHERE email_verified_at IS NOT NULL
         AND deleted_at IS NULL
         AND (notification_preferences ->> 'weekly_digest') = 'true'
       ORDER BY created_at ASC
    `.execute(db.db);
    return rows.rows;
  },

  /**
   * Upcoming games the recipient is participating in (host or joiner).
   * We pull the next 7 days because "weekly digest" implies a "what's coming
   * this week" framing. Cap at 10 — past that the email gets unwieldy.
   */
  async upcomingGamesFor(
    db: DbHandle,
    userId: string,
  ): Promise<UpcomingGame[]> {
    const rows = await sql<UpcomingGame>`
      SELECT g.id AS game_id,
             g.starts_at,
             s.slug AS sport_slug,
             v.name AS venue_name,
             g.lat  AS city_lat,
             g.lng  AS city_lng
        FROM games g
        JOIN sports s ON s.id = g.sport_id
        LEFT JOIN courts c ON c.id = g.court_id
        LEFT JOIN venues v ON v.id = c.venue_id
        LEFT JOIN game_participants gp
               ON gp.game_id = g.id
              AND gp.user_id = ${userId}::uuid
              AND gp.status = 'confirmed'
       WHERE g.status IN ('open', 'full')
         AND g.starts_at >= now()
         AND g.starts_at < now() + interval '7 days'
         AND (g.host_user_id = ${userId}::uuid OR gp.user_id IS NOT NULL)
       ORDER BY g.starts_at ASC
       LIMIT 10
    `.execute(db.db);
    return rows.rows;
  },

  /**
   * Users who started following the recipient in the past 7 days. The iOS
   * "Followers" tab shows the same list — the digest is a re-push for users
   * who haven't opened the app in a while.
   */
  async newFollowersFor(
    db: DbHandle,
    userId: string,
  ): Promise<NewFollower[]> {
    const rows = await sql<NewFollower>`
      SELECT f.follower_user_id,
             u.display_name,
             f.created_at AS followed_at
        FROM follows f
        JOIN users u ON u.id = f.follower_user_id AND u.deleted_at IS NULL
       WHERE f.followed_user_id = ${userId}::uuid
         AND f.created_at >= now() - interval '7 days'
       ORDER BY f.created_at DESC
       LIMIT 10
    `.execute(db.db);
    return rows.rows;
  },

  /**
   * Recent activity from people the recipient follows. Pulls from
   * `feed_events` so we re-use the existing fan-out worker's data — no
   * duplicated source-table reads.
   */
  async friendActivityFor(
    db: DbHandle,
    userId: string,
  ): Promise<FriendActivity[]> {
    const rows = await sql<FriendActivity>`
      SELECT fe.actor_user_id,
             u.display_name AS actor_display_name,
             fe.type::text  AS type,
             fe.created_at
        FROM feed_events fe
        JOIN follows f ON f.followed_user_id = fe.actor_user_id
                       AND f.follower_user_id = ${userId}::uuid
        JOIN users u   ON u.id = fe.actor_user_id AND u.deleted_at IS NULL
       WHERE fe.created_at >= now() - interval '7 days'
         AND fe.visibility IN ('public', 'followers')
       ORDER BY fe.created_at DESC
       LIMIT 10
    `.execute(db.db);
    return rows.rows;
  },

  /**
   * Badges unlocked by the recipient in the past 7 days.
   */
  async badgesUnlockedFor(
    db: DbHandle,
    userId: string,
  ): Promise<BadgeUnlocked[]> {
    const rows = await sql<BadgeUnlocked>`
      SELECT ua.achievement_slug,
             a.name,
             ua.unlocked_at
        FROM user_achievements ua
        JOIN achievements a ON a.slug = ua.achievement_slug
       WHERE ua.user_id = ${userId}::uuid
         AND ua.unlocked_at >= now() - interval '7 days'
       ORDER BY ua.unlocked_at DESC
       LIMIT 10
    `.execute(db.db);
    return rows.rows;
  },

  /**
   * Idempotency probe: did we already send this user the digest of `kind`
   * today? The composite PK in the migration is
   * `(user_id, kind, sent_on)` where `sent_on` is a materialized
   * UTC-calendar-day column, so the INSERT below collides on a second
   * same-day write.
   *
   * We return a boolean (`true` if a brand-new row was inserted, `false`
   * when the insert was a no-op because the row already existed). Callers
   * use this to decide whether the *send* should happen — never insert
   * speculatively, the send is what makes the log entry truthful.
   */
  async logIfFresh(
    db: DbHandle,
    userId: string,
    kind: string,
    now: Date,
  ): Promise<boolean> {
    // `ON CONFLICT DO NOTHING` with no returning row means "already sent
    // today". rowCount tells us whether the insert actually wrote. We
    // compute `sent_on` in JS (UTC) so the value matches whatever the
    // service's `now()` factory returned — important for the scheduler
    // tests that drive a frozen clock.
    const sentOnUtc = now.toISOString().slice(0, 10);
    const result = await sql`
      INSERT INTO email_digest_log (user_id, kind, sent_at, sent_on)
      VALUES (
        ${userId}::uuid,
        ${kind},
        ${now.toISOString()}::timestamptz,
        ${sentOnUtc}::date
      )
      ON CONFLICT (user_id, kind, sent_on) DO NOTHING
    `.execute(db.db);
    // Kysely returns numRows / numUpdatedOrDeletedRows depending on driver.
    // node-postgres surfaces `numAffectedRows` as a BigInt.
    const affected = result.numAffectedRows ?? 0n;
    return Number(affected) > 0;
  },

  /** Test-only convenience — pre-seed a "we already sent today" row. */
  async backfillSent(
    db: DbHandle,
    userId: string,
    kind: string,
    sentAt: Date,
  ): Promise<void> {
    const sentOnUtc = sentAt.toISOString().slice(0, 10);
    await sql`
      INSERT INTO email_digest_log (user_id, kind, sent_at, sent_on)
      VALUES (
        ${userId}::uuid,
        ${kind},
        ${sentAt.toISOString()}::timestamptz,
        ${sentOnUtc}::date
      )
      ON CONFLICT (user_id, kind, sent_on) DO NOTHING
    `.execute(db.db);
  },

  /** Test-only helper — count log rows for a given user+kind. */
  async logCount(
    db: DbHandle,
    userId: string,
    kind: string,
  ): Promise<number> {
    const row = await sql<{ count: string }>`
      SELECT COUNT(*)::text AS count
        FROM email_digest_log
       WHERE user_id = ${userId}::uuid
         AND kind = ${kind}
    `.execute(db.db);
    return Number.parseInt(row.rows[0]?.count ?? "0", 10);
  },

  /**
   * Opt a user into the weekly digest. Used by the test suite to bypass the
   * full iOS preferences flow — production code paths read the preferences
   * blob directly without going through this helper.
   */
  async setWeeklyDigestPref(
    db: DbHandle,
    userId: string,
    enabled: boolean,
  ): Promise<void> {
    await sql`
      UPDATE users
         SET notification_preferences =
               COALESCE(notification_preferences, '{}'::jsonb)
               || jsonb_build_object('weekly_digest', ${enabled}::boolean)
       WHERE id = ${userId}::uuid
    `.execute(db.db);
  },

  /**
   * Test-only — flip `email_verified_at` on a user without going through the
   * Email agent's full magic-link flow.
   */
  async markVerified(db: DbHandle, userId: string): Promise<void> {
    await sql`
      UPDATE users
         SET email_verified_at = now()
       WHERE id = ${userId}::uuid
         AND email_verified_at IS NULL
    `.execute(db.db);
  },
};

export type DigestRepository = typeof digestRepository;
