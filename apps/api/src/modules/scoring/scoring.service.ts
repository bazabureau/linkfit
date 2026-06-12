// === Scoring agent — service ===
//
// Owns the lifecycle of a `match_scores` row: start → point/undo loop →
// complete. The rules engine in `./scoring.rules.ts` is pure; this file
// holds the DB transactions, permission checks, and the auto-flip of the
// underlying `games` row to `completed` on finalize.

import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction, type Executor } from "../../shared/db/withTransaction.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { type MatchScoreSetJson } from "../../shared/db/types.js";
import { applyPoint, initialScoreState, replayPoints, type ScoreState } from "./scoring.rules.js";
import { type MatchScoreView, type StartScoringRequest } from "./scoring.schema.js";
import { FeedService } from "../feed/feed.service.js";
import { type FeedEmitter } from "../feed/feed.types.js";
// Product analytics (PostHog). Fire-and-forget — `track(...)` is a no-op
// when `POSTHOG_API_KEY` is unset; see `shared/observability/analytics.ts`.
import { track as analyticsTrack } from "../../shared/observability/analytics.js";

export interface ScoringServiceDeps {
  db: DbHandle;
  /**
   * Optional feed emitter — when present, `complete()` fires a `won_match`
   * activity event for each winner. Fire-and-forget; failures never break
   * match finalize. Defaults to a FeedService built from `db`.
   */
  feed?: FeedEmitter | undefined;
}

interface ScoreRow {
  game_id: string;
  team_a_user_ids: string[];
  team_b_user_ids: string[];
  sets: MatchScoreSetJson[];
  points: ("a" | "b")[];
  current_set: number;
  current_game_a: number;
  current_game_b: number;
  point_a: number;
  point_b: number;
  status: "in_progress" | "completed";
  started_at: Date;
  completed_at: Date | null;
  // Populated by the ratings recompute flow; empty `{}` until then.
  elo_delta_by_user: Record<string, number>;
}

/** Derive the `winning_team` view field from the canonical sets array. */
function winningTeam(sets: MatchScoreSetJson[], status: "in_progress" | "completed"): "a" | "b" | null {
  if (status !== "completed") return null;
  let a = 0;
  let b = 0;
  for (const s of sets) {
    if (s.a > s.b) a += 1;
    else if (s.b > s.a) b += 1;
  }
  if (a > b) return "a";
  if (b > a) return "b";
  return null;
}

function rowToView(r: ScoreRow): MatchScoreView {
  return {
    game_id: r.game_id,
    team_a_user_ids: r.team_a_user_ids,
    team_b_user_ids: r.team_b_user_ids,
    sets: r.sets,
    current_set: r.current_set,
    current_game_a: r.current_game_a,
    current_game_b: r.current_game_b,
    point_a: r.point_a,
    point_b: r.point_b,
    status: r.status,
    started_at: r.started_at.toISOString(),
    completed_at: r.completed_at === null ? null : r.completed_at.toISOString(),
    winning_team: winningTeam(r.sets, r.status),
    elo_delta_by_user: r.elo_delta_by_user,
  };
}

export class ScoringService {
  private readonly feed: FeedEmitter;

  constructor(private readonly deps: ScoringServiceDeps) {
    this.feed = deps.feed ?? new FeedService({ db: deps.db });
  }

  /**
   * Host-only. Creates the row. Both teams must be made up of currently
   * confirmed participants; otherwise we'd be tracking points for ghosts.
   */
  async start(gameId: string, hostUserId: string, req: StartScoringRequest): Promise<MatchScoreView> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const game = await tx
        .selectFrom("games")
        .select(["id", "host_user_id", "status"])
        .where("id", "=", gameId)
        .executeTakeFirst();
      if (!game) throw new NotFoundError("Game not found");
      if (game.host_user_id !== hostUserId) {
        throw new ForbiddenError("Only the host can start scoring");
      }
      if (game.status === "cancelled" || game.status === "completed") {
        throw new PreconditionFailedError(
          `Cannot start scoring for a ${game.status} game`,
        );
      }

      // Both teams must be currently confirmed participants.
      const allUserIds = [...req.team_a_user_ids, ...req.team_b_user_ids];
      const confirmed = await tx
        .selectFrom("game_participants")
        .select(["user_id"])
        .where("game_id", "=", gameId)
        .where("status", "=", "confirmed")
        .where("user_id", "in", allUserIds)
        .execute();
      const confirmedIds = new Set(confirmed.map((r) => r.user_id));
      const missing = allUserIds.filter((id) => !confirmedIds.has(id));
      if (missing.length > 0) {
        throw new ValidationError(
          "All team members must be confirmed participants in the game",
          { details: { missing } },
        );
      }

      // Disallow restarting a finalized match — surface a 409 so the
      // client can route the user to the read-only spectator view.
      const existing = await tx
        .selectFrom("match_scores")
        .select(["status"])
        .where("game_id", "=", gameId)
        .executeTakeFirst();
      if (existing) {
        throw new ConflictError("Scoring has already been started for this game");
      }

      await sql`
        INSERT INTO match_scores
          (game_id, team_a_user_ids, team_b_user_ids, sets, points)
        VALUES (
          ${gameId}::uuid,
          ${req.team_a_user_ids}::uuid[],
          ${req.team_b_user_ids}::uuid[],
          '[]'::jsonb,
          '[]'::jsonb
        )
      `.execute(tx);

      const row = await this.fetchRow(tx, gameId);
      return rowToView(row);
    });
  }

  /** Apply a single point. Confirmed participants of the game can score. */
  async point(gameId: string, userId: string, team: "a" | "b"): Promise<MatchScoreView> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const row = await this.lockedRow(tx, gameId);
      await this.assertCanWrite(tx, gameId, userId);
      if (row.status === "completed") {
        throw new PreconditionFailedError("Match is already complete");
      }

      const state: ScoreState = {
        sets: row.sets,
        current_set: row.current_set,
        current_game_a: row.current_game_a,
        current_game_b: row.current_game_b,
        point_a: row.point_a,
        point_b: row.point_b,
        status: row.status,
        winning_team: null,
      };
      applyPoint(state, team);
      const nextPoints = [...row.points, team];
      // Defensive cap — a real game won't exceed ~250 points; we cut at 1000
      // to keep the jsonb payload reasonable if a client misbehaves.
      if (nextPoints.length > 1000) {
        throw new PreconditionFailedError("Too many points recorded");
      }

      await this.persist(tx, gameId, state, nextPoints);
      const fresh = await this.fetchRow(tx, gameId);
      return rowToView(fresh);
    });
  }

  /** Drop the last point and replay. No-op if no points are recorded. */
  async undo(gameId: string, userId: string): Promise<MatchScoreView> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const row = await this.lockedRow(tx, gameId);
      await this.assertCanWrite(tx, gameId, userId);
      if (row.points.length === 0) {
        return rowToView(row);
      }
      const trimmed = row.points.slice(0, -1);
      const replayed = replayPoints(trimmed);
      await this.persist(tx, gameId, replayed, trimmed);
      const fresh = await this.fetchRow(tx, gameId);
      return rowToView(fresh);
    });
  }

  /**
   * Finalize. Sets `status = 'completed'`, stamps `completed_at`, and flips
   * the underlying `games.status` to `completed` so the ratings flow picks
   * the match up. Idempotent: calling on an already-finalized match returns
   * the same row.
   */
  async complete(gameId: string, userId: string): Promise<MatchScoreView> {
    // Track winners derived inside the tx so we can emit feed events after
    // commit. Empty when the match finishes drawn or was already complete
    // on entry (idempotent path) — both cases skip emission.
    let winnersToEmit: string[] = [];
    // Captured inside the tx, consumed after commit by the analytics
    // emission. Wrapped in an object literal so the eslint type-aware
    // rules (no-inferrable-types + no-unnecessary-condition) don't fight
    // each other over a narrowed `let` boolean — TS doesn't propagate
    // closure reassignment through a plain `let`, but a property write
    // on a captured object widens the value as expected.
    const flags = { transitioned: false };

    const view = await withTransaction(this.deps.db.db, async (tx) => {
      const row = await this.lockedRow(tx, gameId);
      await this.assertCanWrite(tx, gameId, userId);

      // Idempotent — already-complete just returns.
      if (row.status === "completed") {
        return rowToView(row);
      }
      flags.transitioned = true;

      // Allow early finalize: any partially-played state is recorded as-is.
      const completedAt = new Date();
      await tx
        .updateTable("match_scores")
        .set({
          status: "completed",
          completed_at: completedAt,
        })
        .where("game_id", "=", gameId)
        .execute();
      await tx
        .updateTable("games")
        .set({ status: "completed" })
        .where("id", "=", gameId)
        .execute();

      // ─── Stats bump on finalize (FAZA 56) ────────────────────────
      // ELO + reliability deltas remain owned by the ratings service
      // (those depend on co-player feedback). But `games_played` is
      // an objective fact at the moment of finalize — and surfacing
      // a 0 on the profile until everyone bothers to rate gave users
      // the impression their stats were broken. Bump games_played
      // for every confirmed participant, and games_won for the
      // winning team. The increments are idempotent at the SQL
      // level — a duplicate finalize call short-circuits at the
      // status check above before reaching this block.
      const game = await tx
        .selectFrom("games")
        .select(["sport_id"])
        .where("id", "=", gameId)
        .executeTakeFirst();
      if (game) {
        const winner = winningTeam(row.sets, "completed");
        const winnerUserIds: string[] = winner === "a"
          ? row.team_a_user_ids
          : winner === "b"
            ? row.team_b_user_ids
            : [];
        const participantUserIds: string[] = [
          ...row.team_a_user_ids,
          ...row.team_b_user_ids,
        ];

        for (const uid of participantUserIds) {
          // INSERT … ON CONFLICT DO UPDATE so users without a
          // sport_stats row yet still get one created.
          await sql`
            INSERT INTO player_sport_stats (user_id, sport_id, elo_rating, games_played, games_won, reliability_score)
            VALUES (${uid}, ${game.sport_id}, 1200, 1, ${winnerUserIds.includes(uid) ? 1 : 0}, 100)
            ON CONFLICT (user_id, sport_id)
            DO UPDATE SET
              games_played = player_sport_stats.games_played + 1,
              games_won = player_sport_stats.games_won + ${winnerUserIds.includes(uid) ? 1 : 0}
          `.execute(tx);
        }

        winnersToEmit = winnerUserIds;
      }

      const fresh = await this.fetchRow(tx, gameId);
      return rowToView(fresh);
    });

    // Fire-and-forget `won_match` feed emission per winner — after commit,
    // never blocks the request. The polling fallback in `feed.worker.ts`
    // keys on `rating:<id>`; we key on `won_match:<game>:<uid>` so the two
    // sources don't collide (a user can have both a synchronous "won the
    // match" card and the worker's per-rating cards without dedupe drops).
    for (const winnerId of winnersToEmit) {
      void this.feed
        .emit({
          actorUserId: winnerId,
          type: "won_match",
          payload: { game_id: gameId },
          sourceKey: `won_match:${gameId}:${winnerId}`,
        })
        .catch(() => {
          /* swallow — feed emission must never break match finalize */
        });
    }

    // Product analytics — `match_scored_finalized`. Only emit on the
    // transition path so an idempotent `complete()` call (e.g. retry
    // after a flaky network) does not double-count the funnel.
    // `duration_min` is computed from the started_at / completed_at
    // pair on the row; floor to keep the property an Int the dashboard
    // can bucket without histogram surprises.
    if (flags.transitioned && view.completed_at !== null) {
      const startedMs = Date.parse(view.started_at);
      const completedMs = Date.parse(view.completed_at);
      const durationMin = Number.isFinite(startedMs) && Number.isFinite(completedMs)
        ? Math.max(0, Math.floor((completedMs - startedMs) / 60_000))
        : null;
      analyticsTrack({
        distinctId: userId,
        event: "match_scored_finalized",
        properties: {
          duration_min: durationMin,
          // Surface the game id as a property so PostHog can join with
          // the iOS `first_game_joined` event when funnels are built.
          game_id: gameId,
        },
      });
    }

    return view;
  }

  /** Public read — visible to anyone who can see the underlying game. */
  async get(gameId: string): Promise<MatchScoreView> {
    const game = await this.deps.db.db
      .selectFrom("games")
      .select(["id"])
      .where("id", "=", gameId)
      .executeTakeFirst();
    if (!game) throw new NotFoundError("Game not found");

    const row = await this.deps.db.db
      .selectFrom("match_scores")
      .selectAll()
      .where("game_id", "=", gameId)
      .executeTakeFirst();
    if (!row) throw new NotFoundError("Scoring has not been started for this game");
    return rowToView(this.normalize(row));
  }

  // ─────────────────────── helpers ───────────────────────

  private async fetchRow(tx: Executor, gameId: string): Promise<ScoreRow> {
    const r = await tx
      .selectFrom("match_scores")
      .selectAll()
      .where("game_id", "=", gameId)
      .executeTakeFirst();
    if (!r) throw new NotFoundError("Scoring row vanished");
    return this.normalize(r);
  }

  private async lockedRow(tx: Executor, gameId: string): Promise<ScoreRow> {
    const result = await sql<{
      game_id: string;
      team_a_user_ids: string[];
      team_b_user_ids: string[];
      sets: MatchScoreSetJson[];
      points: ("a" | "b")[];
      current_set: number;
      current_game_a: number;
      current_game_b: number;
      point_a: number;
      point_b: number;
      status: "in_progress" | "completed";
      started_at: Date;
      completed_at: Date | null;
      elo_delta_by_user: Record<string, number> | string;
    }>`
      SELECT * FROM match_scores WHERE game_id = ${gameId}::uuid FOR UPDATE
    `.execute(tx);
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Scoring has not been started for this game");
    return this.normalize(row);
  }

  /**
   * Postgres may hand jsonb back as already-parsed objects (node-pg parser
   * config) or raw strings. Normalize so the rules engine doesn't care.
   */
  private normalize(r: {
    game_id: string;
    team_a_user_ids: string[];
    team_b_user_ids: string[];
    sets: unknown;
    points: unknown;
    current_set: number;
    current_game_a: number;
    current_game_b: number;
    point_a: number;
    point_b: number;
    status: "in_progress" | "completed";
    started_at: Date;
    completed_at: Date | null;
    elo_delta_by_user?: unknown;
  }): ScoreRow {
    return {
      game_id: r.game_id,
      team_a_user_ids: r.team_a_user_ids,
      team_b_user_ids: r.team_b_user_ids,
      sets: typeof r.sets === "string" ? (JSON.parse(r.sets) as MatchScoreSetJson[]) : (r.sets as MatchScoreSetJson[]),
      points:
        typeof r.points === "string"
          ? (JSON.parse(r.points) as ("a" | "b")[])
          : (r.points as ("a" | "b")[]),
      current_set: r.current_set,
      current_game_a: r.current_game_a,
      current_game_b: r.current_game_b,
      point_a: r.point_a,
      point_b: r.point_b,
      status: r.status,
      started_at: r.started_at,
      completed_at: r.completed_at,
      // jsonb may come back parsed or as a string depending on pg parser
      // config; default to `{}` if the column is absent (older rows pre-
      // migration on a fresh test DB, etc.).
      elo_delta_by_user:
        r.elo_delta_by_user === undefined || r.elo_delta_by_user === null
          ? {}
          : typeof r.elo_delta_by_user === "string"
            ? (JSON.parse(r.elo_delta_by_user) as Record<string, number>)
            : (r.elo_delta_by_user as Record<string, number>),
    };
  }

  /**
   * Confirmed participants of the game (including the host) can write
   * points/undos. The "delegation" model: anyone in either team can keep
   * score. Spectators get 403.
   */
  private async assertCanWrite(tx: Executor, gameId: string, userId: string): Promise<void> {
    const isConfirmed = await tx
      .selectFrom("game_participants")
      .select(["user_id"])
      .where("game_id", "=", gameId)
      .where("user_id", "=", userId)
      .where("status", "=", "confirmed")
      .executeTakeFirst();
    if (!isConfirmed) {
      throw new ForbiddenError("Only confirmed participants can update the score");
    }
  }

  private async persist(
    tx: Executor,
    gameId: string,
    state: ScoreState,
    points: ("a" | "b")[],
  ): Promise<void> {
    await sql`
      UPDATE match_scores
         SET sets            = ${JSON.stringify(state.sets)}::jsonb,
             points          = ${JSON.stringify(points)}::jsonb,
             current_set     = ${state.current_set},
             current_game_a  = ${state.current_game_a},
             current_game_b  = ${state.current_game_b},
             point_a         = ${state.point_a},
             point_b         = ${state.point_b},
             status          = ${state.status}::match_score_status,
             completed_at    = CASE WHEN ${state.status}::match_score_status = 'completed'::match_score_status
                                    THEN COALESCE(completed_at, now())
                                    ELSE completed_at END
       WHERE game_id = ${gameId}::uuid
    `.execute(tx);

    // If the rules engine decided the match is over, flip the game too.
    if (state.status === "completed") {
      await tx
        .updateTable("games")
        .set({ status: "completed" })
        .where("id", "=", gameId)
        .execute();
    }
  }
}

// Export the initial state for tests that want to assert it.
export { initialScoreState };
