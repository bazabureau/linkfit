import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { NotFoundError } from "../../shared/errors/AppError.js";
import {
  type RecommendedGame,
  type RecommendedGamesResponse,
  type RecommendedPlayer,
  type RecommendedPlayerReasonCode,
  type RecommendedPlayersResponse,
} from "./matchmaking.schema.js";

export interface MatchmakingServiceDeps {
  db: DbHandle;
}

// Weights — sum to 1.0 so the final score lives cleanly in [0, 1]. Keep
// these as `const` so unit tests can lock against the exact contribution
// of each signal. If you tweak them, update the test scoring expectations.
const WEIGHTS = {
  elo: 0.4,
  distance: 0.25,
  time: 0.1,
  friends: 0.2,
  reliability: 0.05,
} as const;

// Anchors — the values at which a signal saturates to 0 or 1.
const ELO_SATURATION = 400; // |delta| >= 400 → 0
const DISTANCE_SATURATION_KM = 50; // > 50km → 0
const HIGH_RELIABILITY = 100; // 100 → 1, 0 → 0
const DEFAULT_ELO = 1200;
const DEFAULT_RELIABILITY = 100;
const MAX_CANDIDATES = 200; // hard cap on the candidate pool before scoring
const HOUR_MS = 60 * 60 * 1000;

/**
 * "Sənə uyğun oyunçular" presets — recommendPlayersForMe surface.
 *
 * Tighter than the generic "people to follow" carousel: we hard-filter
 * candidates to ±SKILL_BRACKET_ELO of the viewer's ELO and exclude
 * bidirectional blocks. The goal is to surface SHOULD-PLAY-EACH-OTHER
 * matches, not just "people you might know".
 */
const SKILL_BRACKET_ELO = 200; // candidates outside ±200 are dropped
const SAME_AREA_KM = 25; // distance < 25 km earns the "same_city" chip
const NEARBY_KM = 5; // < 5 km earns the "nearby" chip
const RECENT_GAME_DAYS = 14; // played a game in last 14d → "recently_active"
const RECENT_SEEN_DAYS = 7; // last_seen_at within 7d → "recently_active"

/**
 * Score how actionable a game start time is without pretending we know the
 * user's personal availability. The best window is soon enough to plan around
 * but not so soon that the user is likely to miss it. Far-future games remain
 * eligible but lose most of the timing boost.
 */
export function startTimeScore(startsAt: Date, now: Date = new Date()): number {
  const hoursUntilStart = (startsAt.getTime() - now.getTime()) / HOUR_MS;
  if (hoursUntilStart <= 0) return 0;
  if (hoursUntilStart < 2) return 0.5;
  if (hoursUntilStart <= 48) return 1;
  if (hoursUntilStart <= 168) {
    return Math.round((1 - ((hoursUntilStart - 48) / 120) * 0.7) * 100) / 100;
  }
  if (hoursUntilStart <= 336) {
    return Math.round((0.3 - ((hoursUntilStart - 168) / 168) * 0.2) * 100) / 100;
  }
  return 0.05;
}

interface CandidateGameRow {
  id: string;
  sport_id: string;
  sport_slug: string;
  host_user_id: string;
  host_display_name: string;
  host_reliability: number | null;
  court_id: string | null;
  venue_name: string | null;
  venue_photo_url: string | null;
  lat: string;
  lng: string;
  starts_at: Date;
  duration_minutes: number;
  capacity: number;
  participants_count: string;
  skill_min_elo: number | null;
  skill_max_elo: number | null;
  game_avg_elo: number | null;
  distance_m: string | null;
  friends_attending: string;
}

interface ViewerSnapshot {
  user_id: string;
  home_lat: number | null;
  home_lng: number | null;
  /** Map sport_id -> elo so we can pick the right ladder per candidate game. */
  elo_by_sport: Map<string, number>;
}

export class MatchmakingService {
  constructor(private readonly deps: MatchmakingServiceDeps) {}

  /**
   * Recommend up to `limit` open games for `userId`, ranked by a blended
   * score that mixes ELO closeness, distance, time-of-day, friends going,
   * and host reliability. Hard filters drop ineligible games BEFORE
   * scoring:
   *
   *  - Already a confirmed participant or the host.
   *  - Game is full or cancelled, or already started.
   *  - Skill window excludes the viewer's ELO for that sport.
   *
   * The scoring function is deterministic for a given input row — tests
   * lean on this to assert exact ordering.
   */
  async recommendGames(userId: string, limit: number): Promise<RecommendedGamesResponse> {
    const viewer = await this.loadViewer(userId);

    // Pull a generous candidate slice. The SQL applies the hard filters,
    // computes `game_avg_elo` from confirmed participants, and tags each
    // row with `friends_attending` (count of viewer-followed users in
    // the game).
    const hasGeo = viewer.home_lat !== null && viewer.home_lng !== null;
    const rows = await sql<CandidateGameRow>`
      WITH viewer AS (
        SELECT ${userId}::uuid AS user_id
      )
      SELECT
        g.id,
        g.sport_id,
        s.slug AS sport_slug,
        g.host_user_id,
        u.display_name AS host_display_name,
        host_stats.reliability_score AS host_reliability,
        g.court_id,
        v.name AS venue_name,
        v.photo_url AS venue_photo_url,
        g.lat,
        g.lng,
        g.starts_at,
        g.duration_minutes,
        g.capacity,
        (SELECT count(*)::text FROM game_participants gp
           WHERE gp.game_id = g.id AND gp.status = 'confirmed') AS participants_count,
        g.skill_min_elo,
        g.skill_max_elo,
        (
          SELECT avg(pss.elo_rating)::int
            FROM game_participants gp
            JOIN player_sport_stats pss
              ON pss.user_id = gp.user_id AND pss.sport_id = g.sport_id
           WHERE gp.game_id = g.id AND gp.status = 'confirmed'
        ) AS game_avg_elo,
        ${
          hasGeo
            ? sql`earth_distance(
                    ll_to_earth(${viewer.home_lat ?? 0}::float8, ${viewer.home_lng ?? 0}::float8),
                    ll_to_earth(g.lat::float8, g.lng::float8)
                  )::text`
            : sql`NULL::text`
        } AS distance_m,
        (
          SELECT count(*)::text
            FROM follows f
            JOIN game_participants gp ON gp.user_id = f.followed_user_id
           WHERE f.follower_user_id = (SELECT user_id FROM viewer)
             AND gp.game_id = g.id
             AND gp.status = 'confirmed'
        ) AS friends_attending
        FROM games g
        JOIN sports s ON s.id = g.sport_id
        JOIN users  u ON u.id = g.host_user_id
        LEFT JOIN courts c ON c.id = g.court_id
        LEFT JOIN venues v ON v.id = c.venue_id
        LEFT JOIN player_sport_stats host_stats
               ON host_stats.user_id = g.host_user_id
              AND host_stats.sport_id = g.sport_id
       WHERE g.status = 'open'
         AND g.visibility = 'public'
         AND u.deleted_at IS NULL
         AND g.starts_at > now()
         AND g.host_user_id <> (SELECT user_id FROM viewer)
         AND NOT EXISTS (
           SELECT 1 FROM game_participants gp
            WHERE gp.game_id = g.id
              AND gp.user_id = (SELECT user_id FROM viewer)
              AND gp.status = 'confirmed'
         )
       ORDER BY g.starts_at ASC
       LIMIT ${MAX_CANDIDATES}
    `.execute(this.deps.db.db);

    const scored = rows.rows
      .map((row) => this.scoreGame(row, viewer))
      .filter((g): g is RecommendedGame => g !== null);

    // Deterministic ordering — score desc, then earlier starts_at first,
    // then id asc so ties never flap between requests.
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.starts_at !== b.starts_at) return a.starts_at.localeCompare(b.starts_at);
      return a.id.localeCompare(b.id);
    });

    return { items: scored.slice(0, limit) };
  }

  /**
   * Recommend up to `limit` players to follow. Pulls from users the viewer
   * does NOT already follow (and that haven't been deleted) and ranks by:
   *
   *  - ELO closeness on the viewer's primary sport.
   *  - Distance (when both viewer + candidate have a `home_lat/lng`).
   *  - Mutual followers count (acts as the "friends bonus" analog).
   *  - Reliability of the candidate.
   *
   * Players without any `player_sport_stats` row are still surfaced — we
   * fall back to default ELO / reliability so onboarding-fresh accounts
   * appear in the carousel without penalty.
   */
  async recommendPlayers(userId: string, limit: number): Promise<RecommendedPlayersResponse> {
    const viewer = await this.loadViewer(userId);
    const hasGeo = viewer.home_lat !== null && viewer.home_lng !== null;

    // Pick the viewer's primary sport — the one with the most games. Ties
    // resolve to the alphabetically-first slug so the choice is stable.
    const primary = await this.deps.db.db
      .selectFrom("player_sport_stats as pss")
      .innerJoin("sports as s", "s.id", "pss.sport_id")
      .select(["s.id as sport_id", "s.slug as sport_slug", "pss.elo_rating", "pss.games_played"])
      .where("pss.user_id", "=", userId)
      .orderBy("pss.games_played", "desc")
      .orderBy("s.slug", "asc")
      .executeTakeFirst();
    const primarySportId = primary?.sport_id ?? null;
    const viewerElo = primary?.elo_rating ?? DEFAULT_ELO;

    interface CandidatePlayerRow {
      user_id: string;
      display_name: string;
      photo_url: string | null;
      home_lat: string | null;
      home_lng: string | null;
      primary_sport_slug: string | null;
      elo_rating: number | null;
      reliability_score: number | null;
      distance_m: string | null;
      mutual_followers: string;
      last_seen_at: Date | null;
      recent_game_count: string;
    }

    const candidates = await sql<CandidatePlayerRow>`
      WITH viewer AS ( SELECT ${userId}::uuid AS user_id ),
      primary_stats AS (
        SELECT user_id,
               (SELECT slug FROM sports WHERE id = pss.sport_id) AS sport_slug,
               sport_id,
               elo_rating,
               reliability_score,
               row_number() OVER (PARTITION BY user_id ORDER BY games_played DESC, sport_id ASC) AS rn
          FROM player_sport_stats pss
      )
      SELECT
        u.id AS user_id,
        u.display_name,
        u.photo_url,
        u.home_lat,
        u.home_lng,
        u.last_seen_at,
        COALESCE(
          (SELECT sport_slug FROM primary_stats ps WHERE ps.user_id = u.id AND ps.rn = 1),
          NULL
        ) AS primary_sport_slug,
        ${
          primarySportId !== null
            ? sql`(SELECT elo_rating FROM player_sport_stats
                    WHERE user_id = u.id AND sport_id = ${primarySportId})`
            : sql`(SELECT elo_rating FROM primary_stats ps WHERE ps.user_id = u.id AND ps.rn = 1)`
        } AS elo_rating,
        (SELECT reliability_score FROM primary_stats ps WHERE ps.user_id = u.id AND ps.rn = 1)
          AS reliability_score,
        ${
          hasGeo
            ? sql`CASE
                    WHEN u.home_lat IS NULL OR u.home_lng IS NULL THEN NULL
                    ELSE earth_distance(
                      ll_to_earth(${viewer.home_lat ?? 0}::float8, ${viewer.home_lng ?? 0}::float8),
                      ll_to_earth(u.home_lat::float8, u.home_lng::float8)
                    )
                  END::text`
            : sql`NULL::text`
        } AS distance_m,
        (
          SELECT count(*)::text
            FROM follows f1
            JOIN follows f2 ON f2.followed_user_id = f1.followed_user_id
           WHERE f1.follower_user_id = (SELECT user_id FROM viewer)
             AND f2.follower_user_id = u.id
        ) AS mutual_followers,
        (
          -- "Played a confirmed game in the last 14 days" — drives the
          -- "recently_active" reason chip. Limited to confirmed/completed
          -- participations so a no-show or pending invite doesn't count.
          SELECT count(*)::text
            FROM game_participants gp
            JOIN games g ON g.id = gp.game_id
           WHERE gp.user_id = u.id
             AND gp.status = 'confirmed'
             AND g.starts_at > now() - interval '${sql.raw(String(RECENT_GAME_DAYS))} days'
        ) AS recent_game_count
        FROM users u
       WHERE u.deleted_at IS NULL
         AND u.id <> (SELECT user_id FROM viewer)
         AND NOT EXISTS (
           SELECT 1 FROM follows f
            WHERE f.follower_user_id = (SELECT user_id FROM viewer)
              AND f.followed_user_id = u.id
         )
         -- Bidirectional block guard. We don't surface anyone the viewer
         -- has blocked OR who has blocked the viewer — either direction
         -- means "do not meet". Composite indexes on user_blocks make
         -- this a pair of fast lookups.
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
            WHERE b.blocker_user_id = (SELECT user_id FROM viewer)
              AND b.blocked_user_id = u.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
            WHERE b.blocker_user_id = u.id
              AND b.blocked_user_id = (SELECT user_id FROM viewer)
         )
       ORDER BY u.created_at DESC
       LIMIT ${MAX_CANDIDATES}
    `.execute(this.deps.db.db);

    const scored = candidates.rows.map((row) =>
      this.scorePlayer(row, viewerElo, hasGeo),
    );

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.user_id.localeCompare(b.user_id);
    });

    return { items: scored.slice(0, limit) };
  }

  /**
   * "Sənə uyğun oyunçular" — the strict matchmaker.
   *
   * Same candidate shape as `recommendPlayers` but applies the spec's
   * hard filters: ELO must be within ±SKILL_BRACKET_ELO of the viewer
   * AND the viewer must NOT already follow the candidate AND no
   * bidirectional block. Ordered by composite score with reasons baked
   * into `reason_codes` so the iOS card renders coloured chips.
   *
   * If the viewer has no ELO row yet (brand-new sign-up), we fall back
   * to the generic `recommendPlayers` so the surface never shows an
   * empty card.
   */
  async recommendPlayersForMe(
    userId: string,
    limit: number,
  ): Promise<RecommendedPlayersResponse> {
    const viewer = await this.loadViewer(userId);
    const hasGeo = viewer.home_lat !== null && viewer.home_lng !== null;

    const primary = await this.deps.db.db
      .selectFrom("player_sport_stats as pss")
      .innerJoin("sports as s", "s.id", "pss.sport_id")
      .select(["s.id as sport_id", "s.slug as sport_slug", "pss.elo_rating"])
      .where("pss.user_id", "=", userId)
      .orderBy("pss.games_played", "desc")
      .orderBy("s.slug", "asc")
      .executeTakeFirst();

    // No primary ELO yet — fall back to the lenient surface so a freshly
    // onboarded user still sees suggestions.
    if (!primary) return this.recommendPlayers(userId, limit);

    const viewerElo = primary.elo_rating;
    const primarySportId = primary.sport_id;
    const eloFloor = viewerElo - SKILL_BRACKET_ELO;
    const eloCeil = viewerElo + SKILL_BRACKET_ELO;

    interface CandidatePlayerRow {
      user_id: string;
      display_name: string;
      photo_url: string | null;
      home_lat: string | null;
      home_lng: string | null;
      primary_sport_slug: string | null;
      elo_rating: number | null;
      reliability_score: number | null;
      distance_m: string | null;
      mutual_followers: string;
      last_seen_at: Date | null;
      recent_game_count: string;
    }

    const candidates = await sql<CandidatePlayerRow>`
      WITH viewer AS ( SELECT ${userId}::uuid AS user_id )
      SELECT
        u.id AS user_id,
        u.display_name,
        u.photo_url,
        u.home_lat,
        u.home_lng,
        u.last_seen_at,
        ${primary.sport_slug} AS primary_sport_slug,
        pss.elo_rating AS elo_rating,
        pss.reliability_score AS reliability_score,
        ${
          hasGeo
            ? sql`CASE
                    WHEN u.home_lat IS NULL OR u.home_lng IS NULL THEN NULL
                    ELSE earth_distance(
                      ll_to_earth(${viewer.home_lat ?? 0}::float8, ${viewer.home_lng ?? 0}::float8),
                      ll_to_earth(u.home_lat::float8, u.home_lng::float8)
                    )
                  END::text`
            : sql`NULL::text`
        } AS distance_m,
        (
          SELECT count(*)::text
            FROM follows f1
            JOIN follows f2 ON f2.followed_user_id = f1.followed_user_id
           WHERE f1.follower_user_id = (SELECT user_id FROM viewer)
             AND f2.follower_user_id = u.id
        ) AS mutual_followers,
        (
          SELECT count(*)::text
            FROM game_participants gp
            JOIN games g ON g.id = gp.game_id
           WHERE gp.user_id = u.id
             AND gp.status = 'confirmed'
             AND g.starts_at > now() - interval '${sql.raw(String(RECENT_GAME_DAYS))} days'
        ) AS recent_game_count
        FROM users u
        INNER JOIN player_sport_stats pss
                ON pss.user_id = u.id AND pss.sport_id = ${primarySportId}::uuid
       WHERE u.deleted_at IS NULL
         AND u.id <> (SELECT user_id FROM viewer)
         -- Skill bracket: ±SKILL_BRACKET_ELO is the hard window for the
         -- "should-play-each-other" carousel.
         AND pss.elo_rating BETWEEN ${eloFloor} AND ${eloCeil}
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
            WHERE b.blocker_user_id = (SELECT user_id FROM viewer)
              AND b.blocked_user_id = u.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
            WHERE b.blocker_user_id = u.id
              AND b.blocked_user_id = (SELECT user_id FROM viewer)
         )
       ORDER BY u.created_at DESC
       LIMIT ${MAX_CANDIDATES}
    `.execute(this.deps.db.db);

    const scored = candidates.rows.map((row) =>
      this.scorePlayer(row, viewerElo, hasGeo),
    );

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.user_id.localeCompare(b.user_id);
    });

    return { items: scored.slice(0, limit) };
  }

  // --- internals ---------------------------------------------------------

  private async loadViewer(userId: string): Promise<ViewerSnapshot> {
    const me = await this.deps.db.db
      .selectFrom("users")
      .select(["id", "home_lat", "home_lng"])
      .where("id", "=", userId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!me) throw new NotFoundError("User not found");

    const stats = await this.deps.db.db
      .selectFrom("player_sport_stats")
      .select(["sport_id", "elo_rating"])
      .where("user_id", "=", userId)
      .execute();

    const elo_by_sport = new Map<string, number>();
    for (const s of stats) elo_by_sport.set(s.sport_id, s.elo_rating);

    return {
      user_id: userId,
      home_lat: me.home_lat === null ? null : Number(me.home_lat),
      home_lng: me.home_lng === null ? null : Number(me.home_lng),
      elo_by_sport,
    };
  }

  /**
   * Score one candidate game. Returns `null` when the game fails a hard
   * filter (skill window). The score is the weighted sum of five
   * sub-signals, each normalized to [0, 1].
   */
  private scoreGame(row: CandidateGameRow, viewer: ViewerSnapshot): RecommendedGame | null {
    const viewerElo = viewer.elo_by_sport.get(row.sport_id) ?? DEFAULT_ELO;

    // Hard filter: skill window. If the game declares a min/max ELO and
    // the viewer is outside it, drop the game entirely.
    if (row.skill_min_elo !== null && viewerElo < row.skill_min_elo) return null;
    if (row.skill_max_elo !== null && viewerElo > row.skill_max_elo) return null;

    const friends = Number(row.friends_attending);
    const distanceM = row.distance_m === null ? null : Number(row.distance_m);
    const distanceKm = distanceM === null ? null : distanceM / 1000;
    const avgElo = row.game_avg_elo ?? viewerElo;
    const hostReliability = row.host_reliability ?? DEFAULT_RELIABILITY;

    // --- sub-scores (each 0..1) ---
    const eloDelta = Math.abs(avgElo - viewerElo);
    const eloScore = Math.max(0, 1 - eloDelta / ELO_SATURATION);

    // Distance score is 0 when we lack a viewer home — the absent signal
    // shouldn't penalize the row, so we redistribute its weight by simply
    // collapsing the contribution to 0 and *not* normalizing. This means a
    // user with no home_lat/lng still gets meaningful rankings driven by
    // ELO/friends/reliability.
    const distanceScore =
      distanceKm === null
        ? 0
        : Math.max(0, 1 - distanceKm / DISTANCE_SATURATION_KM);

    const timeScore = startTimeScore(row.starts_at);

    // Friends bonus saturates at 2 friends — beyond that the curve flat-
    // lines so a stacked game doesn't dominate ranking.
    const friendsScore = Math.min(1, friends / 2);

    const reliabilityScore = Math.max(0, Math.min(1, hostReliability / HIGH_RELIABILITY));

    const raw =
      WEIGHTS.elo * eloScore +
      WEIGHTS.distance * distanceScore +
      WEIGHTS.time * timeScore +
      WEIGHTS.friends * friendsScore +
      WEIGHTS.reliability * reliabilityScore;

    // Two-decimal precision is plenty for ordering; trims float noise.
    const score = Math.round(raw * 100) / 100;

    const reasons = this.buildGameReasons({
      eloDelta,
      friends,
      distanceKm,
      hostReliability,
    });

    return {
      id: row.id,
      sport_id: row.sport_id,
      sport_slug: row.sport_slug,
      host_user_id: row.host_user_id,
      host_display_name: row.host_display_name,
      venue_name: row.venue_name,
      venue_photo_url: row.venue_photo_url ?? null,
      lat: Number(row.lat),
      lng: Number(row.lng),
      starts_at: row.starts_at.toISOString(),
      duration_minutes: row.duration_minutes,
      capacity: row.capacity,
      participants_count: Number(row.participants_count),
      skill_min_elo: row.skill_min_elo,
      skill_max_elo: row.skill_max_elo,
      distance_km: distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
      score,
      reasons,
    };
  }

  private buildGameReasons(args: {
    eloDelta: number;
    friends: number;
    distanceKm: number | null;
    hostReliability: number;
  }): string[] {
    const reasons: string[] = [];
    if (args.eloDelta <= 100) reasons.push("Similar ELO");
    else if (args.eloDelta <= 200) reasons.push("Close ELO");

    if (args.friends === 1) reasons.push("1 friend going");
    else if (args.friends >= 2) reasons.push(`${String(args.friends)} friends going`);

    if (args.distanceKm !== null) {
      if (args.distanceKm < 1) reasons.push("Nearby");
      else reasons.push(`${String(Math.round(args.distanceKm))} km away`);
    }

    if (args.hostReliability >= 90) reasons.push("Reliable host");

    // Always surface at least one chip so the card never looks blank.
    if (reasons.length === 0) reasons.push("Open spot");
    return reasons;
  }

  private scorePlayer(
    row: {
      user_id: string;
      display_name: string;
      photo_url: string | null;
      home_lat: string | null;
      home_lng: string | null;
      primary_sport_slug: string | null;
      elo_rating: number | null;
      reliability_score: number | null;
      distance_m: string | null;
      mutual_followers: string;
      last_seen_at?: Date | null;
      recent_game_count?: string;
    },
    viewerElo: number,
    hasGeo: boolean,
  ): RecommendedPlayer {
    const candidateElo = row.elo_rating ?? DEFAULT_ELO;
    const mutual = Number(row.mutual_followers);
    const distanceM = row.distance_m === null ? null : Number(row.distance_m);
    const distanceKm = distanceM === null ? null : distanceM / 1000;
    const reliability = row.reliability_score ?? DEFAULT_RELIABILITY;
    const recentGames = row.recent_game_count !== undefined ? Number(row.recent_game_count) : 0;
    const lastSeenAt = row.last_seen_at ?? null;
    const now = Date.now();
    const seenRecently =
      lastSeenAt !== null &&
      now - new Date(lastSeenAt).getTime() < RECENT_SEEN_DAYS * 24 * 60 * 60 * 1000;
    const isActiveRecently = recentGames > 0 || seenRecently;

    const eloDelta = Math.abs(candidateElo - viewerElo);
    const eloScore = Math.max(0, 1 - eloDelta / ELO_SATURATION);
    const distanceScore =
      !hasGeo || distanceKm === null
        ? 0
        : Math.max(0, 1 - distanceKm / DISTANCE_SATURATION_KM);
    const friendsScore = Math.min(1, mutual / 2);
    const reliabilityScore = Math.max(0, Math.min(1, reliability / HIGH_RELIABILITY));

    // Players have no "time-of-day" axis — collapse that weight into ELO
    // so the sub-weights still sum to 1.
    const raw =
      (WEIGHTS.elo + WEIGHTS.time) * eloScore +
      WEIGHTS.distance * distanceScore +
      WEIGHTS.friends * friendsScore +
      WEIGHTS.reliability * reliabilityScore;
    const score = Math.round(raw * 100) / 100;

    // EN reasons[] — preserved for back-compat with existing iOS clients
    // and the pinned integration tests in matchmaking.test.ts.
    const reasons: string[] = [];
    if (eloDelta <= 100) reasons.push("Similar ELO");
    else if (eloDelta <= 200) reasons.push("Close ELO");

    if (mutual === 1) reasons.push("1 mutual follower");
    else if (mutual >= 2) reasons.push(`${String(mutual)} mutual followers`);

    if (distanceKm !== null) {
      if (distanceKm < 1) reasons.push("Nearby");
      else reasons.push(`${String(Math.round(distanceKm))} km away`);
    }

    if (reliability >= 90) reasons.push("Reliable player");
    if (reasons.length === 0) reasons.push("New player");

    // reason_codes — locale-agnostic tokens the iOS card translates into
    // AZ chips ("Eyni səviyyə", "Bakıda", "Bu həftə aktiv", …). Order
    // matters: the card displays only the first 3, so the most
    // discriminating signals lead.
    const reasonCodes: RecommendedPlayerReasonCode[] = [];
    if (eloDelta <= SKILL_BRACKET_ELO) reasonCodes.push("same_skill");
    if (distanceKm !== null && distanceKm < NEARBY_KM) reasonCodes.push("nearby");
    else if (distanceKm !== null && distanceKm < SAME_AREA_KM) reasonCodes.push("same_city");
    if (isActiveRecently) reasonCodes.push("recently_active");
    if (mutual >= 1) reasonCodes.push("plays_with_your_friends");
    if (reliability >= 90) reasonCodes.push("reliable");
    if (reasonCodes.length === 0) reasonCodes.push("new_player");

    return {
      user_id: row.user_id,
      display_name: row.display_name,
      photo_url: row.photo_url,
      primary_sport_slug: row.primary_sport_slug,
      elo_rating: row.elo_rating,
      reliability_score: row.reliability_score,
      distance_km: distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
      mutual_followers_count: mutual,
      score,
      reasons,
      reason_codes: reasonCodes,
    };
  }
}
