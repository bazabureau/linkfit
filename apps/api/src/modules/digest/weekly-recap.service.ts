/**
 * Weekly-recap service for the digest agent (Wave-10).
 *
 * Aggregates a user's trailing-7-days of padel activity into the shape
 * the recap card renders, then composes the Satori tree → PNG bytes.
 *
 * The service is intentionally split from the sweeper so the unit
 * tests can drive composition deterministically without touching the
 * scheduler. The sweeper supplies the recipient list + timing; this
 * file does the data shaping + the image bake.
 */

import { type Buffer } from "node:buffer";
import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { loadFont } from "../og-image/font.js";
import { type SatoriElement } from "../og-image/templates.js";
import {
  eloToLevelLabel,
  RECAP_CANVAS_PX,
  weeklyRecapCard,
  type WeeklyRecapData,
} from "./weekly-recap.template.js";

/**
 * Inline satori + resvg-js binding for the recap render. We can't reuse
 * `og-image/render.ts::renderToPng` directly because that helper hard-codes
 * the 1200×630 OG-image canvas; the recap is square (1080×1080). The shape
 * of this loader mirrors the og-image renderer one-for-one so when satori /
 * resvg-js are bumped the two render call sites stay in sync.
 */
type SatoriFn = (
  element: unknown,
  options: {
    width: number;
    height: number;
    fonts: { name: string; data: Buffer; weight?: number; style?: "normal" | "italic" }[];
    embedFont?: boolean;
  },
) => Promise<string>;
type ResvgClass = new (svg: string | Buffer, options?: unknown) => {
  render(): { asPng(): Buffer };
};
interface SatoriModule { default: SatoriFn }
interface ResvgModule { Resvg: ResvgClass }

let satoriPromise: Promise<SatoriFn> | null = null;
let resvgPromise: Promise<ResvgClass> | null = null;
async function getSatori(): Promise<SatoriFn> {
  satoriPromise ??= import("satori").then((m) => (m as unknown as SatoriModule).default);
  return satoriPromise;
}
async function getResvg(): Promise<ResvgClass> {
  resvgPromise ??= import("@resvg/resvg-js").then(
    (m) => (m as unknown as ResvgModule).Resvg,
  );
  return resvgPromise;
}

async function renderSquarePng(
  element: SatoriElement,
  sizePx: number,
): Promise<Buffer> {
  const [satori, Resvg, font] = await Promise.all([
    getSatori(),
    getResvg(),
    loadFont(),
  ]);
  const svg = await satori(element, {
    width: sizePx,
    height: sizePx,
    fonts: [
      { name: font.name, data: font.data, weight: 400, style: "normal" },
      { name: font.name, data: font.data, weight: 500, style: "normal" },
      { name: font.name, data: font.data, weight: 600, style: "normal" },
      { name: font.name, data: font.data, weight: 700, style: "normal" },
      { name: font.name, data: font.data, weight: 800, style: "normal" },
    ],
    embedFont: true,
  });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: sizePx },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: "Inter",
    },
  });
  return resvg.render().asPng();
}

export interface WeeklyRecapServiceDeps {
  db: DbHandle;
  /** Override the clock for tests. Defaults to `new Date()` per call. */
  now?: () => Date;
}

/** Recap aggregate + the source user's display name, ready for render. */
export interface WeeklyRecapAggregate extends WeeklyRecapData {
  /** Convenience for the sweeper: when zero, skip the user entirely. */
  totalActivity: number;
}

export class WeeklyRecapService {
  constructor(private readonly deps: WeeklyRecapServiceDeps) {}

  private clock(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /**
   * Roll up a single user's last-7-days padel activity into the
   * `WeeklyRecapData` shape the card consumes.
   *
   * Returns the rolled-up data + a `totalActivity` counter the
   * sweeper checks to skip "nothing happened this week" users
   * (sending an empty recap is worse than sending none — the
   * spec explicitly calls out the 0-games skip rule).
   */
  async aggregateForUser(userId: string): Promise<WeeklyRecapAggregate | null> {
    // Anchor the trailing 7-day window on the service's clock so the
    // sweeper can freeze "now" for tests. Each downstream query also
    // pins the same instant by accepting `windowStartIso` as a bind.
    const now = this.clock();
    const windowStartIso = new Date(
      now.getTime() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // 1) Identify the user's display name + the padel sport_id (the
    //    recap is currently padel-only — Linkfit's primary sport).
    const userRow = await sql<{
      display_name: string;
    }>`
      SELECT display_name FROM users
       WHERE id = ${userId}::uuid AND deleted_at IS NULL
    `.execute(this.deps.db.db);
    const user = userRow.rows[0];
    if (!user) return null;

    const padelRow = await sql<{ id: string }>`
      SELECT id FROM sports WHERE slug = 'padel' LIMIT 1
    `.execute(this.deps.db.db);
    const padelId = padelRow.rows[0]?.id ?? null;

    // 2) Games played + most-played-with partner. We treat a game as
    //    "played" when:
    //      - the game's `starts_at` is within the trailing 7 days,
    //      - the game.status is 'completed' OR the participant
    //        record reads 'played' (covers in-flight rating cases),
    //      - the user has a confirmed/played participation row.
    //
    //    Partner-of-the-week is the OTHER participant that co-occurs
    //    with the user the most across those games. Tie broken by
    //    most-recent game.
    const playedRows = await sql<{
      games_played: string;
    }>`
      SELECT COUNT(*)::text AS games_played
        FROM games g
        JOIN game_participants gp
          ON gp.game_id = g.id
         AND gp.user_id = ${userId}::uuid
         AND gp.status IN ('confirmed','played')
       WHERE g.starts_at >= ${windowStartIso}::timestamptz
         AND g.starts_at < ${now.toISOString()}::timestamptz
         AND (g.status = 'completed' OR gp.status = 'played')
         ${padelId !== null ? sql`AND g.sport_id = ${padelId}::uuid` : sql``}
    `.execute(this.deps.db.db);
    const gamesPlayed = Number.parseInt(playedRows.rows[0]?.games_played ?? "0", 10);

    // Wins: from `match_scores`. Map the user → team_a or team_b
    // (the column is a uuid[]), then derive winner from set counts.
    const winsRows = await sql<{ games_won: string }>`
      WITH played_games AS (
        SELECT g.id
          FROM games g
          JOIN game_participants gp
            ON gp.game_id = g.id
           AND gp.user_id = ${userId}::uuid
           AND gp.status IN ('confirmed','played')
         WHERE g.starts_at >= ${windowStartIso}::timestamptz
           AND g.starts_at < ${now.toISOString()}::timestamptz
           AND (g.status = 'completed' OR gp.status = 'played')
           ${padelId !== null ? sql`AND g.sport_id = ${padelId}::uuid` : sql``}
      ),
      wins AS (
        SELECT ms.game_id,
               CASE
                 WHEN ${userId}::uuid = ANY(ms.team_a_user_ids) THEN 'a'
                 WHEN ${userId}::uuid = ANY(ms.team_b_user_ids) THEN 'b'
                 ELSE NULL
               END AS user_team,
               (SELECT COUNT(*) FROM jsonb_array_elements(ms.sets) s
                 WHERE (s->>'a')::int > (s->>'b')::int)::int AS sets_a,
               (SELECT COUNT(*) FROM jsonb_array_elements(ms.sets) s
                 WHERE (s->>'b')::int > (s->>'a')::int)::int AS sets_b
          FROM match_scores ms
          JOIN played_games pg ON pg.id = ms.game_id
         WHERE ms.status = 'completed'
      )
      SELECT COUNT(*) FILTER (
        WHERE (user_team = 'a' AND sets_a > sets_b)
           OR (user_team = 'b' AND sets_b > sets_a)
      )::text AS games_won
        FROM wins
    `.execute(this.deps.db.db);
    const gamesWon = Number.parseInt(winsRows.rows[0]?.games_won ?? "0", 10);

    // 3) New followers in the window — same predicate the email
    //    digest uses; just an aggregate count here, not the list.
    const followerRows = await sql<{ count: string }>`
      SELECT COUNT(*)::text AS count
        FROM follows
       WHERE followed_user_id = ${userId}::uuid
         AND created_at >= ${windowStartIso}::timestamptz
         AND created_at < ${now.toISOString()}::timestamptz
    `.execute(this.deps.db.db);
    const newFollowers = Number.parseInt(followerRows.rows[0]?.count ?? "0", 10);

    // 4) Most-played-with partner. Joins game_participants twice on
    //    the same game id; bidirectional block filter drops anyone
    //    the user has blocked (or who blocks them) so the "partner
    //    of the week" never embarrassingly outs a person the user
    //    has since cut ties with.
    const partnerRows = await sql<{
      user_id: string;
      display_name: string;
      games_together: string;
    }>`
      SELECT u.id   AS user_id,
             u.display_name,
             COUNT(*)::text AS games_together
        FROM game_participants gp_me
        JOIN game_participants gp_other
          ON gp_other.game_id = gp_me.game_id
         AND gp_other.user_id <> gp_me.user_id
         AND gp_other.status IN ('confirmed','played')
        JOIN games g ON g.id = gp_me.game_id
        JOIN users u ON u.id = gp_other.user_id AND u.deleted_at IS NULL
       WHERE gp_me.user_id = ${userId}::uuid
         AND gp_me.status IN ('confirmed','played')
         AND g.starts_at >= ${windowStartIso}::timestamptz
         AND g.starts_at < ${now.toISOString()}::timestamptz
         AND (g.status = 'completed' OR gp_me.status = 'played')
         AND NOT EXISTS (
              SELECT 1 FROM user_blocks ub
               WHERE (ub.blocker_user_id = ${userId}::uuid AND ub.blocked_user_id = u.id)
                  OR (ub.blocker_user_id = u.id          AND ub.blocked_user_id = ${userId}::uuid)
         )
       GROUP BY u.id, u.display_name
       ORDER BY COUNT(*) DESC, MAX(g.starts_at) DESC
       LIMIT 1
    `.execute(this.deps.db.db);
    const partner = partnerRows.rows[0];
    const mostPlayedWith =
      partner === undefined
        ? null
        : {
            displayName: partner.display_name,
            gamesTogether: Number.parseInt(partner.games_together, 10),
          };

    // 5) Skill-level (ELO band) change vs. the start of the week.
    //    We approximate "ELO at the start of the window" by reversing
    //    the user's per-game elo_delta entries via `match_scores`. If
    //    that gives us no signal (no completed games in the window)
    //    we skip the badge entirely — the band is unchanged.
    const newLevelLabel = await this.computeLevelChange(
      userId,
      windowStartIso,
      now,
      padelId,
    );

    const totalActivity = gamesPlayed + newFollowers;
    return {
      displayName: user.display_name,
      gamesPlayed,
      gamesWon,
      newFollowers,
      mostPlayedWith,
      newLevelLabel,
      totalActivity,
    };
  }

  /**
   * Returns the AZ level label (e.g. "Təcrübəli") when the user's
   * ELO band shifted UP across the trailing 7 days, otherwise null.
   *
   * The recap is celebratory by design — a downward band shift is
   * unhelpful to surface here. iOS already shows the live band in
   * the profile screen; a "you dropped a tier" story would be
   * actively user-hostile.
   *
   * If we can't determine a starting ELO (no completed match in the
   * window, or no `elo_delta` recorded on `match_scores`) we return
   * null. The card simply renders without the badge.
   */
  private async computeLevelChange(
    userId: string,
    windowStartIso: string,
    now: Date,
    padelId: string | null,
  ): Promise<string | null> {
    if (padelId === null) return null;
    const statsRow = await sql<{ elo_rating: number }>`
      SELECT elo_rating FROM player_sport_stats
       WHERE user_id = ${userId}::uuid
         AND sport_id = ${padelId}::uuid
       LIMIT 1
    `.execute(this.deps.db.db);
    const currentElo = statsRow.rows[0]?.elo_rating ?? null;
    if (currentElo === null) return null;

    // Reverse-apply the user's elo deltas across the window to get
    // the starting ELO. `match_scores.elo_delta_by_user` is jsonb
    // keyed by participant uuid; the value is the signed integer
    // delta applied to that user post-match. Summing these across the
    // window gives the net 7-day movement.
    const deltaRows = await sql<{ delta: string | null }>`
      SELECT (ms.elo_delta_by_user ->> ${userId}::text) AS delta
        FROM match_scores ms
        JOIN games g ON g.id = ms.game_id
       WHERE g.starts_at >= ${windowStartIso}::timestamptz
         AND g.starts_at < ${now.toISOString()}::timestamptz
         AND ms.status = 'completed'
         AND ms.elo_delta_by_user ? ${userId}::text
    `.execute(this.deps.db.db);
    const totalDelta = deltaRows.rows.reduce((acc, r) => {
      const v = r.delta === null ? 0 : Number.parseInt(r.delta, 10);
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);
    if (totalDelta === 0) return null;
    const startElo = currentElo - totalDelta;
    const startLabel = eloToLevelLabel(startElo);
    const endLabel = eloToLevelLabel(currentElo);
    if (startLabel === endLabel) return null;
    // Only celebrate an UPWARD move. eloToLevelLabel orders bands by
    // ascending threshold; we compare numerically by the lower bound.
    if (currentElo <= startElo) return null;
    return endLabel;
  }

  /**
   * Compose the PNG bytes for a user's recap. Returns the raw buffer
   * — the caller is responsible for persisting it to the upload dir
   * and creating the matching `stories` row.
   */
  async renderPng(data: WeeklyRecapData): Promise<Buffer> {
    const tree = weeklyRecapCard(data);
    return renderSquarePng(tree, RECAP_CANVAS_PX);
  }
}
