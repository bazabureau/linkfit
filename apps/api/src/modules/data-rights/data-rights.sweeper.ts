import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";

export interface DataRightsSweeperDeps {
  db: DbHandle;
  logger: Logger;
  /** Same path the service writes to. We never need to look outside this
   *  directory; the file URL contains the filename portion only. */
  uploadDir: string;
  /** Polling cadence. Defaults to 5 min — granular enough for the 30-day
   *  grace window (off by at most 5 min is acceptable) and the 7-day
   *  export TTL. Tests pass a smaller value. */
  tickIntervalMs?: number;
}

const DEFAULT_TICK_MS = 5 * 60 * 1000;

/**
 * Out-of-band sweeper for GDPR plumbing.
 *
 * Two passes per tick:
 *   1. **Hard-delete due accounts** — rows in `account_deletion_requests`
 *      with `status='scheduled'` and `hard_delete_at <= now()`. We DELETE
 *      the parent `users` row; foreign-key ON DELETE CASCADE walks every
 *      child table (games, ratings, bookings, follows, …) so the user
 *      vanishes from the entire dataset. The deletion request row is
 *      also cascade-deleted, so we don't even need to mark it completed.
 *
 *   2. **Purge expired data exports** — rows in `data_export_requests`
 *      with `status='ready'` and `expires_at <= now()`. We unlink the
 *      on-disk JSON file and flip the row's `status` to `failed` with a
 *      `download_url=NULL` to signal "no longer available". (We don't
 *      delete the row itself so the user can see the history.)
 *
 * The sweeper is idempotent — running it 10 times in a row is the same
 * as running it once. Failures on individual rows are logged and don't
 * stop the sweep; the next tick will retry.
 */
export class DataRightsSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: DataRightsSweeperDeps) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.deps.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.deps.logger.info(
      { event: "data_rights_sweeper_started", interval_ms: intervalMs },
      "data-rights sweeper started",
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a single pass. Public so tests / admin can trigger out-of-band. */
  async tick(): Promise<{ accountsDeleted: number; exportsPurged: number }> {
    if (this.running) return { accountsDeleted: 0, exportsPurged: 0 };
    this.running = true;
    try {
      const accountsDeleted = await this.hardDeleteDueAccounts();
      const exportsPurged = await this.purgeExpiredExports();
      if (accountsDeleted > 0 || exportsPurged > 0) {
        this.deps.logger.info(
          {
            event: "data_rights_sweep_done",
            accounts_deleted: accountsDeleted,
            exports_purged: exportsPurged,
          },
          "data-rights sweep completed",
        );
      }
      return { accountsDeleted, exportsPurged };
    } finally {
      this.running = false;
    }
  }

  private async hardDeleteDueAccounts(): Promise<number> {
    // Pull the user ids first rather than `DELETE ... USING` so each
    // deletion can be logged individually. The set is bounded (typical
    // deployment sees <100 due-deletions per tick), so the round-trip is
    // negligible.
    const due = await this.deps.db.db
      .selectFrom("account_deletion_requests")
      .select("user_id")
      .where("status", "=", "scheduled")
      .where("hard_delete_at", "<=", new Date())
      .limit(100)
      .execute();

    let deleted = 0;
    for (const { user_id } of due) {
      try {
        await this.deps.db.db
          .deleteFrom("users")
          .where("id", "=", user_id)
          .execute();
        deleted += 1;
        this.deps.logger.info(
          { event: "account_hard_deleted", user_id },
          "account hard-deleted by sweeper",
        );
      } catch (err) {
        this.deps.logger.error(
          { err, user_id, event: "account_hard_delete_failed" },
          "failed to hard-delete account",
        );
      }
    }
    return deleted;
  }

  private async purgeExpiredExports(): Promise<number> {
    const due = await this.deps.db.db
      .selectFrom("data_export_requests")
      .select(["id", "download_url"])
      .where("status", "=", "ready")
      .where("expires_at", "<=", new Date())
      .limit(100)
      .execute();

    let purged = 0;
    for (const row of due) {
      try {
        if (row.download_url !== null) {
          const filename = row.download_url.split("/").pop();
          if (filename !== undefined && filename.length > 0) {
            const filepath = join(this.deps.uploadDir, "data-exports", filename);
            try {
              unlinkSync(filepath);
            } catch {
              // Already gone, or never existed on this host — fine.
            }
          }
        }
        await this.deps.db.db
          .updateTable("data_export_requests")
          .set({ status: "failed", download_url: null })
          .where("id", "=", row.id)
          .execute();
        purged += 1;
      } catch (err) {
        this.deps.logger.error(
          { err, export_id: row.id, event: "export_purge_failed" },
          "failed to purge expired export",
        );
      }
    }
    return purged;
  }
}
