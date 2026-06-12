import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { sql } from "kysely";
import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";

export interface StoriesExpireSweeperDeps {
  db: DbHandle;
  logger: Logger;
  /** Same path the upload route writes to. Story media lives under
   *  `${uploadDir}/stories/*`; we extract the filename from the persisted
   *  `media_url` and unlink locally. */
  uploadDir: string;
  /** Polling cadence. Defaults to 30 min — granular enough for the 24h
   *  TTL (off by at most 30 min is acceptable) without hammering the DB.
   *  Tests pass a smaller value to drive a deterministic tick. */
  tickIntervalMs?: number;
  /** Max rows to delete per tick. Bounded so a backlog (e.g. after a long
   *  outage) doesn't open a 100k-row delete transaction. */
  batchSize?: number;
}

const DEFAULT_TICK_MS = 30 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 500;

/**
 * Out-of-band sweeper for the stories module.
 *
 * Each tick:
 *   1. Pull up to `batchSize` rows where `expires_at < now()`.
 *   2. For each row, unlink the on-disk media file (best-effort —
 *      missing files don't fail the sweep).
 *   3. DELETE the row. Child `story_views` rows cascade-delete with it.
 *
 * Idempotent. Failures on individual rows are logged and don't stop the
 * sweep; the next tick will retry.
 */
export class StoriesExpireSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: StoriesExpireSweeperDeps) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.deps.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.deps.logger.info(
      { event: "stories_expire_sweeper_started", interval_ms: intervalMs },
      "stories-expire sweeper started",
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a single pass. Public so tests / admin can trigger out-of-band. */
  async tick(): Promise<{ storiesDeleted: number }> {
    if (this.running) return { storiesDeleted: 0 };
    this.running = true;
    try {
      const storiesDeleted = await this.deleteExpiredStories();
      if (storiesDeleted > 0) {
        this.deps.logger.info(
          { event: "stories_expire_sweep_done", stories_deleted: storiesDeleted },
          "stories-expire sweep completed",
        );
      }
      return { storiesDeleted };
    } finally {
      this.running = false;
    }
  }

  private async deleteExpiredStories(): Promise<number> {
    const batchSize = this.deps.batchSize ?? DEFAULT_BATCH_SIZE;

    // Fetch first so we can unlink the on-disk files individually. Doing
    // the DELETE in a single statement (USING ...) would lose the
    // file-name list. The batch is bounded so the round-trip is cheap.
    const due = await this.deps.db.db
      .selectFrom("stories")
      .select(["id", "media_url"])
      .where(sql<boolean>`expires_at < NOW()`)
      .limit(batchSize)
      .execute();

    let deleted = 0;
    for (const row of due) {
      // Best-effort unlink. The `media_url` is shaped like
      // `${origin}/uploads/stories/<uuid>.<ext>`; we only care about the
      // last two segments so a config change to PUBLIC_BASE_URL between
      // upload and expiry doesn't strand files.
      try {
        const filename = row.media_url.split("/").pop();
        if (filename !== undefined && filename.length > 0) {
          const filepath = join(this.deps.uploadDir, "stories", filename);
          try {
            unlinkSync(filepath);
          } catch {
            // Already gone, or never existed on this host (e.g. multi-pod
            // deploy without shared storage) — fine, move on.
          }
        }
      } catch (err) {
        this.deps.logger.warn(
          { err, story_id: row.id, event: "story_media_unlink_failed" },
          "failed to unlink expired story media",
        );
      }
      try {
        await this.deps.db.db
          .deleteFrom("stories")
          .where("id", "=", row.id)
          .execute();
        deleted += 1;
      } catch (err) {
        this.deps.logger.error(
          { err, story_id: row.id, event: "story_delete_failed" },
          "failed to delete expired story row",
        );
      }
    }
    return deleted;
  }
}
