import { z } from "zod";
import { SkillLevelEnum } from "../../shared/skill/skillLevel.js";

/**
 * Surface the user can scope search to. `all` runs every searcher.
 * Mirrored 1:1 on the iOS side so the segmented chips stay aligned.
 */
export const SearchTypeEnum = z.enum([
  "all",
  "players",
  "games",
  "tournaments",
  "venues",
]);
export type SearchType = z.infer<typeof SearchTypeEnum>;

/**
 * Querystring. We default `type=all` and `limit=10` so the iOS home magnifier
 * call ("just give me the top results") needs no parameters beyond `q`.
 *
 * Minimum length of 2 protects the DB from running an ILIKE scan for every
 * single keystroke — clients are expected to debounce / wait until the user
 * has typed at least two characters before firing.
 */
export const SearchQuery = z.object({
  q: z.string().trim().min(2).max(120),
  type: SearchTypeEnum.optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

// ─── Result rows ──────────────────────────────────────────────────────

export const SearchPlayerResult = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  primary_sport: z.string().nullable(),
  primary_elo: z.number().int().nullable(),
  /**
   * Word-based label derived from `primary_elo`. Null when `primary_elo`
   * is null — keeps the search row from rendering a "beginner" chip on
   * every freshly-signed-up account that has no stats yet.
   */
  primary_skill_level: z.enum(SkillLevelEnum).nullable(),
});
export type SearchPlayerResult = z.infer<typeof SearchPlayerResult>;

export const SearchGameResult = z.object({
  id: z.string().uuid(),
  sport_slug: z.string(),
  host_display_name: z.string(),
  venue_name: z.string().nullable(),
  starts_at: z.string(),
  notes: z.string().nullable(),
  status: z.enum(["open", "full", "cancelled", "completed"]),
});
export type SearchGameResult = z.infer<typeof SearchGameResult>;

export const SearchTournamentResult = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sport_slug: z.string(),
  venue_name: z.string().nullable(),
  starts_at: z.string(),
  status: z.string(),
});
export type SearchTournamentResult = z.infer<typeof SearchTournamentResult>;

export const SearchVenueResult = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string(),
  is_partner: z.boolean(),
});
export type SearchVenueResult = z.infer<typeof SearchVenueResult>;

export const SearchResponse = z.object({
  query: z.string(),
  players: z.array(SearchPlayerResult),
  games: z.array(SearchGameResult),
  tournaments: z.array(SearchTournamentResult),
  venues: z.array(SearchVenueResult),
});
export type SearchResponse = z.infer<typeof SearchResponse>;
