// === Scoring agent — integration tests ===
//
// Hits the live Fastify surface. Cover the rule engine end-to-end and the
// permission boundary (host vs participant vs spectator). The rules engine
// also has direct unit assertions inside `applyPoint`-style helpers — keeps
// the cycle tight without standing up a DB.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll, type TestUser } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { applyPoint, initialScoreState, replayPoints } from "./scoring.rules.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

interface ScoreView {
  game_id: string;
  team_a_user_ids: string[];
  team_b_user_ids: string[];
  sets: { a: number; b: number; tb?: { a: number; b: number } }[];
  current_set: number;
  current_game_a: number;
  current_game_b: number;
  point_a: number;
  point_b: number;
  status: "in_progress" | "completed";
  started_at: string;
  completed_at: string | null;
  winning_team: "a" | "b" | null;
}

async function getPadelSportId(db: DbHandle): Promise<string> {
  const row = await sql<{ id: string }>`SELECT id FROM sports WHERE slug = 'padel'`.execute(db.db);
  return row.rows[0]!.id;
}

describe("scoring rules — pure", () => {
  it("0-0 → A scores once → A leads 15-0 (1-0 internal)", () => {
    const s = initialScoreState();
    applyPoint(s, "a");
    expect(s.point_a).toBe(1);
    expect(s.point_b).toBe(0);
  });

  it("deuce → advantage A → game A", () => {
    // Reach 3-3.
    const s = replayPoints(["a", "a", "a", "b", "b", "b"]);
    expect(s.point_a).toBe(3);
    expect(s.point_b).toBe(3);
    // Advantage A.
    applyPoint(s, "a");
    expect(s.point_a).toBe(4);
    expect(s.point_b).toBe(3);
    // Game A.
    applyPoint(s, "a");
    expect(s.point_a).toBe(0);
    expect(s.point_b).toBe(0);
    expect(s.current_game_a).toBe(1);
    expect(s.current_game_b).toBe(0);
  });

  it("deuce → advantage → back to deuce → game on the next two-point run", () => {
    const s = replayPoints(["a", "a", "a", "b", "b", "b"]); // 3-3
    applyPoint(s, "a"); // adv A
    applyPoint(s, "b"); // back to deuce
    expect(s.point_a).toBe(3);
    expect(s.point_b).toBe(3);
    applyPoint(s, "b"); // adv B
    applyPoint(s, "b"); // game B
    expect(s.current_game_b).toBe(1);
    expect(s.current_game_a).toBe(0);
  });

  it("6-0 sweep — set ends without tiebreak", () => {
    // 24 points from team A — 6 games of 4 straight points = 24 points.
    const points: ("a" | "b")[] = Array.from({ length: 24 }, () => "a");
    const s = replayPoints(points);
    expect(s.sets.length).toBe(1);
    expect(s.sets[0]).toEqual({ a: 6, b: 0 });
    expect(s.current_set).toBe(1);
  });

  it("tiebreak — set reaches 6-6 then resolves 7-6 by 2-point margin", () => {
    // 6 games each → 6-6.
    const swap: ("a" | "b")[] = [];
    for (let g = 0; g < 12; g += 1) {
      const t: "a" | "b" = g % 2 === 0 ? "a" : "b";
      for (let p = 0; p < 4; p += 1) swap.push(t);
    }
    const s = replayPoints(swap);
    expect(s.current_game_a).toBe(6);
    expect(s.current_game_b).toBe(6);
    // Tiebreak: A scores 7 in a row.
    for (let i = 0; i < 7; i += 1) applyPoint(s, "a");
    expect(s.sets.length).toBe(1);
    expect(s.sets[0]!.a).toBe(7);
    expect(s.sets[0]!.b).toBe(6);
    expect(s.sets[0]!.tb).toEqual({ a: 7, b: 0 });
  });

  it("2-set sweep — match completes after 2nd set", () => {
    // Run 2 full 6-0 sets back to back.
    const sweep = Array.from({ length: 48 }, () => "a" as const);
    const s = replayPoints(sweep);
    expect(s.status).toBe("completed");
    expect(s.winning_team).toBe("a");
    expect(s.sets.length).toBe(2);
  });

  it("ignores extra points after match completes (idempotent)", () => {
    const sweep = Array.from({ length: 48 }, () => "a" as const);
    const s = replayPoints(sweep);
    applyPoint(s, "b");
    applyPoint(s, "b");
    expect(s.status).toBe("completed");
    expect(s.sets.length).toBe(2);
  });
});

describe("scoring routes", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let padelId: string;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    padelId = await getPadelSportId(db);
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
    padelId = await getPadelSportId(db);
  });

  async function createGame(host: TestUser): Promise<{ id: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/games",
      headers: { authorization: `Bearer ${host.access_token}` },
      payload: {
        sport_id: padelId,
        lat: 40.4093,
        lng: 49.8671,
        starts_at: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
        duration_minutes: 90,
        capacity: 4,
      },
    });
    if (res.statusCode !== 201) {
      throw new Error(`createGame: ${String(res.statusCode)} ${res.body}`);
    }
    return res.json<{ id: string }>();
  }

  async function joinGame(gameId: string, user: TestUser): Promise<void> {
    const r = await app.inject({
      method: "POST",
      url: `/api/v1/games/${gameId}/join`,
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(r.statusCode).toBe(200);
  }

  async function fourPlayerGame(): Promise<{
    gameId: string;
    host: TestUser;
    p2: TestUser;
    p3: TestUser;
    p4: TestUser;
    spectator: TestUser;
  }> {
    const host = await createTestUser(app);
    const p2 = await createTestUser(app);
    const p3 = await createTestUser(app);
    const p4 = await createTestUser(app);
    const spectator = await createTestUser(app);
    const game = await createGame(host);
    await joinGame(game.id, p2);
    await joinGame(game.id, p3);
    await joinGame(game.id, p4);
    return { gameId: game.id, host, p2, p3, p4, spectator };
  }

  async function start(gameId: string, user: TestUser, teamA: string[], teamB: string[]): Promise<{ status: number; body: ScoreView | null; raw: string }> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/games/${gameId}/scoring/start`,
      headers: { authorization: `Bearer ${user.access_token}` },
      payload: { team_a_user_ids: teamA, team_b_user_ids: teamB },
    });
    return {
      status: res.statusCode,
      body: res.statusCode === 201 ? res.json<ScoreView>() : null,
      raw: res.body,
    };
  }

  async function point(gameId: string, user: TestUser, team: "a" | "b"): Promise<ScoreView> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/games/${gameId}/scoring/point`,
      headers: { authorization: `Bearer ${user.access_token}` },
      payload: { team },
    });
    if (res.statusCode !== 200) {
      throw new Error(`point: ${String(res.statusCode)} ${res.body}`);
    }
    return res.json<ScoreView>();
  }

  it("host starts scoring; spectators get 403; teams populate row", async () => {
    const ctx = await fourPlayerGame();
    const ok = await start(ctx.gameId, ctx.host, [ctx.host.id, ctx.p2.id], [ctx.p3.id, ctx.p4.id]);
    expect(ok.status).toBe(201);
    expect(ok.body!.team_a_user_ids).toEqual([ctx.host.id, ctx.p2.id]);
    expect(ok.body!.team_b_user_ids).toEqual([ctx.p3.id, ctx.p4.id]);
    expect(ok.body!.status).toBe("in_progress");

    // Re-start = conflict.
    const dup = await start(ctx.gameId, ctx.host, [ctx.host.id, ctx.p2.id], [ctx.p3.id, ctx.p4.id]);
    expect(dup.status).toBe(409);
  });

  it("only the host can start scoring", async () => {
    const ctx = await fourPlayerGame();
    const res = await start(ctx.gameId, ctx.p2, [ctx.host.id, ctx.p2.id], [ctx.p3.id, ctx.p4.id]);
    expect(res.status).toBe(403);
  });

  it("rejects start when a team member isn't a confirmed participant", async () => {
    const ctx = await fourPlayerGame();
    // spectator is not in the game
    const res = await start(ctx.gameId, ctx.host, [ctx.host.id, ctx.spectator.id], [ctx.p3.id, ctx.p4.id]);
    expect(res.status).toBe(400);
  });

  it("rejects start when teams share a player", async () => {
    const ctx = await fourPlayerGame();
    const res = await start(ctx.gameId, ctx.host, [ctx.host.id, ctx.p2.id], [ctx.host.id, ctx.p3.id]);
    expect(res.status).toBe(400);
  });

  it("deuce → advantage → game ladder via HTTP", async () => {
    const ctx = await fourPlayerGame();
    await start(ctx.gameId, ctx.host, [ctx.host.id, ctx.p2.id], [ctx.p3.id, ctx.p4.id]);
    // 3-3 (deuce)
    await point(ctx.gameId, ctx.host, "a");
    await point(ctx.gameId, ctx.host, "a");
    await point(ctx.gameId, ctx.host, "a");
    await point(ctx.gameId, ctx.host, "b");
    await point(ctx.gameId, ctx.host, "b");
    let view = await point(ctx.gameId, ctx.host, "b");
    expect(view.point_a).toBe(3);
    expect(view.point_b).toBe(3);
    view = await point(ctx.gameId, ctx.host, "a");
    expect(view.point_a).toBe(4); // advantage A
    view = await point(ctx.gameId, ctx.host, "a");
    expect(view.current_game_a).toBe(1);
    expect(view.point_a).toBe(0);
  });

  it("tiebreak — set ends 7-6 with tb metadata", async () => {
    const ctx = await fourPlayerGame();
    await start(ctx.gameId, ctx.host, [ctx.host.id, ctx.p2.id], [ctx.p3.id, ctx.p4.id]);
    // 6-6 — alternate game winners.
    for (let g = 0; g < 12; g += 1) {
      const t: "a" | "b" = g % 2 === 0 ? "a" : "b";
      for (let p = 0; p < 4; p += 1) await point(ctx.gameId, ctx.host, t);
    }
    // Tiebreak — A wins 7-0.
    let view: ScoreView | null = null;
    for (let i = 0; i < 7; i += 1) view = await point(ctx.gameId, ctx.host, "a");
    expect(view!.sets.length).toBe(1);
    expect(view!.sets[0]!.a).toBe(7);
    expect(view!.sets[0]!.b).toBe(6);
    expect(view!.sets[0]!.tb).toEqual({ a: 7, b: 0 });
  });

  it("undo backtracks across a set transition", async () => {
    const ctx = await fourPlayerGame();
    await start(ctx.gameId, ctx.host, [ctx.host.id, ctx.p2.id], [ctx.p3.id, ctx.p4.id]);
    // 5 games for A, 0 for B (20 points).
    for (let i = 0; i < 20; i += 1) await point(ctx.gameId, ctx.host, "a");
    // 4 more A points → game 6 → set won. (24 total.)
    for (let i = 0; i < 4; i += 1) await point(ctx.gameId, ctx.host, "a");
    let view = await app.inject({
      method: "GET",
      url: `/api/v1/games/${ctx.gameId}/scoring`,
    }).then((r) => r.json<ScoreView>());
    expect(view.sets.length).toBe(1);
    expect(view.current_set).toBe(1);
    // Undo the very last point — should rewind into the set (5 games + 40 to A).
    const undo = await app.inject({
      method: "POST",
      url: `/api/v1/games/${ctx.gameId}/scoring/undo`,
      headers: { authorization: `Bearer ${ctx.host.access_token}` },
    });
    expect(undo.statusCode).toBe(200);
    view = undo.json<ScoreView>();
    expect(view.sets.length).toBe(0); // set un-committed
    expect(view.current_set).toBe(0);
    expect(view.current_game_a).toBe(5);
    expect(view.point_a).toBe(3); // 40
    expect(view.point_b).toBe(0);
  });

  it("2-set sweep flips game.status to completed", async () => {
    const ctx = await fourPlayerGame();
    await start(ctx.gameId, ctx.host, [ctx.host.id, ctx.p2.id], [ctx.p3.id, ctx.p4.id]);
    // 48 points = 2 sets of 6-0.
    let final: ScoreView | null = null;
    for (let i = 0; i < 48; i += 1) final = await point(ctx.gameId, ctx.host, "a");
    expect(final!.status).toBe("completed");
    expect(final!.winning_team).toBe("a");

    const gameStatus = await sql<{ status: string }>`
      SELECT status FROM games WHERE id = ${ctx.gameId}
    `.execute(db.db);
    expect(gameStatus.rows[0]!.status).toBe("completed");
  });

  it("any confirmed participant — not just the host — can record points", async () => {
    const ctx = await fourPlayerGame();
    await start(ctx.gameId, ctx.host, [ctx.host.id, ctx.p2.id], [ctx.p3.id, ctx.p4.id]);
    // p4 is on team B but still allowed to record.
    const view = await point(ctx.gameId, ctx.p4, "a");
    expect(view.point_a).toBe(1);
  });

  it("spectators get 403 on point/undo/complete", async () => {
    const ctx = await fourPlayerGame();
    await start(ctx.gameId, ctx.host, [ctx.host.id, ctx.p2.id], [ctx.p3.id, ctx.p4.id]);
    const pt = await app.inject({
      method: "POST",
      url: `/api/v1/games/${ctx.gameId}/scoring/point`,
      headers: { authorization: `Bearer ${ctx.spectator.access_token}` },
      payload: { team: "a" },
    });
    expect(pt.statusCode).toBe(403);
    const undo = await app.inject({
      method: "POST",
      url: `/api/v1/games/${ctx.gameId}/scoring/undo`,
      headers: { authorization: `Bearer ${ctx.spectator.access_token}` },
    });
    expect(undo.statusCode).toBe(403);
    const fin = await app.inject({
      method: "POST",
      url: `/api/v1/games/${ctx.gameId}/scoring/complete`,
      headers: { authorization: `Bearer ${ctx.spectator.access_token}` },
    });
    expect(fin.statusCode).toBe(403);
  });

  it("GET is public — no auth required", async () => {
    const ctx = await fourPlayerGame();
    await start(ctx.gameId, ctx.host, [ctx.host.id, ctx.p2.id], [ctx.p3.id, ctx.p4.id]);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/games/${ctx.gameId}/scoring`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ScoreView>().status).toBe("in_progress");
  });

  it("GET 404 when scoring hasn't been started yet", async () => {
    const ctx = await fourPlayerGame();
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/games/${ctx.gameId}/scoring`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("manual /complete is idempotent and flips game status", async () => {
    const ctx = await fourPlayerGame();
    await start(ctx.gameId, ctx.host, [ctx.host.id, ctx.p2.id], [ctx.p3.id, ctx.p4.id]);
    await point(ctx.gameId, ctx.host, "a");
    const r1 = await app.inject({
      method: "POST",
      url: `/api/v1/games/${ctx.gameId}/scoring/complete`,
      headers: { authorization: `Bearer ${ctx.host.access_token}` },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json<ScoreView>().status).toBe("completed");
    const r2 = await app.inject({
      method: "POST",
      url: `/api/v1/games/${ctx.gameId}/scoring/complete`,
      headers: { authorization: `Bearer ${ctx.host.access_token}` },
    });
    expect(r2.statusCode).toBe(200); // idempotent
    const gs = await sql<{ status: string }>`SELECT status FROM games WHERE id = ${ctx.gameId}`.execute(db.db);
    expect(gs.rows[0]!.status).toBe("completed");
  });
});
