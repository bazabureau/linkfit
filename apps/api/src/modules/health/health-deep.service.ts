import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";

/** Per-dependency probe result returned by every check. */
export interface CheckResult {
  readonly status: "ok" | "fail" | "skipped";
  readonly latency_ms?: number;
  readonly reason?: string;
}

export type Probe = () => Promise<CheckResult>;

export interface DeepHealthReport {
  /** "ok" when DB is up and no critical dependency is failing. "degraded"
   *  when non-critical probes fail (Stripe / SMTP / APNs). The deep route
   *  maps "degraded" to HTTP 200 (orchestrator should NOT drain pods on
   *  optional-probe failure) and "fail" to HTTP 503 (DB is down — drain). */
  readonly status: "ok" | "degraded" | "fail";
  readonly version: string;
  readonly checks: Record<string, CheckResult>;
}

export interface DeepHealthDeps {
  readonly db: DbHandle;
  readonly version: string;
  /** Optional non-critical probes. Failures here yield "degraded" but
   *  still 200, so a third-party outage (Stripe down) doesn't drain
   *  every API pod and cause a cascading user-visible failure. */
  readonly probes?: Record<string, Probe>;
  /** Defaults to 1000ms. The DB probe is wrapped with this timeout
   *  because Kysely's `await sql\`SELECT 1\`.execute(...)` will hang
   *  forever on a netsplit otherwise. */
  readonly timeoutMs?: number;
}

/**
 * Wrap a promise with a timeout. If `p` hasn't resolved by `ms`, returns a
 * fail CheckResult instead of throwing. We never want a readiness probe
 * to crash with an exception — the orchestrator interprets 5xx + non-JSON
 * as "broken pod, never serves traffic again" rather than "drain me".
 */
async function withTimeout(probe: Probe, ms: number, name: string): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({ status: "fail", reason: `${name} probe timeout after ${String(ms)}ms` });
    }, ms);
  });
  try {
    return await Promise.race([probe(), timeout]);
  } catch (err) {
    return {
      status: "fail",
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class DeepHealthService {
  private readonly db: DbHandle;
  private readonly version: string;
  private readonly probes: Record<string, Probe>;
  private readonly timeoutMs: number;

  constructor(deps: DeepHealthDeps) {
    this.db = deps.db;
    this.version = deps.version;
    this.probes = deps.probes ?? {};
    this.timeoutMs = deps.timeoutMs ?? 1000;
  }

  async check(): Promise<DeepHealthReport> {
    const dbProbe: Probe = async () => {
      const start = Date.now();
      await sql`SELECT 1`.execute(this.db.db);
      return { status: "ok", latency_ms: Date.now() - start };
    };

    const probeEntries = Object.entries(this.probes);
    const [dbResult, ...probeResults] = await Promise.all([
      withTimeout(dbProbe, this.timeoutMs, "db"),
      ...probeEntries.map(([name, probe]) =>
        withTimeout(probe, this.timeoutMs, name),
      ),
    ]);

    const checks: Record<string, CheckResult> = { db: dbResult };
    probeEntries.forEach(([name], i) => {
      const result = probeResults[i];
      if (result !== undefined) {
        checks[name] = result;
      }
    });

    let aggregate: DeepHealthReport["status"];
    if (dbResult.status === "fail") {
      aggregate = "fail";
    } else if (Object.values(checks).some((c) => c.status === "fail")) {
      aggregate = "degraded";
    } else {
      aggregate = "ok";
    }

    return { status: aggregate, version: this.version, checks };
  }
}
