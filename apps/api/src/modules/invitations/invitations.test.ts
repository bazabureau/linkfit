import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import {
  createTestUser,
  truncateAll,
  type TestUser,
} from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { InvitationsService } from "./invitations.service.js";
import { GamesService } from "../games/games.service.js";
import { NotificationsService } from "../social/notifications.service.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

interface GameBody {
  id: string;
  capacity: number;
  starts_at: string;
}

interface InvitationBody {
  id: string;
  game_id: string;
  inviter_user_id: string;
  invitee_user_id: string;
  status: "pending" | "accepted" | "declined" | "expired";
  responded_at: string | null;
  game: { id: string; capacity: number };
}

async function getPadelSportId(db: DbHandle): Promise<string> {
  const row = await sql<{ id: string }>`SELECT id FROM sports WHERE slug = 'padel'`.execute(
    db.db,
  );
  return row.rows[0]!.id;
}

describe("invitations routes", () => {
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

  async function createGame(
    host: TestUser,
    overrides: Record<string, unknown> = {},
  ): Promise<GameBody> {
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
        ...overrides,
      },
    });
    if (res.statusCode !== 201) {
      throw new Error(`createGame failed: ${String(res.statusCode)} ${res.body}`);
    }
    return res.json<GameBody>();
  }

  async function invite(
    host: TestUser,
    gameId: string,
    inviteeUserId: string,
  ): Promise<{ statusCode: number; body: InvitationBody | { error: { code: string } } }> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/games/${gameId}/invitations`,
      headers: { authorization: `Bearer ${host.access_token}` },
      payload: { invitee_user_id: inviteeUserId },
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  // ───────────────────── POST /games/:id/invitations ─────────────────────

  describe("POST /api/v1/games/:id/invitations", () => {
    it("creates a pending invitation when host invites a player", async () => {
      const host = await createTestUser(app);
      const player = await createTestUser(app);
      const game = await createGame(host);

      const out = await invite(host, game.id, player.id);
      expect(out.statusCode).toBe(201);
      const inv = out.body as InvitationBody;
      expect(inv.status).toBe("pending");
      expect(inv.game_id).toBe(game.id);
      expect(inv.invitee_user_id).toBe(player.id);
      expect(inv.inviter_user_id).toBe(host.id);
      expect(inv.game.id).toBe(game.id);
    });

    it("creates a notification for the invitee", async () => {
      const host = await createTestUser(app);
      const player = await createTestUser(app);
      const game = await createGame(host);
      await invite(host, game.id, player.id);

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/notifications",
        headers: { authorization: `Bearer ${player.access_token}` },
      });
      expect(list.statusCode).toBe(200);
      const body = list.json<{
        items: { type: string; payload?: Record<string, unknown> }[];
        unread_count: number;
      }>();
      expect(body.unread_count).toBeGreaterThanOrEqual(1);
      expect(body.items.some((n) => n.type === "tournament_invite")).toBe(true);
    });

    it("rejects with 403 when a non-host tries to invite", async () => {
      const host = await createTestUser(app);
      const stranger = await createTestUser(app);
      const player = await createTestUser(app);
      const game = await createGame(host);

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/games/${game.id}/invitations`,
        headers: { authorization: `Bearer ${stranger.access_token}` },
        payload: { invitee_user_id: player.id },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 409 when re-inviting the same player while pending", async () => {
      const host = await createTestUser(app);
      const player = await createTestUser(app);
      const game = await createGame(host);

      const first = await invite(host, game.id, player.id);
      expect(first.statusCode).toBe(201);
      const second = await invite(host, game.id, player.id);
      expect(second.statusCode).toBe(409);
    });

    it("returns 409 when inviting a player who already joined the game", async () => {
      const host = await createTestUser(app);
      const player = await createTestUser(app);
      const game = await createGame(host);

      const join = await app.inject({
        method: "POST",
        url: `/api/v1/games/${game.id}/join`,
        headers: { authorization: `Bearer ${player.access_token}` },
      });
      expect(join.statusCode).toBe(200);

      const res = await invite(host, game.id, player.id);
      expect(res.statusCode).toBe(409);
    });

    it("rejects self-invite with 400", async () => {
      const host = await createTestUser(app);
      const game = await createGame(host);
      const res = await invite(host, game.id, host.id);
      expect(res.statusCode).toBe(400);
    });
  });

  // ───────────────────── GET /me/invitations ─────────────────────

  describe("GET /api/v1/me/invitations", () => {
    it("lists pending invites for the invitee with embedded game preview", async () => {
      const host = await createTestUser(app);
      const player = await createTestUser(app);
      const game = await createGame(host);
      await invite(host, game.id, player.id);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me/invitations?status=pending",
        headers: { authorization: `Bearer ${player.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: InvitationBody[] }>();
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.status).toBe("pending");
      expect(body.items[0]!.game.id).toBe(game.id);
    });

    it("hides invites for other users", async () => {
      const host = await createTestUser(app);
      const player = await createTestUser(app);
      const other = await createTestUser(app);
      const game = await createGame(host);
      await invite(host, game.id, player.id);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me/invitations",
        headers: { authorization: `Bearer ${other.access_token}` },
      });
      const body = res.json<{ items: unknown[] }>();
      expect(body.items).toHaveLength(0);
    });
  });

  // ───────────────────── accept / decline ─────────────────────

  describe("POST /api/v1/invitations/:id/accept", () => {
    it("joins the game and flips the invite to accepted", async () => {
      const host = await createTestUser(app);
      const player = await createTestUser(app);
      const game = await createGame(host);
      const inv = (await invite(host, game.id, player.id)).body as InvitationBody;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/invitations/${inv.id}/accept`,
        headers: { authorization: `Bearer ${player.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ invitation: InvitationBody; game_id: string }>();
      expect(body.invitation.status).toBe("accepted");
      expect(body.game_id).toBe(game.id);

      // Verify player is now in the game.
      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/games/${game.id}`,
      });
      const detailBody = detail.json<{ participants: { user_id: string }[] }>();
      expect(detailBody.participants.some((p) => p.user_id === player.id)).toBe(true);
    });

    it("returns 409 when accepting an invite to a full game", async () => {
      // 2-player game, host occupies seat 1. Send invite, then a second
      // (uninvited) player fills the last seat. Accept must fail.
      const host = await createTestUser(app);
      const invitee = await createTestUser(app);
      const filler = await createTestUser(app);
      const game = await createGame(host, { capacity: 2 });
      const inv = (await invite(host, game.id, invitee.id)).body as InvitationBody;

      const joinFiller = await app.inject({
        method: "POST",
        url: `/api/v1/games/${game.id}/join`,
        headers: { authorization: `Bearer ${filler.access_token}` },
      });
      expect(joinFiller.statusCode).toBe(200);

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/invitations/${inv.id}/accept`,
        headers: { authorization: `Bearer ${invitee.access_token}` },
      });
      expect(res.statusCode).toBe(409);
    });

    it("rejects accept by someone other than the invitee with 403", async () => {
      const host = await createTestUser(app);
      const invitee = await createTestUser(app);
      const stranger = await createTestUser(app);
      const game = await createGame(host);
      const inv = (await invite(host, game.id, invitee.id)).body as InvitationBody;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/invitations/${inv.id}/accept`,
        headers: { authorization: `Bearer ${stranger.access_token}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /api/v1/invitations/:id/decline", () => {
    it("flips the invite to declined", async () => {
      const host = await createTestUser(app);
      const player = await createTestUser(app);
      const game = await createGame(host);
      const inv = (await invite(host, game.id, player.id)).body as InvitationBody;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/invitations/${inv.id}/decline`,
        headers: { authorization: `Bearer ${player.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ invitation: InvitationBody }>();
      expect(body.invitation.status).toBe("declined");
      expect(body.invitation.responded_at).not.toBeNull();
    });

    it("allows re-inviting after decline (pending UNIQUE only blocks while pending)", async () => {
      const host = await createTestUser(app);
      const player = await createTestUser(app);
      const game = await createGame(host);
      const first = (await invite(host, game.id, player.id)).body as InvitationBody;

      const decline = await app.inject({
        method: "POST",
        url: `/api/v1/invitations/${first.id}/decline`,
        headers: { authorization: `Bearer ${player.access_token}` },
      });
      expect(decline.statusCode).toBe(200);

      const second = await invite(host, game.id, player.id);
      expect(second.statusCode).toBe(201);
    });
  });

  // ───────────────────── expire cron stub ─────────────────────

  describe("InvitationsService.expireStalePending()", () => {
    it("expires pending invites whose game has already started", async () => {
      const host = await createTestUser(app);
      const player = await createTestUser(app);
      const game = await createGame(host);
      const inv = (await invite(host, game.id, player.id)).body as InvitationBody;

      // Hard-shift the game's starts_at into the past — bypasses validation.
      await sql`
        UPDATE games SET starts_at = now() - interval '1 hour' WHERE id = ${game.id}
      `.execute(db.db);

      const service = new InvitationsService({
        db,
        games: new GamesService({ db }),
        notifications: new NotificationsService({ db }),
      });
      const expired = await service.expireStalePending();
      expect(expired).toBe(1);

      const row = await sql<{ status: string }>`
        SELECT status FROM game_invitations WHERE id = ${inv.id}
      `.execute(db.db);
      expect(row.rows[0]!.status).toBe("expired");
    });
  });
});
