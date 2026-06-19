import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { InvitationsExpireSweeper } from "./invitations-expire.sweeper.js";
import { type InvitationsService } from "./invitations.service.js";

describe("InvitationsExpireSweeper", () => {
  it("expires stale pending invitations through the service", async () => {
    const expireStalePending = vi.fn<() => Promise<number>>().mockResolvedValue(3);
    const service = {
      expireStalePending,
    } as Pick<InvitationsService, "expireStalePending"> as InvitationsService;
    const sweeper = new InvitationsExpireSweeper({
      service,
      logger: pino({ level: "silent" }),
    });

    await expect(sweeper.tick()).resolves.toEqual({ expired: 3 });
    expect(expireStalePending).toHaveBeenCalledTimes(1);
  });

  it("coalesces overlapping ticks", async () => {
    let release!: () => void;
    const first = new Promise<number>((resolve) => {
      release = () => {
        resolve(1);
      };
    });
    const expireStalePending = vi.fn<() => Promise<number>>().mockReturnValue(first);
    const service = {
      expireStalePending,
    } as Pick<InvitationsService, "expireStalePending"> as InvitationsService;
    const sweeper = new InvitationsExpireSweeper({
      service,
      logger: pino({ level: "silent" }),
    });

    const inFlight = sweeper.tick();
    await expect(sweeper.tick()).resolves.toEqual({ expired: 0 });
    release();
    await expect(inFlight).resolves.toEqual({ expired: 1 });
    expect(expireStalePending).toHaveBeenCalledTimes(1);
  });

  it("logs and returns zero when the service throws", async () => {
    const service = {
      expireStalePending: vi.fn<() => Promise<number>>().mockRejectedValue(new Error("db down")),
    } as Pick<InvitationsService, "expireStalePending"> as InvitationsService;
    const sweeper = new InvitationsExpireSweeper({
      service,
      logger: pino({ level: "silent" }),
    });

    await expect(sweeper.tick()).resolves.toEqual({ expired: 0 });
  });
});
