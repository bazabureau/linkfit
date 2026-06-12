import { describe, it, expect, vi } from "vitest";
import { DeepHealthService, type Probe } from "./health-deep.service.js";
import { type DbHandle } from "../../shared/db/pool.js";

/**
 * Build a DbHandle whose `SELECT 1` either resolves or throws. We don't
 * need a real Kysely instance for these tests — DeepHealthService only
 * reaches `db.db` to issue the ping, and Kysely's `execute(...)` will
 * call whatever driver-shaped object we hand it.
 *
 * The shape mirrors enough of Kysely's QueryExecutor that `sql\`SELECT 1\`
 * works; if Kysely tightens that contract later, the test would shift
 * here rather than touching production code.
 */
function makeDb(opts: { dbResponse?: "ok" | "fail" | "slow" }): DbHandle {
  const behavior = opts.dbResponse ?? "ok";
  const fakeKysely = {
    executeQuery: () => {
      if (behavior === "fail") {
        return Promise.reject(new Error("connection refused"));
      }
      if (behavior === "slow") {
        return new Promise(() => {
          // Intentionally never resolves; the service should time out.
        });
      }
      return Promise.resolve({ rows: [{ "?column?": 1 }] });
    },
    getExecutor: () => ({
      executeQuery: fakeKysely.executeQuery,
    }),
  };
  return {
    db: fakeKysely as unknown as DbHandle["db"],
    pool: {} as unknown as DbHandle["pool"],
    close: async () => Promise.resolve(),
  };
}

describe("DeepHealthService", () => {
  it("returns ok when DB ping succeeds and no other probes registered", async () => {
    const svc = new DeepHealthService({ db: makeDb({}), version: "1.0.0" });
    const r = await svc.check();
    expect(r.status).toBe("ok");
    expect(r.checks.db?.status).toBe("ok");
    expect(r.checks.db?.latency_ms).toBeGreaterThanOrEqual(0);
    expect(r.version).toBe("1.0.0");
  });

  it("returns fail when DB ping rejects", async () => {
    const svc = new DeepHealthService({ db: makeDb({ dbResponse: "fail" }), version: "1.0.0" });
    const r = await svc.check();
    expect(r.status).toBe("fail");
    expect(r.checks.db?.status).toBe("fail");
  });

  it("times out the DB probe at the configured threshold", async () => {
    const svc = new DeepHealthService({
      db: makeDb({ dbResponse: "slow" }),
      version: "1.0.0",
      timeoutMs: 50,
    });
    const r = await svc.check();
    expect(r.status).toBe("fail");
    expect(r.checks.db?.status).toBe("fail");
    expect(r.checks.db?.reason).toMatch(/timeout/);
  });

  it("aggregates non-critical probe failures into degraded (DB still ok)", async () => {
    const stripeProbe: Probe = vi.fn().mockResolvedValue({ status: "fail", reason: "401" });
    const apnsProbe: Probe = vi.fn().mockResolvedValue({ status: "ok", latency_ms: 10 });
    const svc = new DeepHealthService({
      db: makeDb({}),
      version: "1.0.0",
      probes: { stripe: stripeProbe, apns: apnsProbe },
    });
    const r = await svc.check();
    expect(r.status).toBe("degraded");
    expect(r.checks.db?.status).toBe("ok");
    expect(r.checks.stripe?.status).toBe("fail");
    expect(r.checks.apns?.status).toBe("ok");
  });

  it("treats skipped probes as neutral — neither fail nor degrade", async () => {
    const stripeProbe: Probe = () => Promise.resolve({ status: "skipped", reason: "dummy_key" });
    const svc = new DeepHealthService({
      db: makeDb({}),
      version: "1.0.0",
      probes: { stripe: stripeProbe },
    });
    const r = await svc.check();
    expect(r.status).toBe("ok");
    expect(r.checks.stripe?.status).toBe("skipped");
  });

  it("survives a probe that throws synchronously", async () => {
    const buggy: Probe = () => {
      throw new Error("synchronous explosion");
    };
    const svc = new DeepHealthService({
      db: makeDb({}),
      version: "1.0.0",
      probes: { buggy },
    });
    const r = await svc.check();
    expect(r.status).toBe("degraded");
    expect(r.checks.buggy?.status).toBe("fail");
    expect(r.checks.buggy?.reason).toMatch(/synchronous explosion/);
  });
});
