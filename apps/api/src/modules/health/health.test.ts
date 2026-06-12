import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pino from "pino";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { createDb } from "../../shared/db/pool.js";

const env = buildTestEnv();

describe("GET /health", () => {
  let app: LinkfitServer;
  let db: DbHandle;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  interface HealthBody {
    status: string;
    db: string;
    uptime_seconds: number;
    version: string;
  }
  interface ErrorBody {
    error: { code: string; message: string; request_id: string };
  }

  it("returns 200 with status ok when DB is reachable", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json<HealthBody>();
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(body.version).toBe("0.1.0");
  });

  it("returns 503 with db=down when DB is unreachable", async () => {
    const badDb = createDb({
      databaseUrl: "postgres://nobody:nopass@127.0.0.1:1/none",
      logger: pino({ level: "silent" }),
    });
    const broken = await buildServer({ env, logger: pino({ level: "silent" }), db: badDb });

    const res = await broken.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    const body = res.json<HealthBody>();
    expect(body.db).toBe("down");
    expect(body.status).toBe("degraded");

    await broken.close();
    await badDb.close();
  });

  it("returns a structured 404 envelope for unknown routes", async () => {
    const res = await app.inject({ method: "GET", url: "/no-such-route" });
    expect(res.statusCode).toBe(404);
    const body = res.json<ErrorBody>();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("not found");
    expect(body.error.request_id).toMatch(/[0-9a-f-]{36}/);
  });

  it("is not rate-limited — observability endpoints stay reachable under load", async () => {
    // Hammer the endpoint with more requests than the default RATE_LIMIT_MAX
    // would allow on a regular route. The /health route opts out via
    // `config: { rateLimit: false }` so every response must still be 200.
    const responses = await Promise.all(
      Array.from({ length: 50 }, () => app.inject({ method: "GET", url: "/health" })),
    );
    for (const res of responses) {
      expect(res.statusCode).toBe(200);
    }
  });

  it("HEAD /health behaves like GET (no body, same status)", async () => {
    // Many monitoring systems use HEAD for cheap liveness pings — Fastify
    // wires HEAD to GET handlers by default, but we pin the contract.
    const res = await app.inject({ method: "HEAD", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("response contains the expected fields and types", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    const body = res.json<HealthBody>();
    expect(typeof body.status).toBe("string");
    expect(typeof body.db).toBe("string");
    expect(typeof body.version).toBe("string");
    expect(Number.isFinite(body.uptime_seconds)).toBe(true);
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
    // Strictly one of the schema-permitted enums.
    expect(["ok", "degraded"]).toContain(body.status);
    expect(["ok", "down"]).toContain(body.db);
  });
});
