import { sql } from "kysely";
import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";

export interface GamesCompletionSweeperDeps {
  db: DbHandle;
  logger: Logger;
  /**
   * Polling cadence. Defaults to 15min — granular enough that the longest
   * a stale "open" game can linger past its end is ~15min, which is well
   * inside the no-show grace window. Tests pass a smaller value.
   */
  tickIntervalMs?: number;
  /**
   * How long after a game's end time we wait before flipping participants
   * who never recorded a score to `no_show`. Defaults to 2 hours — long
   * enough that the host can manually mark a score before the cron auto-
   * marks the absentees.
   */
  noShowGraceMs?: number;
  /**
   * How much each no-show drops the player's `reliability_score`. The score
   * starts at 100 and clamps at 0; defaults to 10 so a "typical bad
   * player" takes ~10 no-shows to bottom out. Adjust with PO feedback.
   */
  noShowPenalty?: number;
}

const DEFAULT_TICK_MS = 15 * 60 * 1000;
const DEFAULT_GRACE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_PENALTY = 10;

/**
 * Two-pass sweeper that closes the lifecycle of past games.
 *
 * **Pass 1 — Status transition.**
 * Any game in `open`/`full` whose `starts_at + duration_minutes` is in the
 * past flips to `completed`. This is the missing transition that left the
 * iOS UI showing a Join button on stale games (FAZA 61.1) — the only thing
 * that actually rejected the tap was the backend's `tryJoin` precondition
 * check, so the user experienced an opaque 422.
 *
 * **Pass 2 — No-show flagging + reliability decay.**
 * For every game that just finished (or finished more than `noShowGraceMs`
 * ago without scoring), participants still in `confirmed` are auto-flipped
 * to `no_show`. Each transition decrements that user's
 * `player_sport_stats.reliability_score` by `noShowPenalty`, clamped at 0.
 *
 * The sweeper is idempotent — once a participant is `no_show` the penalty
 * never re-applies because the WHERE clause filters on `status='confirmed'`.
 * That's the key invariant: rerunning the sweep is safe.
 *
 * **Why a single sweeper for both?** Pass 1 must come BEFORE Pass 2 so the
 * UI never sees a "completed game" that still has confirmed participants —
 * the state machine flows strictly status→participants.
 */
export class GamesCompletionSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: GamesCompletionSweeperDeps) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.deps.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.deps.logger.info(
      { event: "games_completion_sweeper_started", interval_ms: intervalMs },
      "games-completion sweeper started",
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a single pass. Public so tests / admin can trigger out-of-band. */
  async tick(): Promise<{ gamesCompleted: number; noShowsFlagged: number }> {
    if (this.running) return { gamesCompleted: 0, noShowsFlagged: 0 };
    this.running = true;
    try {
      const gamesCompleted = await this.transitionEndedGamesToCompleted();
      const noShowsFlagged = await this.flagNoShows();
      if (gamesCompleted > 0 || noShowsFlagged > 0) {
        this.deps.logger.info(
          {
            event: "games_completion_sweep_done",
            games_completed: gamesCompleted,
            no_shows_flagged: noShowsFlagged,
          },
          "games-completion sweep done",
        );
      }
      return { gamesCompleted, noShowsFlagged };
    } finally {
      this.running = false;
    }
  }

  /**
   * Flip every game whose end time (starts_at + duration_minutes) has
   * passed and which is still nominally joinable to `completed`. Returns
   * the row count.
   */
  private async transitionEndedGamesToCompleted(): Promise<number> {
    const res = await sql<{ id: string }>`
      UPDATE games
         SET status = 'completed'
       WHERE status IN ('open', 'full')
         AND (starts_at + (duration_minutes || ' minutes')::interval) < NOW()
       RETURNING id
    `.execute(this.deps.db.db);
    return res.rows.length;
  }

  /**
   * For every game whose end time is older than the grace window and whose
   * status is `completed`, flip `confirmed` participants to `no_show` and
   * decrement their reliability_score.
   *
   * We compound the two operations into one SQL round-trip per game so a
   * crash mid-batch only loses unprocessed games — the ones already done
   * are durably consistent.
   */
  private async flagNoShows(): Promise<number> {
    const graceMs = this.deps.noShowGraceMs ?? DEFAULT_GRACE_MS;
    const penalty = this.deps.noShowPenalty ?? DEFAULT_PENALTY;
    // Boundary timestamp computed in JS (rather than NOW() - INTERVAL) so
    // the value is captured once per tick — useful for deterministic tests.
    const cutoff = new Date(Date.now() - graceMs);

    // Pull due games first so each one can be processed in its own
    // transaction. This bounds the lock window — a single tx covering
    // all of today's games would block writes against game_participants
    // for the entire scan.
    const due = await this.deps.db.db
      .selectFrom("games")
      .select(["id", "sport_id"])
      .where("status", "=", "completed")
      .where(sql<boolean>`(starts_at + (duration_minutes || ' minutes')::interval) < ${cutoff}`)
      .limit(200)
      .execute();

    let flagged = 0;
    for (const game of due) {
      try {
        const result = await this.deps.db.db.transaction().execute(async (tx) => {
          // Pull the confirmed-but-not-played participants. We flip them to
          // no_show in one update and capture their user_ids so we can
          // decrement reliability in the same tx.
          const rows = await sql<{ user_id: string }>`
            UPDATE game_participants
               SET status = 'no_show',
                   status_changed_at = NOW()
             WHERE game_id = ${game.id}
               AND status = 'confirmed'
             RETURNING user_id
          `.execute(tx);

          if (rows.rows.length === 0) return 0;

          // Decrement reliability_score for each flagged user. Composite PK
          // (user_id, sport_id) means we upsert at the same row that
          // tracks elo/games_played; a brand-new row defaults to 100 then
          // immediately gets penalty applied. GREATEST clamps at 0.
          for (const { user_id } of rows.rows) {
            await sql`
              INSERT INTO player_sport_stats
                (user_id, sport_id, reliability_score)
              VALUES
                (${user_id}, ${game.sport_id}, GREATEST(100 - ${penalty}, 0))
              ON CONFLICT (user_id, sport_id) DO UPDATE
                SET reliability_score = GREATEST(player_sport_stats.reliability_score - ${penalty}, 0),
                    updated_at = NOW()
            `.execute(tx);
          }

          return rows.rows.length;
        });
        flagged += result;
      } catch (err) {
        this.deps.logger.error(
          { err, game_id: game.id, event: "no_show_flag_failed" },
          "failed to flag no-shows for game",
        );
      }
    }
    return flagged;
  }
}
