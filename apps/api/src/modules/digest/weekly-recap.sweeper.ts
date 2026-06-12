/**
 * Weekly-recap sweeper (Wave-10).
 *
 * Fires once per Sunday 19:00 LOCAL time per user. Each tick:
 *
 *   1. Pull every user whose IANA `time_zone` puts them at Sunday
 *      19:00 (±30 min) right now AND who hasn't yet received a recap
 *      for THIS calendar Sunday.
 *   2. For each user:
 *        a. Aggregate the week stats via `WeeklyRecapService`.
 *        b. Skip when `totalActivity == 0` (no games + no new
 *           followers — sending an empty recap is worse than
 *           sending none).
 *        c. Render the recap PNG → write to
 *           `${uploadDir}/recap/<uuid>.png` → build the public URL.
 *        d. Insert a stories row via `stories.createSystemStory()` so
 *           the recap surfaces on the user's own rail AND their
 *           followers' rails. `createSystemStory` returns `null` when
 *           a duplicate exists for the same caption within the 24h
 *           TTL, which doubles as a defense-in-depth idempotency guard.
 *        e. Best-effort push notification: "Həftəlik hesabat hazırdır! 📊"
 *
 * Idempotency:
 *   The mission forbids new tables. We rely on
 *   `stories.createSystemStory`'s caption-based dedupe — an active
 *   story with `caption = "Bu həftə padel"` for the same user is
 *   considered "already sent" for this 24h window. Since the sweeper
 *   only fires when local time is in the Sunday 19:00 hour, the
 *   active-story check covers the entire one-hour window cleanly.
 *
 * Time-zone handling:
 *   The `Asia/Baku` default on `users.time_zone` (from migration
 *   1700000400000_daily-digest) lets us compute the local day-of-week
 *   + hour in SQL via `NOW() AT TIME ZONE u.time_zone`. The sweeper
 *   fires when:
 *     - extract(dow ...) = 0   (Sunday; pg dow uses 0=Sunday)
 *     - extract(hour ...) = 19 (19:00–19:59 local)
 *
 *   The tick cadence is 30 minutes so we cover the full hour with
 *   margin even if a tick is delayed.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import { type NotificationsService } from "../social/notifications.service.js";
import { renderPushTemplate } from "../../shared/i18n/index.js";
import { type StoriesService } from "../stories/stories.service.js";
import { type WeeklyRecapService } from "./weekly-recap.service.js";

export interface WeeklyRecapSweeperDeps {
  db: DbHandle;
  logger: Logger;
  recap: WeeklyRecapService;
  stories: StoriesService;
  /** Optional — used to push the "recap is ready" banner. Skipped
   *  silently when omitted (unit tests). */
  notifications?: NotificationsService | undefined;
  /** Filesystem location the PNG writes into. The recap files land
   *  under `${uploadDir}/recap/<uuid>.png` and are served from the
   *  same `/uploads/*` static handler the rest of the upload surface
   *  uses. */
  uploadDir: string;
  /** Used to build the absolute story media URL. When undefined the
   *  sweeper writes a relative `/uploads/recap/<file>` URL — fine for
   *  local dev, the iOS client treats it as relative-to-API-base. */
  publicBaseUrl?: string | undefined;
  /** Polling cadence. Defaults to 30 minutes — half the trigger window
   *  width so the sweeper can never miss it. Tests pass a smaller
   *  value or call `runOnce()` directly. */
  tickIntervalMs?: number;
  /** Override the clock for tests. Defaults to `new Date()` per tick. */
  now?: () => Date;
  /** Max users processed per tick. Bounded so a Sunday-evening backlog
   *  (e.g. after a long outage) doesn't open a multi-thousand-row
   *  render loop in one transaction. */
  batchSize?: number;
}

const DEFAULT_TICK_MS = 30 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 200;

/** Caption shown to the user on the story card. Also the dedupe key
 *  passed to `stories.createSystemStory`. */
export const RECAP_CAPTION = "Bu həftə padel";

interface SweeperResult {
  /** Users found in the Sunday 19:00 window. */
  attempted: number;
  /** Recaps successfully posted as system stories. */
  sent: number;
  /** Users skipped because they had 0 games + 0 new followers. */
  skippedEmpty: number;
  /** Users skipped because `createSystemStory` saw a duplicate. */
  skippedDuplicate: number;
  /** Users where any step (render / write / insert / push) threw. */
  failed: number;
}

export class WeeklyRecapSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: WeeklyRecapSweeperDeps) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.deps.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.deps.logger.info(
      { event: "weekly_recap_sweeper_started", interval_ms: intervalMs },
      "weekly-recap sweeper started",
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a single pass. Exposed for tests + the admin manual trigger. */
  async runOnce(): Promise<SweeperResult> {
    return this.tick();
  }

  private clock(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private async tick(): Promise<SweeperResult> {
    if (this.running) {
      return { attempted: 0, sent: 0, skippedEmpty: 0, skippedDuplicate: 0, failed: 0 };
    }
    this.running = true;
    const result: SweeperResult = {
      attempted: 0,
      sent: 0,
      skippedEmpty: 0,
      skippedDuplicate: 0,
      failed: 0,
    };
    try {
      const candidates = await this.findCandidates();
      result.attempted = candidates.length;
      for (const c of candidates) {
        try {
          const outcome = await this.processUser(c.user_id);
          if (outcome === "sent") result.sent += 1;
          else if (outcome === "empty") result.skippedEmpty += 1;
          else result.skippedDuplicate += 1;
        } catch (err) {
          result.failed += 1;
          this.deps.logger.error(
            { err, user_id: c.user_id, event: "weekly_recap_user_failed" },
            "weekly-recap processing failed for user",
          );
        }
      }
      if (result.attempted > 0) {
        this.deps.logger.info(
          { event: "weekly_recap_tick_done", result },
          "weekly-recap sweep completed",
        );
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  /**
   * Pick users whose LOCAL clock currently reads Sunday 19:xx. The
   * predicate uses Postgres' `AT TIME ZONE` so the calendar math is
   * applied per-row. We also exclude users who:
   *   - opted out (`daily_digest_enabled = false`) — the W10-9 daily
   *     toggle is the closest existing surface to a "weekly recap"
   *     opt-out; piggy-backing on it keeps the iOS settings screen
   *     unchanged. The user can disable the daily digest to suppress
   *     both daily AND weekly. Adding a recap-specific opt-out lands
   *     in a follow-up.
   *   - are soft-deleted.
   *
   * The batch is bounded to `DEFAULT_BATCH_SIZE` so a Sunday-evening
   * backlog stays manageable; the next tick (30 min later) picks up
   * any remainder.
   */
  private async findCandidates(): Promise<{ user_id: string }[]> {
    const batchSize = this.deps.batchSize ?? DEFAULT_BATCH_SIZE;
    const nowIso = this.clock().toISOString();
    const rows = await sql<{ user_id: string }>`
      SELECT u.id AS user_id
        FROM users u
       WHERE u.deleted_at IS NULL
         AND u.daily_digest_enabled = true
         AND EXTRACT(DOW  FROM (${nowIso}::timestamptz AT TIME ZONE u.time_zone)) = 0
         AND EXTRACT(HOUR FROM (${nowIso}::timestamptz AT TIME ZONE u.time_zone)) = 19
         AND NOT EXISTS (
              SELECT 1 FROM stories s
               WHERE s.user_id = u.id
                 AND s.caption = ${RECAP_CAPTION}
                 AND s.expires_at > NOW()
         )
       ORDER BY u.id
       LIMIT ${batchSize}
    `.execute(this.deps.db.db);
    return rows.rows;
  }

  /**
   * Compose + post a recap story for one user. Returns the outcome
   * tag the tick uses to update its counters. Throws on hard failures
   * (filesystem / db) so the caller logs + increments the failure
   * counter; soft "user had no activity" or "already has a recap"
   * cases return tags instead of throwing.
   */
  private async processUser(
    userId: string,
  ): Promise<"sent" | "empty" | "duplicate"> {
    const aggregate = await this.deps.recap.aggregateForUser(userId);
    if (aggregate === null || aggregate.totalActivity === 0 || aggregate.gamesPlayed === 0) {
      // Spec: "Skip users with 0 games (don't send empty recap)".
      // We additionally short-circuit on `totalActivity == 0` so a
      // brand-new account with one new follower but no games still
      // doesn't get a meaningless recap.
      return "empty";
    }

    const png = await this.deps.recap.renderPng(aggregate);

    // Persist the PNG bytes into the upload dir. We use the same
    // `recap` subfolder convention the stories module uses for its
    // own `stories/` folder, so the cleanup story is uniform.
    const recapDir = join(this.deps.uploadDir, "recap");
    await mkdir(recapDir, { recursive: true });
    const filename = `${randomUUID()}.png`;
    const filepath = join(recapDir, filename);
    await writeFile(filepath, png);

    const origin = this.deps.publicBaseUrl ?? "";
    const trimmed = origin.replace(/\/+$/, "");
    const mediaUrl = trimmed.length > 0
      ? `${trimmed}/uploads/recap/${filename}`
      : `/uploads/recap/${filename}`;

    const created = await this.deps.stories.createSystemStory(userId, {
      media_url: mediaUrl,
      caption: RECAP_CAPTION,
      dedupe_caption: RECAP_CAPTION,
    });
    if (created === null) {
      // Defense-in-depth — the `findCandidates` query already
      // excludes users with an active recap story, but another tick
      // could race in. Treat as a duplicate.
      return "duplicate";
    }

    // Push notification — best-effort.
    if (this.deps.notifications) {
      try {
        const { title, body } = renderPushTemplate(
          "digest.weekly_recap",
          // The recap module doesn't carry a per-user locale yet —
          // the AZ template is the source of truth and matches the
          // recap card's own AZ copy. When `users.locale` lands the
          // sweeper can thread it through here.
          "az",
          {},
        );
        await this.deps.notifications.emit({
          userId,
          type: "system",
          title,
          body,
          payload: {
            type: "digest.weekly_recap",
            event: "weekly_recap_posted",
            story_id: created.id,
          },
        });
      } catch (err) {
        // Notifications are best-effort — a broken push transport
        // must NEVER undo the story write. Log + continue.
        this.deps.logger.warn(
          { err, user_id: userId, event: "weekly_recap_push_failed" },
          "failed to emit recap push notification",
        );
      }
    }

    return "sent";
  }
}
