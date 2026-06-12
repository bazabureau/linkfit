import { sql } from "kysely";
import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import { type NotificationsService } from "../social/notifications.service.js";

export interface GamesReminderSweeperDeps {
  db: DbHandle;
  logger: Logger;
  notifications: NotificationsService;
  /**
   * Polling cadence. Defaults to 5 min — the reminder window is only 20 min
   * wide (110-130 min before start), so a coarser interval risks missing a
   * game whose `starts_at` falls between two ticks. Tests pass a smaller
   * value to force an immediate sweep.
   */
  tickIntervalMs?: number;
  /**
   * Lower bound on "how soon" a game must be to qualify. Defaults to 110
   * min — together with the 130-min upper bound this gives a 20-min window
   * centred on the nominal 2-hour mark. The asymmetric padding tolerates
   * up to ~5 min of clock skew or a missed tick on either side.
   */
  reminderWindowMinBeforeMs?: number;
  /**
   * Upper bound on "how soon" a game must be to qualify. Defaults to 130
   * min. Pairs with `reminderWindowMinBeforeMs` above.
   */
  reminderWindowMaxBeforeMs?: number;
}

const DEFAULT_TICK_MS = 5 * 60 * 1000;
const DEFAULT_MIN_BEFORE_MS = 110 * 60 * 1000;
const DEFAULT_MAX_BEFORE_MS = 130 * 60 * 1000;

/**
 * Sweeper that fires the "Your game starts in 2 hours" reminder.
 *
 * **Why a sweeper, not a scheduled job?** The naive approach — schedule a
 * one-shot timer when the game is created — falls over the moment the
 * server restarts: every in-flight timer evaporates. Polling against the
 * DB is restart-safe and works across multiple API instances.
 *
 * **Exactly-once delivery.** Overlapping windows are unavoidable: a game
 * starting at t+118min is in range for the 09:00 sweep AND the 09:05
 * sweep. The ledger table `game_reminders_sent` carries a composite PK on
 * `(game_id, user_id)`. The sweeper INSERTs first with `ON CONFLICT DO
 * NOTHING RETURNING *` — only the rows the INSERT actually wrote come
 * back, and only those trigger `notifications.emit()`. After a crash
 * mid-batch the surviving ledger rows block re-sends on the next tick.
 *
 * **Why the type union check on `status`?** Cancelled or completed games
 * shouldn't generate reminders. We filter at SQL time rather than at
 * notification time because the ledger insert would otherwise burn a
 * (game_id, user_id) slot for a no-op delivery, blocking a fresh INSERT
 * if the game is somehow un-cancelled.
 */
export class GamesReminderSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: GamesReminderSweeperDeps) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.deps.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.deps.logger.info(
      { event: "games_reminder_sweeper_started", interval_ms: intervalMs },
      "games-reminder sweeper started",
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a single pass. Public so tests / admin can trigger out-of-band. */
  async tick(): Promise<{ remindersSent: number }> {
    if (this.running) return { remindersSent: 0 };
    this.running = true;
    try {
      const minBefore = this.deps.reminderWindowMinBeforeMs ?? DEFAULT_MIN_BEFORE_MS;
      const maxBefore = this.deps.reminderWindowMaxBeforeMs ?? DEFAULT_MAX_BEFORE_MS;
      // Boundaries captured once per tick so all per-game queries see the
      // same window — important for deterministic tests.
      const now = Date.now();
      const windowStart = new Date(now + minBefore);
      const windowEnd = new Date(now + maxBefore);

      // Pull due games. `status NOT IN ('cancelled','completed')` is the
      // SQL-side guard against burning ledger rows on no-op deliveries; see
      // the class doc for why.
      const dueGames = await this.deps.db.db
        .selectFrom("games")
        .select(["id", "starts_at", "host_user_id"])
        .where("status", "not in", ["cancelled", "completed"])
        .where("starts_at", ">=", windowStart)
        .where("starts_at", "<=", windowEnd)
        .limit(500)
        .execute();

      let remindersSent = 0;
      for (const game of dueGames) {
        try {
          remindersSent += await this.processGame(game.id, game.starts_at);
        } catch (err) {
          this.deps.logger.error(
            { err, game_id: game.id, event: "game_reminder_failed" },
            "failed to emit reminders for game",
          );
        }
      }

      if (remindersSent > 0) {
        this.deps.logger.info(
          { event: "games_reminder_sweep_done", reminders_sent: remindersSent },
          "games-reminder sweep done",
        );
      }
      return { remindersSent };
    } finally {
      this.running = false;
    }
  }

  /**
   * Reserve a ledger slot for every confirmed participant of this game,
   * then emit a notification for each slot we actually claimed. The
   * INSERT ... ON CONFLICT DO NOTHING RETURNING is the atomic
   * idempotency primitive: a competing sweep on a second API instance
   * will see exactly the rows it didn't lose the race for, and the rows
   * that lost will not produce a duplicate notification.
   *
   * Note that `emit()` writes to the DB inside its own transaction. If
   * that fails after we've reserved the ledger row, the user simply
   * doesn't get this reminder — we prefer "missed reminder" over "double
   * reminder", which matches user expectations (push-fatigue is the
   * worse failure mode).
   */
  private async processGame(gameId: string, startsAt: Date): Promise<number> {
    const claimed = await sql<{ user_id: string }>`
      INSERT INTO game_reminders_sent (game_id, user_id)
      SELECT ${gameId}, gp.user_id
        FROM game_participants gp
       WHERE gp.game_id = ${gameId}
         AND gp.status = 'confirmed'
      ON CONFLICT (game_id, user_id) DO NOTHING
      RETURNING user_id
    `.execute(this.deps.db.db);

    if (claimed.rows.length === 0) return 0;

    let sent = 0;
    for (const { user_id } of claimed.rows) {
      try {
        await this.deps.notifications.emit({
          userId: user_id,
          type: "game_reminder",
          title: "Game starting soon",
          body: "Your game starts in 2 hours.",
          payload: {
            game_id: gameId,
            starts_at: startsAt.toISOString(),
          },
        });
        sent += 1;
      } catch (err) {
        // A notification failure does NOT roll back the ledger row — see
        // the method-doc rationale (push-fatigue > missed reminder).
        this.deps.logger.error(
          { err, game_id: gameId, user_id, event: "game_reminder_emit_failed" },
          "failed to emit game reminder notification",
        );
      }
    }
    return sent;
  }
}
