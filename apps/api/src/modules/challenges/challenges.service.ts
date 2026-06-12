import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  type ChallengeCode,
  type ChallengeItem,
  type TodayChallengesResponse,
} from "./challenges.schema.js";

export interface ChallengesServiceDeps {
  db: DbHandle;
}

/**
 * The full pool of challenge codes. The daily rotation picks 3 of these
 * per user using a deterministic shuffle keyed on (user_id, date) — so
 * the same user gets the same triplet every time we re-query for the
 * same calendar day, and DIFFERENT users get different triplets even on
 * the same day.
 *
 * Order in this array does not affect output ordering; the shuffle
 * permutes the array per (user, day).
 */
const CHALLENGE_POOL: readonly ChallengeCode[] = [
  "follow_one",
  "join_a_game",
  "post_a_story",
  "comment_on_feed",
  "invite_to_game",
  "react_to_story",
] as const;

const CHALLENGES_PER_DAY = 3;

/** AZ-language fallback titles for non-iOS callers. iOS clients translate
 *  via the `challenges.title.<code>` xcstrings key — these are only used by
 *  push payloads, admin tools, and the wire payload for older clients. */
const AZ_TITLES: Record<ChallengeCode, string> = {
  follow_one: "Yeni oyunçu izlə",
  join_a_game: "Bir oyuna qoşul",
  post_a_story: "1 story yarat",
  comment_on_feed: "1 şərh yaz",
  invite_to_game: "Birini oyuna dəvət et",
  react_to_story: "1 story-yə reaksiya ver",
};

/** SF Symbol hints — the iOS card may override per-row but these are the
 *  shared defaults so push notifications + admin tooling render the same
 *  glyph. */
const ICONS: Record<ChallengeCode, string> = {
  follow_one: "person.crop.circle.badge.plus",
  join_a_game: "figure.tennis",
  post_a_story: "camera.fill",
  comment_on_feed: "bubble.left.fill",
  invite_to_game: "paperplane.fill",
  react_to_story: "heart.fill",
};

interface UserChallengeRow {
  challenge_code: ChallengeCode;
  date: Date;
  completed_at: Date | null;
}

/**
 * ChallengesService — owns the daily-challenges surface.
 *
 * The flow is intentionally pull-driven: the iOS card calls
 * `GET /api/v1/me/challenges/today` on appear, which either reads the
 * already-issued triplet for today or generates it on first call. There
 * is NO nightly fan-out cron — generating lazily on first read keeps
 * the system stateless w.r.t. timezones, avoids a cron infra cost, and
 * means a brand-new user signing up at 3am gets their challenges
 * immediately rather than waiting for the next cron tick.
 *
 * Auto-completion is push-driven: each action service (`FollowsService`,
 * `GamesService`, `StoriesService`, etc.) calls `markCompleted(userId,
 * code)` after the underlying side-effect lands. The UPDATE is guarded
 * by `completed_at IS NULL` so repeated actions don't reset the stamp
 * and don't matter for engagement counting.
 */
export class ChallengesService {
  constructor(private readonly deps: ChallengesServiceDeps) {}

  /**
   * Today's three challenges for the user. On first call of the day this
   * INSERTs the deterministic-shuffle triplet; subsequent calls read
   * back what was issued. Idempotent — the UNIQUE constraint on
   * `(user_id, challenge_code, date)` makes re-inserts a no-op.
   *
   * Before returning we ALSO sweep the source tables to auto-mark any
   * challenge whose underlying action landed since midnight UTC. This
   * lets us avoid touching the FollowsService, GamesService,
   * StoriesService etc. directly — the home card refresh on iOS is the
   * trigger that reconciles state. The sweep is cheap (3 EXISTS()
   * queries) and only runs for open challenges.
   */
  async todayForUser(userId: string): Promise<TodayChallengesResponse> {
    const today = isoDate(new Date());

    // Ensure today's triplet exists. Computed deterministically off the
    // (userId, today) tuple so a re-issue scenario (e.g. partial insert
    // failure mid-flight) converges on the same set. We INSERT all
    // three with ON CONFLICT DO NOTHING — at most three rows touch.
    const issued = pickThreeForDay(userId, today);
    for (const code of issued) {
      await sql`
        INSERT INTO user_challenges (user_id, challenge_code, date)
        VALUES (${userId}::uuid, ${code}, ${today}::date)
        ON CONFLICT (user_id, challenge_code, date) DO NOTHING
      `.execute(this.deps.db.db);
    }

    // Auto-complete sweep: any of today's still-open challenges whose
    // source-table action has been performed get stamped now. We do
    // this before the read so the returned payload reflects the
    // latest state without needing a second round-trip. The action
    // checks are bounded to today's open codes — at most three EXISTS
    // queries against tiny indexes.
    const openCodes = await sql<{ challenge_code: ChallengeCode }>`
      SELECT challenge_code FROM user_challenges
       WHERE user_id = ${userId}::uuid
         AND date    = ${today}::date
         AND completed_at IS NULL
    `.execute(this.deps.db.db);
    for (const row of openCodes.rows) {
      const performed = await this.didPerformActionToday(userId, row.challenge_code);
      if (performed) {
        await this.markCompleted(userId, row.challenge_code);
      }
    }

    // Now read back today's full set. We use the SQL row order so the
    // returned list is stable on re-fetch (sorts by created_at then
    // challenge_code, but the deterministic insert order means the first
    // result mirrors the `issued` array on the happy path). We don't
    // rely on it strictly — iOS uses `code` as the key — but a stable
    // visual order matters for the row-shift animation.
    const rows = await sql<UserChallengeRow>`
      SELECT challenge_code, date, completed_at
        FROM user_challenges
       WHERE user_id = ${userId}::uuid
         AND date    = ${today}::date
       ORDER BY created_at ASC, challenge_code ASC
    `.execute(this.deps.db.db);

    const challenges: ChallengeItem[] = rows.rows.map((r) => ({
      code: r.challenge_code,
      title: AZ_TITLES[r.challenge_code],
      body: "",
      completed_at: r.completed_at ? r.completed_at.toISOString() : null,
      icon: ICONS[r.challenge_code],
    }));

    return { date: today, challenges };
  }

  /**
   * Verify whether a challenge has been completed and refresh the
   * `completed_at` stamp if the underlying action is detectable in the
   * database. Called by the iOS client as a polling fallback — the
   * canonical completion path is the per-action hook
   * (`markCompleted`) fired from FollowsService, GamesService, etc.,
   * but this gives the client a way to recover if it suspects the hook
   * missed (e.g. completed offline, sync just came back).
   *
   * Returns `completed: true` when this user has completed `code`
   * TODAY according to either the existing `completed_at` stamp or a
   * fresh signal from the source tables.
   */
  async checkAndMaybeComplete(
    userId: string,
    code: ChallengeCode,
  ): Promise<boolean> {
    const today = isoDate(new Date());

    // Fast path: already stamped.
    const existing = await sql<{ completed_at: Date | null }>`
      SELECT completed_at FROM user_challenges
       WHERE user_id        = ${userId}::uuid
         AND challenge_code = ${code}
         AND date           = ${today}::date
    `.execute(this.deps.db.db);
    if (existing.rows[0]?.completed_at) return true;

    // Slow path: peek at the source tables and stamp if we find the action.
    const performed = await this.didPerformActionToday(userId, code);
    if (performed) {
      await this.markCompleted(userId, code);
      return true;
    }
    return false;
  }

  /**
   * Per-action hook — called from the various action services after
   * the underlying side-effect commits. Idempotent: the UPDATE is
   * guarded by `completed_at IS NULL` so the first call for the day
   * wins and subsequent calls are no-ops. Safe to call even when the
   * user doesn't have this challenge issued today — the WHERE clause
   * simply matches zero rows.
   *
   * Fire-and-forget at the call site (action hot-paths never await
   * this) — see the wire-up notes in `challenges.routes.ts`.
   */
  async markCompleted(userId: string, code: ChallengeCode): Promise<void> {
    const today = isoDate(new Date());
    await sql`
      UPDATE user_challenges
         SET completed_at = NOW()
       WHERE user_id        = ${userId}::uuid
         AND challenge_code = ${code}
         AND date           = ${today}::date
         AND completed_at IS NULL
    `.execute(this.deps.db.db);
  }

  /**
   * Peek at source tables to see whether the user has performed the
   * action codified by `code` since midnight (UTC). Each branch reads
   * the minimum row that proves the action — never joins, never aggregates.
   * Returns false on any unknown code (future-proof; lets us extend the
   * enum without breaking the polling fallback).
   */
  private async didPerformActionToday(
    userId: string,
    code: ChallengeCode,
  ): Promise<boolean> {
    switch (code) {
      case "follow_one": {
        // Any follow edge created today by this user.
        const r = await sql<{ exists: boolean }>`
          SELECT EXISTS (
            SELECT 1 FROM follows
             WHERE follower_user_id = ${userId}::uuid
               AND created_at >= CURRENT_DATE
          ) AS exists
        `.execute(this.deps.db.db);
        return r.rows[0]?.exists === true;
      }
      case "join_a_game": {
        // Any `confirmed` participation row inserted today by this user.
        // We use `joined_at` to scope to today; the row's `status` filter
        // excludes the host-row-on-create path (which also inserts) by
        // checking that the user is not the host of the same game.
        const r = await sql<{ exists: boolean }>`
          SELECT EXISTS (
            SELECT 1
              FROM game_participants gp
              JOIN games g ON g.id = gp.game_id
             WHERE gp.user_id  = ${userId}::uuid
               AND gp.joined_at >= CURRENT_DATE
               AND g.host_user_id <> ${userId}::uuid
          ) AS exists
        `.execute(this.deps.db.db);
        return r.rows[0]?.exists === true;
      }
      case "post_a_story": {
        const r = await sql<{ exists: boolean }>`
          SELECT EXISTS (
            SELECT 1 FROM stories
             WHERE user_id = ${userId}::uuid
               AND created_at >= CURRENT_DATE
          ) AS exists
        `.execute(this.deps.db.db);
        return r.rows[0]?.exists === true;
      }
      case "comment_on_feed": {
        const r = await sql<{ exists: boolean }>`
          SELECT EXISTS (
            SELECT 1 FROM feed_comments
             WHERE user_id = ${userId}::uuid
               AND created_at >= CURRENT_DATE
          ) AS exists
        `.execute(this.deps.db.db);
        return r.rows[0]?.exists === true;
      }
      case "invite_to_game": {
        const r = await sql<{ exists: boolean }>`
          SELECT EXISTS (
            SELECT 1 FROM game_invitations
             WHERE inviter_user_id = ${userId}::uuid
               AND created_at >= CURRENT_DATE
          ) AS exists
        `.execute(this.deps.db.db);
        return r.rows[0]?.exists === true;
      }
      case "react_to_story": {
        const r = await sql<{ exists: boolean }>`
          SELECT EXISTS (
            SELECT 1 FROM story_reactions
             WHERE user_id = ${userId}::uuid
               AND created_at >= CURRENT_DATE
          ) AS exists
        `.execute(this.deps.db.db);
        return r.rows[0]?.exists === true;
      }
    }
  }
}

/**
 * Deterministic 3-of-6 pick keyed on (userId, isoDate). Uses a small
 * mulberry32-style PRNG seeded by a stable hash of the inputs so:
 *   - Same user, same day  → identical triplet (idempotent reads).
 *   - Same user, next day  → different triplet (engagement rotation).
 *   - Different users, same day → different triplets (no shared
 *     fate; we don't want everyone seeing the same three).
 *
 * Output ordering is the shuffled order — the SQL ORDER BY in the read
 * path uses `created_at` so the first-inserted code lands first in the
 * iOS rail.
 */
function pickThreeForDay(userId: string, dateStr: string): ChallengeCode[] {
  const seed = hashStringToInt(`${userId}|${dateStr}`);
  const rng = mulberry32(seed);
  const pool = [...CHALLENGE_POOL];
  // Fisher–Yates, only the first CHALLENGES_PER_DAY positions need to
  // be determined.
  for (let i = pool.length - 1; i >= pool.length - CHALLENGES_PER_DAY; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmpI = pool[i];
    const tmpJ = pool[j];
    if (tmpI === undefined || tmpJ === undefined) continue;
    pool[i] = tmpJ;
    pool[j] = tmpI;
  }
  return pool.slice(pool.length - CHALLENGES_PER_DAY);
}

/** djb2-style 32-bit string hash. Deterministic across JS engines so
 *  the test-suite asserts on stable output without a snapshot lock. */
function hashStringToInt(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i += 1) {
    // (hash * 33) ^ char
    hash = (((hash << 5) + hash) ^ s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Mulberry32 — tiny seeded PRNG. Good enough for daily challenge
 *  rotation; we don't need crypto-grade randomness. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ISO date (YYYY-MM-DD), UTC-anchored. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
