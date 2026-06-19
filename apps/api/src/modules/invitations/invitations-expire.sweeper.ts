import { type Logger } from "pino";
import { type InvitationsService } from "./invitations.service.js";

export interface InvitationsExpireSweeperDeps {
  service: InvitationsService;
  logger: Logger;
  /** Defaults to 5 minutes. Tests may pass a smaller value. */
  tickIntervalMs?: number;
}

const DEFAULT_TICK_MS = 5 * 60 * 1000;

/**
 * Restart-safe poller that expires pending invitations after their game has
 * started. Without this, stale pending rows stay in `/me/invitations` until a
 * user manually accepts/declines and hits a precondition failure.
 */
export class InvitationsExpireSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: InvitationsExpireSweeperDeps) {}

  start(): void {
    if (this.timer !== null) return;
    const intervalMs = this.deps.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.deps.logger.info(
      { event: "invitations_expire_sweeper_started", interval_ms: intervalMs },
      "invitations-expire sweeper started",
    );
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ expired: number }> {
    if (this.running) return { expired: 0 };
    this.running = true;
    try {
      const expired = await this.deps.service.expireStalePending();
      if (expired > 0) {
        this.deps.logger.info(
          { event: "invitations_expired", expired },
          "expired stale game invitations",
        );
      }
      return { expired };
    } catch (err) {
      this.deps.logger.error(
        { err, event: "invitations_expire_sweep_failed" },
        "failed to expire stale game invitations",
      );
      return { expired: 0 };
    } finally {
      this.running = false;
    }
  }
}
