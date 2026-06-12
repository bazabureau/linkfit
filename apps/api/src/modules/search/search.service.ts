import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  type SearchGameResult,
  type SearchPlayerResult,
  type SearchQuery,
  type SearchResponse,
  type SearchTournamentResult,
  type SearchType,
  type SearchVenueResult,
} from "./search.schema.js";
import { skillLevelFromElo } from "../../shared/skill/skillLevel.js";

export interface SearchServiceDeps {
  db: DbHandle;
}

/**
 * Escape user input before embedding it inside an ILIKE pattern.
 * Without this a single `%` or `_` would let any query degenerate into a
 * full table scan ("match anything"), and a backslash would crash the
 * pattern parser. We follow the same convention Postgres recommends for
 * literal LIKE matching.
 */
function escapeLike(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export class SearchService {
  constructor(private readonly deps: SearchServiceDeps) {}

  /**
   * Run a unified search across players, games, tournaments and venues.
   *
   * `viewerUserId` (when present) is the signed-in caller's id and is used
   * exclusively to drop blocked users from the `players` results — the
   * filter is bidirectional, so both directions of `user_blocks` hide the
   * profile. Anonymous callers (null viewer) see everyone.
   */
  async search(query: SearchQuery, viewerUserId: string | null = null): Promise<SearchResponse> {
    const limit = query.limit ?? 10;
    const type: SearchType = query.type ?? "all";
    const rawQ = query.q;
    const pattern = `%${escapeLike(rawQ)}%`;

    // Run the four searchers in parallel — they're independent reads.
    // `rawQ` is passed alongside the LIKE pattern so each searcher can use
    // `position(lower(rawQ) IN lower(col))` for prefix-aware relevance
    // ranking. The escaped `pattern` is still what filters rows; `rawQ`
    // only influences ORDER BY, so it is safe (and necessary) to send the
    // unescaped form for the position lookup.
    const [players, games, tournaments, venues] = await Promise.all([
      type === "all" || type === "players"
        ? this.searchPlayers(pattern, rawQ, limit, viewerUserId)
        : Promise.resolve([] as SearchPlayerResult[]),
      type === "all" || type === "games"
        ? this.searchGames(pattern, rawQ, limit)
        : Promise.resolve([] as SearchGameResult[]),
      type === "all" || type === "tournaments"
        ? this.searchTournaments(pattern, rawQ, limit)
        : Promise.resolve([] as SearchTournamentResult[]),
      type === "all" || type === "venues"
        ? this.searchVenues(pattern, rawQ, limit)
        : Promise.resolve([] as SearchVenueResult[]),
    ]);

    return { query: query.q, players, games, tournaments, venues };
  }

  // ─── Per-type searchers ────────────────────────────────────────────

  /**
   * Player search by display name. When `viewerUserId` is supplied we
   * additionally drop:
   *   - the viewer themselves (you can't usefully "find yourself"),
   *   - any user in a mutual `user_blocks` relationship with the viewer
   *     (either direction — a blocker is hidden to the blocked and vice
   *     versa, matching the feed's filter semantics).
   */
  private async searchPlayers(
    pattern: string,
    rawQ: string,
    limit: number,
    viewerUserId: string | null,
  ): Promise<SearchPlayerResult[]> {
    // Relevance ranking:
    //   1. `position(lower(q) IN lower(display_name))` puts prefix matches
    //      first ("Kamr" → "Kamran" (position 1) before "AKamran" (position 2)).
    //   2. Users active within the last 7 days get a small boost (a CASE
    //      expression sorted DESC), so recency breaks ties between equally
    //      well-matched names.
    //   3. `last_seen_at DESC NULLS LAST` is a secondary sort so more recently
    //      active users surface higher within each tier.
    //   4. Finally fall back to alphabetical + created_at for determinism.
    const result = await sql<{
      id: string;
      display_name: string;
      photo_url: string | null;
      primary_sport: string | null;
      primary_elo: number | null;
    }>`
      WITH primary_stats AS (
        SELECT DISTINCT ON (pss.user_id)
               pss.user_id, s.slug AS slug, pss.elo_rating
          FROM player_sport_stats pss
          JOIN sports s ON s.id = pss.sport_id
         ORDER BY pss.user_id, pss.elo_rating DESC
      )
      SELECT u.id,
             u.display_name,
             u.photo_url,
             ps.slug AS primary_sport,
             ps.elo_rating AS primary_elo
        FROM users u
        LEFT JOIN primary_stats ps ON ps.user_id = u.id
       WHERE u.deleted_at IS NULL
         AND u.display_name ILIKE ${pattern}
         ${
           viewerUserId !== null
             ? sql`AND u.id <> ${viewerUserId}::uuid
                   AND NOT EXISTS (
                     SELECT 1 FROM user_blocks ub
                      WHERE (ub.blocker_user_id = ${viewerUserId}::uuid AND ub.blocked_user_id = u.id)
                         OR (ub.blocker_user_id = u.id AND ub.blocked_user_id = ${viewerUserId}::uuid)
                   )`
             : sql``
         }
       ORDER BY position(lower(${rawQ}) IN lower(u.display_name)) ASC,
                CASE WHEN u.last_seen_at IS NOT NULL
                      AND u.last_seen_at >= now() - interval '7 days'
                     THEN 1 ELSE 0 END DESC,
                u.last_seen_at DESC NULLS LAST,
                u.display_name ASC,
                u.created_at DESC
       LIMIT ${limit}
    `.execute(this.deps.db.db);
    // Enrich with the derived skill label — null when `primary_elo` is null
    // so the iOS search row hides the chip rather than showing a misleading
    // "beginner" badge for users with no recorded stats.
    return result.rows.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      photo_url: r.photo_url,
      primary_sport: r.primary_sport,
      primary_elo: r.primary_elo,
      primary_skill_level: r.primary_elo === null ? null : skillLevelFromElo(r.primary_elo),
    }));
  }

  private async searchGames(pattern: string, rawQ: string, limit: number): Promise<SearchGameResult[]> {
    // Match against notes (free text) OR host display name OR venue name —
    // those are the fields a user can plausibly remember when looking for a
    // specific game ("Salam's evening match at Padel Hub").
    //
    // Ranking:
    //   1. `starts_at ASC` — games starting soonest first. This is the
    //      dominant signal: you almost never want a game next month over a
    //      game tonight, regardless of how well the name matches.
    //   2. Name-relevance via the smallest `position(...)` across the three
    //      searchable fields breaks ties between games on the same day. We
    //      use `LEAST(... , 1e9)` and replace 0 (no-match) with a large
    //      sentinel so non-matching fields don't beat prefix matches.
    const result = await sql<{
      id: string;
      sport_slug: string;
      host_display_name: string;
      venue_name: string | null;
      starts_at: Date;
      notes: string | null;
      status: "open" | "full" | "cancelled" | "completed";
    }>`
      SELECT g.id,
             s.slug AS sport_slug,
             u.display_name AS host_display_name,
             v.name AS venue_name,
             g.starts_at,
             g.notes,
             g.status
        FROM games g
        JOIN sports s ON s.id = g.sport_id
        JOIN users  u ON u.id = g.host_user_id
        LEFT JOIN courts c ON c.id = g.court_id
        LEFT JOIN venues v ON v.id = c.venue_id
       WHERE u.deleted_at IS NULL
         AND g.status IN ('open', 'full')
         AND g.visibility = 'public'
         AND (
           g.notes ILIKE ${pattern}
           OR u.display_name ILIKE ${pattern}
           OR v.name ILIKE ${pattern}
         )
       ORDER BY g.starts_at ASC,
                LEAST(
                  NULLIF(position(lower(${rawQ}) IN lower(coalesce(u.display_name, ''))), 0),
                  NULLIF(position(lower(${rawQ}) IN lower(coalesce(v.name, ''))), 0),
                  NULLIF(position(lower(${rawQ}) IN lower(coalesce(g.notes, ''))), 0)
                ) ASC NULLS LAST
       LIMIT ${limit}
    `.execute(this.deps.db.db);
    return result.rows.map((r) => ({
      id: r.id,
      sport_slug: r.sport_slug,
      host_display_name: r.host_display_name,
      venue_name: r.venue_name,
      starts_at: r.starts_at.toISOString(),
      notes: r.notes,
      status: r.status,
    }));
  }

  private async searchTournaments(pattern: string, rawQ: string, limit: number): Promise<SearchTournamentResult[]> {
    // Tournament list pages still expect newest-first scrolling, so keep
    // `starts_at DESC` as the dominant sort. Prefix-match relevance on the
    // tournament name acts only as a tiebreaker.
    const result = await sql<{
      id: string;
      name: string;
      sport_slug: string;
      venue_name: string | null;
      starts_at: Date;
      status: string;
    }>`
      SELECT t.id,
             t.name,
             s.slug AS sport_slug,
             v.name AS venue_name,
             t.starts_at,
             t.status::text AS status
        FROM tournaments t
        JOIN sports s ON s.id = t.sport_id
        LEFT JOIN venues v ON v.id = t.venue_id
       WHERE t.name ILIKE ${pattern}
          OR (t.description IS NOT NULL AND t.description ILIKE ${pattern})
       ORDER BY t.starts_at DESC,
                NULLIF(position(lower(${rawQ}) IN lower(t.name)), 0) ASC NULLS LAST
       LIMIT ${limit}
    `.execute(this.deps.db.db);
    return result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      sport_slug: r.sport_slug,
      venue_name: r.venue_name,
      starts_at: r.starts_at.toISOString(),
      status: r.status,
    }));
  }

  private async searchVenues(pattern: string, rawQ: string, limit: number): Promise<SearchVenueResult[]> {
    // Venue ranking:
    //   1. Prefix matches on `v.name` come first (a venue called "Padel
    //      Hub" outranks "Old Padel" for the query "Padel").
    //   2. Partner venues are commercially preferred — they get the next
    //      sort priority so they bubble up among equally-relevant matches.
    //   3. `rating_avg DESC NULLS LAST` so higher-rated venues outrank
    //      lower-rated ones (and unrated venues land at the bottom of each
    //      tier).
    //   4. Alphabetical fallback for stable ordering.
    const result = await sql<{
      id: string;
      name: string;
      address: string;
      is_partner: boolean;
    }>`
      SELECT v.id, v.name, v.address, v.is_partner
        FROM venues v
       WHERE v.name ILIKE ${pattern} OR v.address ILIKE ${pattern}
       ORDER BY NULLIF(position(lower(${rawQ}) IN lower(v.name)), 0) ASC NULLS LAST,
                v.is_partner DESC,
                v.rating_avg DESC NULLS LAST,
                v.name ASC
       LIMIT ${limit}
    `.execute(this.deps.db.db);
    return result.rows;
  }
}
