import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";

export type DbStatus = "ok" | "down";

export interface HealthReport {
  status: "ok" | "degraded";
  uptime_seconds: number;
  version: string;
  db: DbStatus;
}

export class HealthService {
  constructor(
    private readonly db: DbHandle,
    private readonly version: string,
    private readonly startedAt = Date.now(),
  ) {}

  async report(): Promise<HealthReport> {
    const dbStatus = await this.pingDb();
    return {
      status: dbStatus === "ok" ? "ok" : "degraded",
      uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1000),
      version: this.version,
      db: dbStatus,
    };
  }

  private async pingDb(): Promise<DbStatus> {
    try {
      await sql`SELECT 1`.execute(this.db.db);
      return "ok";
    } catch {
      return "down";
    }
  }
}
