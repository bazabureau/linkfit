import { type Logger } from "pino";
import { type DigestService } from "./digest.service.js";

export interface DigestSchedulerDeps {
  service: DigestService;
  logger: Logger;
  /** Polling cadence. Defaults to once per minute — small enough that the
   *  Monday-09:00-UTC window is never missed, large enough that the timer
   *  doesn't dominate process scheduling. Tests pass a smaller value. */
  tickIntervalMs?: number;
  /** Override the clock for tests. Defaults to `new Date()` per tick. */
  now?: () => Date;
}

const DEFAULT_TICK_MS = 60_000;

/**
 * Weekly digest scheduler.
 *
 * Strategy — we DON'T use a cron library; the only schedule we have is
 * "Monday 09:00 UTC weekly" and the idempotency guard at the DB layer
 * (`email_digest_log` composite PK on date partition) makes a once-per-
 * minute check perfectly safe even if the process restarts mid-window.
 *
 * On every tick:
 *   - read the current UTC time
 *   - if it's Monday AND hour==9 AND we haven't ticked this minute already,
 *     fire `runWeeklyDigest()`
 *
 * The "already fired this minute" guard is the in-process cheap check;
 * the DB idempotency is the durable one. If the process crashes between
 * the in-process flip and the DB log row we still don't double-send,
 * because the DB PK collision handles it.
 */
export class DigestScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Stringified `YYYY-MM-DDTHH:MM` of the most recent tick that triggered
   *  a run. Resets to `null` on stop(). */
  private lastFiredMinute: string | null = null;

  constructor(private readonly deps: DigestSchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.deps.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    // Don't keep the event loop alive purely for this timer — once the
    // server closes the scheduler tears itself down.
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lastFiredMinute = null;
  }

  /** Test seam — runs one tick synchronously (awaits the inner work). */
  async runOnce(): Promise<void> {
    await this.tick();
  }

  /**
   * Returns true when the supplied date falls inside the Monday 09:00 UTC
   * trigger window. Window is "Monday, hour 09, any minute". Exported via
   * the class so tests can drive it deterministically by passing a `now()`
   * factory through the constructor.
   */
  static isMondayNineUtc(d: Date): boolean {
    return d.getUTCDay() === 1 && d.getUTCHours() === 9;
  }

  private clock(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private async tick(): Promise<void> {
    if (this.running) return; // de-dupe overlapping ticks
    this.running = true;
    try {
      const now = this.clock();
      if (!DigestScheduler.isMondayNineUtc(now)) return;

      const minuteKey =
        `${String(now.getUTCFullYear())}-${String(now.getUTCMonth() + 1)}-` +
        `${String(now.getUTCDate())}T${String(now.getUTCHours())}:${String(now.getUTCMinutes())}`;
      if (this.lastFiredMinute === minuteKey) {
        // Same-minute re-tick — the previous run already either succeeded
        // or hit the DB idempotency guard. Skip the redundant DB round-trip.
        return;
      }
      this.lastFiredMinute = minuteKey;

      this.deps.logger.info(
        { minute: minuteKey },
        "digest.scheduler firing weekly run",
      );
      try {
        const result = await this.deps.service.runWeeklyDigest();
        this.deps.logger.info({ result }, "digest.scheduler weekly run complete");
      } catch (err) {
        this.deps.logger.error({ err }, "digest.scheduler weekly run failed");
        // Roll back the minute-key guard so the next tick (still inside the
        // window) retries — but only ONCE; the DB idempotency layer prevents
        // a retry-storm from double-sending the recipients who already got
        // through.
        this.lastFiredMinute = null;
      }
    } finally {
      this.running = false;
    }
  }
}
