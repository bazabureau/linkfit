import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import { digestRepository, type DigestRecipient } from "./digest.repository.js";
import {
  hasAnyContent,
  renderWeeklyDigest,
  type RenderedDigest,
  type WeeklyDigestData,
} from "./digest.template.js";
import { type DigestMailTransport } from "./digest.transport.js";

/**
 * Public kind constant for the weekly digest. Stable string — used as part
 * of the `email_digest_log` composite primary key so renaming it would
 * silently re-send to everyone who got the v1 digest. Keep this constant
 * exported so tests and the scheduler refer to the same literal.
 */
export const WEEKLY_DIGEST_KIND = "weekly";

export interface DigestServiceDeps {
  db: DbHandle;
  logger: Logger;
  transport: DigestMailTransport;
  /** Override the clock for tests. Defaults to `new Date()` per call. */
  now?: () => Date;
}

export interface RunWeeklyResult {
  attempted: number;
  sent: number;
  skipped_empty: number;
  skipped_already_sent: number;
  failed: number;
}

/**
 * DigestService — composes and mails the weekly summary.
 *
 * Lifecycle:
 *   1. `weeklyDigestRecipients()` — filter users on prefs + verified email.
 *   2. `composeWeeklyDigest(userId)` — pull the four content sections and
 *      build a `RenderedDigest`. Returns `null` for users with no content
 *      so the caller can skip the send entirely (better than a "you have
 *      nothing this week" email).
 *   3. `runWeeklyDigest()` — iterates the recipient list, composes, and
 *      sends through the injected `DigestMailTransport`. After a successful
 *      send (or "already sent" idempotency hit), writes a log row.
 *
 * Idempotency:
 *   The log row is inserted via `ON CONFLICT DO NOTHING` keyed on
 *   `(user_id, kind, sent_at::date)`. We try the insert BEFORE the send so
 *   a re-run inside the same day naturally short-circuits each recipient.
 *   The cost is one wasted DB write on a re-run; the benefit is that a
 *   re-run cannot trigger a second SMTP delivery even if it lands while
 *   the first run is mid-flight.
 */
export class DigestService {
  constructor(private readonly deps: DigestServiceDeps) {}

  private clock(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  weeklyDigestRecipients(): Promise<DigestRecipient[]> {
    return digestRepository.weeklyDigestRecipients(this.deps.db);
  }

  /**
   * Build the rendered email for a single recipient. Returns `null` when
   * the recipient has nothing to surface this week — callers MUST treat
   * `null` as "do not send".
   */
  async composeWeeklyDigest(userId: string): Promise<RenderedDigest | null> {
    const recipientRow = await digestRepository
      .weeklyDigestRecipients(this.deps.db)
      .then((rs) => rs.find((r) => r.user_id === userId));
    // The composer is also exposed via the admin route for ad-hoc testing,
    // so we tolerate "user isn't actually on the digest list" by falling
    // back to a minimal lookup. We still surface a usable display name.
    const displayName = recipientRow?.display_name ?? "there";

    const [upcoming, followers, activity, badges] = await Promise.all([
      digestRepository.upcomingGamesFor(this.deps.db, userId),
      digestRepository.newFollowersFor(this.deps.db, userId),
      digestRepository.friendActivityFor(this.deps.db, userId),
      digestRepository.badgesUnlockedFor(this.deps.db, userId),
    ]);

    const data: WeeklyDigestData = {
      display_name: displayName,
      upcoming_games: upcoming,
      new_followers: followers,
      friend_activity: activity,
      badges_unlocked: badges,
    };

    if (!hasAnyContent(data)) return null;
    return renderWeeklyDigest(data);
  }

  /**
   * Iterate every opted-in, verified recipient and dispatch the weekly
   * digest. Returns counters useful for ops dashboards / the admin
   * manual-trigger endpoint.
   *
   * Errors during a single send are caught and logged — the run continues
   * for the remaining users. Hard DB failures (recipient query) bubble up
   * so the operator sees the underlying problem.
   */
  async runWeeklyDigest(): Promise<RunWeeklyResult> {
    const recipients = await this.weeklyDigestRecipients();
    const now = this.clock();

    let sent = 0;
    let skippedEmpty = 0;
    let skippedAlreadySent = 0;
    let failed = 0;

    for (const r of recipients) {
      // Idempotency check FIRST. `logIfFresh` returns true when this call
      // actually wrote a row — false means another run already covered
      // the user today.
      const isFresh = await digestRepository.logIfFresh(
        this.deps.db,
        r.user_id,
        WEEKLY_DIGEST_KIND,
        now,
      );
      if (!isFresh) {
        skippedAlreadySent += 1;
        continue;
      }

      let rendered: RenderedDigest | null;
      try {
        rendered = await this.composeWeeklyDigest(r.user_id);
      } catch (err) {
        // The pre-write is already there; we could leave it (counts as a
        // failed send) or roll it back. We log the row because retrying
        // immediately is more likely to re-hit the same bug than recover.
        this.deps.logger.error(
          { err, user_id: r.user_id },
          "digest.compose failed",
        );
        failed += 1;
        continue;
      }

      if (rendered === null) {
        // Empty digest — log row already exists, intentionally do nothing.
        // This means the next time the user collects activity the digest
        // will skip them ONLY if the prior empty-write was today; on the
        // next scheduled Monday the date partition flips and a fresh log
        // row is written.
        skippedEmpty += 1;
        continue;
      }

      try {
        await this.deps.transport.send({
          to: r.email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        });
        sent += 1;
        this.deps.logger.info(
          { user_id: r.user_id, kind: WEEKLY_DIGEST_KIND },
          "digest sent",
        );
      } catch (err) {
        failed += 1;
        this.deps.logger.error(
          { err, user_id: r.user_id },
          "digest.send failed",
        );
      }
    }

    return {
      attempted: recipients.length,
      sent,
      skipped_empty: skippedEmpty,
      skipped_already_sent: skippedAlreadySent,
      failed,
    };
  }
}
