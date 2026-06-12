import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { WeeklyRecapService } from "./weekly-recap.service.js";
import {
  eloToLevelLabel,
  Labels,
  weeklyRecapCard,
  type WeeklyRecapData,
} from "./weekly-recap.template.js";

/**
 * Snapshot test for the Wave-10 weekly-recap composition.
 *
 * Two scopes:
 *  1) Pure template — `weeklyRecapCard()` is exercised against a fixed
 *     sample to assert the Satori tree carries the expected AZ strings
 *     and stat values. The snapshot is a JSON-stable subset (no PNG
 *     binary), so a copy or layout tweak surfaces as a focused diff.
 *  2) DB aggregation — `WeeklyRecapService.aggregateForUser()` is run
 *     against a hand-built fixture (games + match_scores + follows)
 *     and the returned aggregate is asserted to match the inputs.
 */
describe("weekly-recap composition", () => {
  describe("template — pure", () => {
    it("composes the AZ card with the expected headline and stat labels", () => {
      const data: WeeklyRecapData = {
        displayName: "Aydan H.",
        gamesPlayed: 5,
        gamesWon: 3,
        newFollowers: 2,
        mostPlayedWith: { displayName: "Vusal Q.", gamesTogether: 4 },
        newLevelLabel: "Təcrübəli",
      };
      const tree = weeklyRecapCard(data);
      const flat = flattenStrings(tree);
      // Brand markers.
      expect(flat).toContain(Labels.brand);
      expect(flat).toContain(Labels.headline);
      expect(flat).toContain(Labels.weekShort);
      // Display name.
      expect(flat).toContain("Aydan H.");
      // Four stat cells.
      expect(flat).toContain("5");
      expect(flat).toContain("3");
      expect(flat).toContain("2");
      // Win rate (3/5 = 60%).
      expect(flat).toContain("60%");
      expect(flat).toContain(Labels.gamesPlayed);
      expect(flat).toContain(Labels.gamesWon);
      expect(flat).toContain(Labels.newFollowers);
      expect(flat).toContain(Labels.winRate);
      // Level-up badge.
      expect(flat).toContain(Labels.newLevel);
      expect(flat).toContain("Təcrübəli");
      // Partner footer.
      expect(flat).toContain(Labels.partnerOfWeek);
      expect(flat).toContain("Vusal Q.");
    });

    it("omits the level badge and partner footer when their data is null", () => {
      const data: WeeklyRecapData = {
        displayName: "Lone Wolf",
        gamesPlayed: 1,
        gamesWon: 0,
        newFollowers: 0,
        mostPlayedWith: null,
        newLevelLabel: null,
      };
      const tree = weeklyRecapCard(data);
      const flat = flattenStrings(tree);
      // Stats still render.
      expect(flat).toContain("1");
      expect(flat).toContain("0%"); // 0 wins out of 1 game.
      // Optional sections are gone.
      expect(flat).not.toContain(Labels.newLevel);
      expect(flat).not.toContain(Labels.partnerOfWeek);
    });

    it("maps ELO bands to the AZ level labels expected on the badge", () => {
      expect(eloToLevelLabel(900)).toBe("Yeni oyunçu");
      expect(eloToLevelLabel(1100)).toBe("Başlanğıc");
      expect(eloToLevelLabel(1300)).toBe("İnkişafda");
      expect(eloToLevelLabel(1500)).toBe("Təcrübəli");
      expect(eloToLevelLabel(1800)).toBe("Usta");
    });
  });

  describe("aggregate — DB-backed", () => {
    const env = buildTestEnv();
    let app: LinkfitServer;
    let db: DbHandle;
    let service: WeeklyRecapService;

    beforeAll(async () => {
      db = buildTestDb();
      app = await buildServer({
        env,
        logger: pino({ level: "silent" }),
        db,
      });
      await app.ready();
      service = new WeeklyRecapService({ db });
    });
    afterAll(async () => {
      await app.close();
      await db.close();
    });
    beforeEach(async () => {
      await truncateAll(db);
    });

    it("rolls a user's week into the expected stat shape", async () => {
      const me = await createTestUser(app, { display_name: "Recap Subject" });
      const partner = await createTestUser(app, { display_name: "Co Player" });
      const newFollower = await createTestUser(app, { display_name: "Fan One" });
      const olderFollower = await createTestUser(app, { display_name: "Old Friend" });

      const padel = await sql<{ id: string }>`
        SELECT id FROM sports WHERE slug = 'padel'
      `.execute(db.db);
      const padelId = padel.rows[0]!.id;

      // Two completed games for `me` in the past week, with `partner` as
      // the co-participant on both. One played outside the window so it
      // must NOT be counted.
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      const gameIds: string[] = [];
      for (const startsAt of [dayAgo, twoDaysAgo, tenDaysAgo]) {
        const g = await sql<{ id: string }>`
          INSERT INTO games (
            sport_id, host_user_id, lat, lng, starts_at,
            duration_minutes, capacity, status
          ) VALUES (
            ${padelId}::uuid,
            ${me.id}::uuid,
            40.4093, 49.8671,
            ${startsAt.toISOString()}::timestamptz,
            90, 4, 'completed'::game_status
          ) RETURNING id
        `.execute(db.db);
        const gameId = g.rows[0]!.id;
        gameIds.push(gameId);
        // me + partner are confirmed participants on every game.
        await sql`
          INSERT INTO game_participants (game_id, user_id, status)
          VALUES
            (${gameId}::uuid, ${me.id}::uuid,      'played'::participant_status),
            (${gameId}::uuid, ${partner.id}::uuid, 'played'::participant_status)
        `.execute(db.db);
      }

      // match_scores rows for the two in-window games. `me` wins the
      // first (2 sets to 0), loses the second (1-2).
      const inWindowWin = gameIds[0]!;
      const inWindowLoss = gameIds[1]!;
      await sql`
        INSERT INTO match_scores (
          game_id, team_a_user_ids, team_b_user_ids,
          sets, status, completed_at
        ) VALUES (
          ${inWindowWin}::uuid,
          ARRAY[${me.id}::uuid],
          ARRAY[${partner.id}::uuid],
          '[{"a":6,"b":3},{"a":6,"b":4}]'::jsonb,
          'completed'::match_score_status,
          NOW()
        ), (
          ${inWindowLoss}::uuid,
          ARRAY[${me.id}::uuid],
          ARRAY[${partner.id}::uuid],
          '[{"a":4,"b":6},{"a":6,"b":4},{"a":3,"b":6}]'::jsonb,
          'completed'::match_score_status,
          NOW()
        )
      `.execute(db.db);

      // Two follows — one inside the window, one ancient.
      await sql`
        INSERT INTO follows (follower_user_id, followed_user_id, created_at)
        VALUES
          (${newFollower.id}::uuid,   ${me.id}::uuid, NOW() - interval '2 days'),
          (${olderFollower.id}::uuid, ${me.id}::uuid, NOW() - interval '30 days')
      `.execute(db.db);

      const agg = await service.aggregateForUser(me.id);
      expect(agg).not.toBeNull();
      if (!agg) return;

      expect(agg.displayName).toBe("Recap Subject");
      expect(agg.gamesPlayed).toBe(2);
      expect(agg.gamesWon).toBe(1);
      expect(agg.newFollowers).toBe(1);
      expect(agg.mostPlayedWith).not.toBeNull();
      expect(agg.mostPlayedWith?.displayName).toBe("Co Player");
      expect(agg.mostPlayedWith?.gamesTogether).toBe(2);
      // No elo_delta_by_user rows, so the level change is null.
      expect(agg.newLevelLabel).toBeNull();
      expect(agg.totalActivity).toBe(3);
    });

    it("returns totalActivity = 0 for users with no activity, so the sweeper can skip", async () => {
      const me = await createTestUser(app, { display_name: "Quiet" });
      const agg = await service.aggregateForUser(me.id);
      expect(agg).not.toBeNull();
      if (!agg) return;
      expect(agg.gamesPlayed).toBe(0);
      expect(agg.gamesWon).toBe(0);
      expect(agg.newFollowers).toBe(0);
      expect(agg.totalActivity).toBe(0);
      expect(agg.mostPlayedWith).toBeNull();
    });
  });
});

/**
 * Recursively collect every string node out of a Satori element tree.
 *
 * Satori's element shape is `{ type, props: { children } }` with `children`
 * either a string, a single element, or an array. We walk the tree and
 * return all the leaf strings — used by the snapshot assertions to scan
 * for the AZ labels and the rendered stat values without coupling to the
 * exact element layout.
 */
function flattenStrings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) {
    return node.flatMap((n) => flattenStrings(n));
  }
  if (
    typeof node === "object" &&
    node !== null &&
    "props" in node &&
    typeof (node as { props?: unknown }).props === "object" &&
    (node as { props?: unknown }).props !== null
  ) {
    const props = (node as { props: { children?: unknown } }).props;
    return flattenStrings(props.children);
  }
  return [];
}
