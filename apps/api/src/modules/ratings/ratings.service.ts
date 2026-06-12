import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { applyRatingBatch, type PlayerSnapshot, type RatingRow } from "./elo.js";
import { applyReliabilityDelta, deltaForEvent } from "./reliability.js";
import { type SubmitRatingsRequest } from "./ratings.schema.js";
import { type AchievementsService } from "../achievements/achievements.service.js";
import {
  type SkillLevel,
  skillLevelFromElo,
} from "../../shared/skill/skillLevel.js";
import { FeedService } from "../feed/feed.service.js";
import { type FeedEmitter } from "../feed/feed.types.js";

export interface RatingsServiceDeps {
  db: DbHandle;
  /**
   * Optional — when present, every successful rating batch fires
   * `evaluateForUser` for every participant on a best-effort basis.
   * Achievement evaluation must NEVER fail a rating submission, so errors
   * here are logged-and-swallowed.
   */
  achievements?: AchievementsService;
  /**
   * Optional feed emitter — when present and a player's `skillLevelFromElo`
   * changes between pre- and post-rating ELO, an `elo_milestone` event
   * fires post-commit. Fire-and-forget; defaults to a FeedService built
   * from `db`.
   */
  feed?: FeedEmitter | undefined;
}

/**
 * Per-user pre/post ELO snapshot captured during `recomputeForGame` so the
 * caller can post-commit derive SkillLevel crossings without re-querying.
 * Returned from `recomputeForGame` rather than threaded through state so the
 * function stays mostly self-contained.
 */
interface EloTransition {
  user_id: string;
  sport_slug: string;
  pre_elo: number;
  post_elo: number;
}

export interface SubmissionResult {
  recorded: number;
  skipped_duplicates: number;
}

export interface SportStats {
  sport_id: string;
  sport_slug: string;
  elo_rating: number;
  /**
   * Word-based label derived from `elo_rating` at response-build time via
   * `skillLevelFromElo`. iOS renders this directly so the threshold table
   * (see `shared/skill/skillLevel.ts`) lives in exactly one place.
   */
  skill_level: SkillLevel;
  games_played: number;
  games_won: number;
  reliability_score: number;
}

export interface PublicProfile {
  id: string;
  display_name: string;
  photo_url: string | null;
  created_at: string;
  stats: SportStats[];
  /**
   * Word-based label for the user's strongest sport — derived from the
   * highest `elo_rating` across `stats`. `"beginner"` when the user has no
   * recorded stats yet (welcoming default for a brand-new player).
   */
  top_skill_level: SkillLevel;
  /**
   * Whether the viewer follows the target user. `false` for anonymous
   * callers AND when a user views their own profile (a follow edge with
   * yourself can never exist — see the `Cannot follow yourself` guard in
   * `FollowsService`).
   */
  is_following: boolean;
  /**
   * Whether the target user follows the viewer back. `false` for anonymous
   * callers AND when a user views their own profile. iOS surfaces this as
   * a "Follows you" pill on the profile header and switches the primary
   * CTA to "Follow back" when the viewer hasn't reciprocated.
   */
  follows_viewer: boolean;
  /**
   * ISO-8601 timestamp of the target user's last successful authentication.
   * Refreshed by the auth guard on a 60s-debounced cadence. NULL if we have
   * no presence signal yet. The iOS profile screen maps this to "Active now"
   * / "5m ago" / "Active yesterday" badges.
   */
  last_seen_at: string | null;
  followers_count?: number;
  following_count?: number;
}

export class RatingsService {
  private readonly feed: FeedEmitter;

  constructor(private readonly deps: RatingsServiceDeps) {
    this.feed = deps.feed ?? new FeedService({ db: deps.db });
  }

  /**
   * Submit a batch of co-player ratings for a single game.
   * Pre-conditions:
   *   - rater must be a confirmed participant of the game
   *   - each rated_user_id must be a participant
   *   - rater_user_id != rated_user_id (enforced by DB CHECK as well)
   *
   * Post-conditions:
   *   - Inserts ratings rows (idempotent via UNIQUE (game_id, rater, rated))
   *   - Marks the game completed if not already
   *   - Runs ELO + reliability recomputation for unprocessed ratings of the
   *     game in a single transaction
   */
  async submit(
    gameId: string,
    raterId: string,
    req: SubmitRatingsRequest,
  ): Promise<SubmissionResult> {
    const game = await this.deps.db.db
      .selectFrom("games")
      .selectAll()
      .where("id", "=", gameId)
      .executeTakeFirst();
    if (!game) throw new NotFoundError("Game not found");
    if (game.starts_at.getTime() > Date.now()) {
      throw new PreconditionFailedError("Cannot rate before game starts");
    }

    const participants = await this.deps.db.db
      .selectFrom("game_participants")
      .select(["user_id", "status"])
      .where("game_id", "=", gameId)
      .execute();
    const partMap = new Map(participants.map((p) => [p.user_id, p.status]));
    const raterStatus = partMap.get(raterId);
    if (raterStatus === undefined) {
      throw new ForbiddenError("Only participants can rate this game");
    }
    if (raterStatus === "cancelled") {
      throw new ForbiddenError("Cancelled participants cannot rate");
    }

    for (const r of req.ratings) {
      if (r.rated_user_id === raterId) {
        throw new ValidationError("Cannot rate yourself");
      }
      if (!partMap.has(r.rated_user_id)) {
        throw new ValidationError("Rated user was not a participant");
      }
    }

    // Captured inside the tx so the post-commit emit can iterate without
    // re-querying. Empty when no ratings were unprocessed (idempotent path).
    let transitions: EloTransition[] = [];

    const result = await withTransaction(this.deps.db.db, async (tx) => {
      let recorded = 0;
      let skipped = 0;
      for (const r of req.ratings) {
        const inserted = await tx
          .insertInto("ratings")
          .values({
            game_id: gameId,
            rater_user_id: raterId,
            rated_user_id: r.rated_user_id,
            sport_id: game.sport_id,
            outcome: r.outcome,
            behavior_ok: r.behavior_ok,
          })
          .onConflict((oc) => oc.columns(["game_id", "rater_user_id", "rated_user_id"]).doNothing())
          .returning("id")
          .executeTakeFirst();
        if (inserted) recorded += 1;
        else skipped += 1;
      }

      transitions = await this.recomputeForGame(tx, gameId, game.sport_id);

      // Move participants who actually showed (and weren't already marked
      // no_show by the host) from 'confirmed' → 'played'.
      await tx
        .updateTable("game_participants")
        .set({ status: "played", status_changed_at: new Date() })
        .where("game_id", "=", gameId)
        .where("status", "=", "confirmed")
        .execute();

      // Flip game to 'completed' (idempotent).
      if (game.status !== "completed") {
        await tx
          .updateTable("games")
          .set({ status: "completed" })
          .where("id", "=", gameId)
          .execute();
      }

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: raterId,
          action: "ratings.submit",
          entity: "game",
          entity_id: gameId,
          metadata: { recorded, skipped_duplicates: skipped },
        })
        .execute();

      return { recorded, skipped_duplicates: skipped };
    });

    // Fire-and-forget ELO milestone emits. We compare pre/post `SkillLevel`
    // rather than raw deltas so the feed surfaces a card only when the
    // user *crossed a threshold* the iOS UI labels (beginner / intermediate
    // / advanced / expert). The dedupe `sourceKey` is keyed on the
    // destination level so re-traversing the same boundary back-and-forth
    // (rare; possible after a bad-result streak) yields one card per
    // crossing direction per sport. Public visibility — milestones are
    // intentionally bragging-rights material, not follower-only.
    for (const t of transitions) {
      const preLevel = skillLevelFromElo(t.pre_elo);
      const postLevel = skillLevelFromElo(t.post_elo);
      if (preLevel === postLevel) continue;
      void this.feed
        .emit({
          actorUserId: t.user_id,
          type: "elo_milestone",
          payload: {
            sport_slug: t.sport_slug,
            elo_rating: t.post_elo,
            skill_level: postLevel,
            previous_skill_level: preLevel,
          },
          sourceKey: `elo_level:${t.user_id}:${t.sport_slug}:${postLevel}`,
          visibility: "public",
        })
        .catch(() => {
          /* swallow — feed emission must never break rating submit */
        });
    }

    // Post-commit: fire achievement evaluation for every participant we
    // have on record for this game. Best-effort — never fail the rating.
    if (this.deps.achievements) {
      try {
        const everyone = await this.deps.db.db
          .selectFrom("game_participants")
          .select("user_id")
          .where("game_id", "=", gameId)
          .execute();
        const svc = this.deps.achievements;
        await Promise.all(everyone.map((p) => svc.evaluateForUser(p.user_id)));
      } catch {
        // intentionally swallowed — achievement evaluation is non-critical
      }
    }

    return result;
  }

  /**
   * Idempotent: only processes ratings WHERE processed_at IS NULL, then sets
   * processed_at. Re-running yields zero changes.
   *
   * Behaviour:
   *   - For each unprocessed rating, the RATED user's ELO + games stats are
   *     updated against the RATER's current snapshot.
   *   - Players who played get +1 reliability (capped at 100).
   *   - Players marked no_show by host get -PENALTY_NO_SHOW reliability.
   *   - Players who cancelled late get -PENALTY_LATE_CANCEL reliability.
   */
  async recomputeForGame(
    tx: Parameters<Parameters<typeof withTransaction>[1]>[0],
    gameId: string,
    sportId: string,
  ): Promise<EloTransition[]> {
    const unprocessed = await tx
      .selectFrom("ratings")
      .select(["id", "rater_user_id", "rated_user_id", "outcome"])
      .where("game_id", "=", gameId)
      .where("processed_at", "is", null)
      .execute();

    if (unprocessed.length === 0) {
      return [];
    }

    const userIds = new Set<string>();
    for (const r of unprocessed) {
      userIds.add(r.rater_user_id);
      userIds.add(r.rated_user_id);
    }
    const userIdList = [...userIds];

    // Snapshot — UPSERT zero-row defaults so new players start at 1200/100.
    for (const uid of userIdList) {
      await tx
        .insertInto("player_sport_stats")
        .values({ user_id: uid, sport_id: sportId })
        .onConflict((oc) => oc.columns(["user_id", "sport_id"]).doNothing())
        .execute();
    }

    const statsRows = await tx
      .selectFrom("player_sport_stats")
      .selectAll()
      .where("sport_id", "=", sportId)
      .where("user_id", "in", userIdList)
      .execute();

    const snapshots = new Map<string, PlayerSnapshot>();
    for (const r of statsRows) {
      snapshots.set(r.user_id, {
        user_id: r.user_id,
        rating: r.elo_rating,
        games_played: r.games_played,
        games_won: r.games_won,
      });
    }

    const ratingRows: RatingRow[] = unprocessed.map((r) => ({
      rated_user_id: r.rated_user_id,
      rater_user_id: r.rater_user_id,
      outcome: r.outcome,
    }));
    const { updated } = applyRatingBatch(snapshots, ratingRows);

    // Reliability recompute, by participant status.
    const participants = await tx
      .selectFrom("game_participants")
      .select(["user_id", "status"])
      .where("game_id", "=", gameId)
      .execute();
    const reliabilityRows = await tx
      .selectFrom("player_sport_stats")
      .select(["user_id", "reliability_score"])
      .where("sport_id", "=", sportId)
      .where(
        "user_id",
        "in",
        participants.map((p) => p.user_id),
      )
      .execute();
    const reliabilityMap = new Map(reliabilityRows.map((r) => [r.user_id, r.reliability_score]));

    for (const p of participants) {
      const cur = reliabilityMap.get(p.user_id) ?? 100;
      let delta = 0;
      switch (p.status) {
        case "confirmed":
        case "played":
          delta = deltaForEvent({ type: "played" });
          break;
        case "no_show":
          delta = deltaForEvent({ type: "no_show" });
          break;
        case "cancelled":
          delta = deltaForEvent({ type: "late_cancel", hours_before_start: 0 });
          break;
      }
      reliabilityMap.set(p.user_id, applyReliabilityDelta(cur, delta));
    }

    // Persist ELO + games + reliability.
    for (const [uid, snap] of updated) {
      const reliability = reliabilityMap.get(uid);
      await tx
        .updateTable("player_sport_stats")
        .set({
          elo_rating: snap.rating,
          games_played: snap.games_played,
          games_won: snap.games_won,
          last_recalc_at: new Date(),
          ...(reliability !== undefined ? { reliability_score: reliability } : {}),
        })
        .where("user_id", "=", uid)
        .where("sport_id", "=", sportId)
        .execute();
    }

    // ─── ELO delta capture (FinalResultCard) ───────────────────
    // The iOS FinalResultCard renders a "+18" / "-12" chip from
    // `match_scores.elo_delta_by_user[<viewer_id>]`. Compute the per-user
    // delta (post - pre) for this batch and merge it onto the JSONB map on
    // the scoring row, if one exists for the game.
    //
    // We merge (`||` in jsonb) rather than overwrite so that, if ratings
    // arrive in multiple batches, each call accumulates the net change for
    // every participant. The pre-rating snapshot is captured in `statsRows`
    // (the SELECT before applyRatingBatch); subtracting from `updated`
    // yields this batch's contribution.
    const preRatingByUser = new Map<string, number>();
    for (const r of statsRows) {
      preRatingByUser.set(r.user_id, r.elo_rating);
    }
    const deltaPatch: Record<string, number> = {};
    for (const [uid, snap] of updated) {
      const pre = preRatingByUser.get(uid);
      if (pre === undefined) continue;
      const d = snap.rating - pre;
      if (d !== 0) deltaPatch[uid] = d;
    }
    if (Object.keys(deltaPatch).length > 0) {
      // Use jsonb concat (`||`) — preserves existing keys and overwrites
      // any that this batch touched. The map is small (≤8 entries) so the
      // payload cost is negligible. Sum into existing values so multiple
      // rating batches accumulate correctly.
      const merged = await sql<{ elo_delta_by_user: Record<string, number> | string }>`
        SELECT elo_delta_by_user FROM match_scores WHERE game_id = ${gameId}::uuid
      `.execute(tx);
      const existing = merged.rows[0]?.elo_delta_by_user;
      if (existing !== undefined) {
        const prior =
          typeof existing === "string"
            ? (JSON.parse(existing) as Record<string, number>)
            : existing;
        const next: Record<string, number> = { ...prior };
        for (const [uid, d] of Object.entries(deltaPatch)) {
          next[uid] = (next[uid] ?? 0) + d;
        }
        await sql`
          UPDATE match_scores
             SET elo_delta_by_user = ${JSON.stringify(next)}::jsonb
           WHERE game_id = ${gameId}::uuid
        `.execute(tx);
      }
    }

    // Mark this batch processed.
    await tx
      .updateTable("ratings")
      .set({ processed_at: new Date() })
      .where(
        "id",
        "in",
        unprocessed.map((r) => r.id),
      )
      .execute();

    // Build the per-user pre/post snapshot the caller uses to derive
    // SkillLevel crossings for the activity feed. We resolve the sport
    // slug once (one extra round-trip; the rest of the function is keyed
    // on `sport_id`) so the caller's emit payload carries the same
    // `sport_slug` string the rest of the feed uses.
    const sportRow = await tx
      .selectFrom("sports")
      .select(["slug"])
      .where("id", "=", sportId)
      .executeTakeFirst();
    const sportSlug = sportRow?.slug ?? "";

    const transitions: EloTransition[] = [];
    for (const [uid, snap] of updated) {
      const pre = preRatingByUser.get(uid);
      if (pre === undefined) continue;
      transitions.push({
        user_id: uid,
        sport_slug: sportSlug,
        pre_elo: pre,
        post_elo: snap.rating,
      });
    }
    return transitions;
  }

  async getPublicProfile(
    userId: string,
    viewerUserId: string | null = null,
  ): Promise<PublicProfile> {
    const user = await this.deps.db.db
      .selectFrom("users")
      .select(["id", "display_name", "photo_url", "created_at", "last_seen_at"])
      .where("id", "=", userId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!user) throw new NotFoundError("User not found");

    // SQL returns the raw stats columns; `skill_level` is derived per-row
    // at the application layer so the threshold table stays a single
    // constant in `shared/skill/skillLevel.ts`.
    const result = await sql<{
      sport_id: string;
      sport_slug: string;
      elo_rating: number;
      games_played: number;
      games_won: number;
      reliability_score: number;
    }>`
      SELECT pss.sport_id,
             s.slug    AS sport_slug,
             pss.elo_rating,
             pss.games_played,
             pss.games_won,
             pss.reliability_score
        FROM player_sport_stats pss
        JOIN sports s ON s.id = pss.sport_id
       WHERE pss.user_id = ${userId}
       ORDER BY pss.elo_rating DESC
    `.execute(this.deps.db.db);

    // Resolve both follow edges in a single round-trip. Skipped (both
    // false) for anonymous callers and for self-views — a self-follow is
    // impossible by construction (FollowsService rejects it with
    // ValidationError) so we don't even bother round-tripping to the DB
    // in that case. Two EXISTS subqueries against the (follower, followed)
    // PK index each return in <1ms, so combining them keeps the iOS
    // profile load snappy.
    let isFollowing = false;
    let followsViewer = false;
    if (viewerUserId !== null && viewerUserId !== userId) {
      const edges = await sql<{ is_following: boolean; follows_viewer: boolean }>`
        SELECT
          EXISTS(
            SELECT 1 FROM follows
             WHERE follower_user_id = ${viewerUserId}::uuid
               AND followed_user_id = ${userId}::uuid
          ) AS is_following,
          EXISTS(
            SELECT 1 FROM follows
             WHERE follower_user_id = ${userId}::uuid
               AND followed_user_id = ${viewerUserId}::uuid
          ) AS follows_viewer
      `.execute(this.deps.db.db);
      const row = edges.rows[0];
      if (row) {
        isFollowing = row.is_following;
        followsViewer = row.follows_viewer;
      }
    }

    // Enrich every per-sport row with its `skill_level`, and derive the
    // user's `top_skill_level` from the highest `elo_rating`. The SQL
    // ordering above is `ORDER BY pss.elo_rating DESC`, so the first row
    // (if any) is the top sport — but we don't rely on that here; we
    // compute the maximum explicitly so a future reorder doesn't silently
    // change the meaning of `top_skill_level`.
    const stats: SportStats[] = result.rows.map((r) => ({
      sport_id: r.sport_id,
      sport_slug: r.sport_slug,
      elo_rating: r.elo_rating,
      skill_level: skillLevelFromElo(r.elo_rating),
      games_played: r.games_played,
      games_won: r.games_won,
      reliability_score: r.reliability_score,
    }));
    // `null` -> "beginner" by `skillLevelFromElo` semantics, which is the
    // intended default for users with zero recorded stats.
    const topElo: number | null = stats.length === 0
      ? null
      : Math.max(...stats.map((s) => s.elo_rating));

    // Fetch followers and following count
    const followerCountRes = await this.deps.db.db
      .selectFrom("follows")
      .select((eb) => eb.fn.countAll().as("c"))
      .where("followed_user_id", "=", userId)
      .executeTakeFirst();
    const followersCount = Number(followerCountRes?.c ?? 0);

    const followingCountRes = await this.deps.db.db
      .selectFrom("follows")
      .select((eb) => eb.fn.countAll().as("c"))
      .where("follower_user_id", "=", userId)
      .executeTakeFirst();
    const followingCount = Number(followingCountRes?.c ?? 0);

    return {
      id: user.id,
      display_name: user.display_name,
      photo_url: user.photo_url,
      created_at: user.created_at.toISOString(),
      stats,
      top_skill_level: skillLevelFromElo(topElo),
      is_following: isFollowing,
      follows_viewer: followsViewer,
      last_seen_at: user.last_seen_at === null ? null : user.last_seen_at.toISOString(),
      followers_count: followersCount,
      following_count: followingCount,
    };
  }
}
