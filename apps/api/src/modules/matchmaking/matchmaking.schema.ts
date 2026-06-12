import { z } from "zod";

/**
 * Matchmaking — Zod schemas for the two `me`-scoped endpoints. Kept tight
 * so the OpenAPI surface stays narrow; the explanations live in the
 * service that produces the payloads.
 *
 * The query is uniform across both endpoints — `limit` caps how many cards
 * we put in the carousel. The default of 10 matches the product spec; we
 * cap the upper bound at 25 so a misbehaving client can't slurp the whole
 * candidate pool.
 */
export const MatchmakingQuery = z.object({
  limit: z.coerce.number().int().min(1).max(25).default(10),
});
export type MatchmakingQuery = z.infer<typeof MatchmakingQuery>;

/** Single recommended game card. `score` is 0..1 (higher = better); the
 *  `reasons` array carries human-readable strings that the iOS card renders
 *  as lime chips. Keep the reasons short — the chip width is fixed. */
export const RecommendedGame = z.object({
  id: z.string().uuid(),
  sport_id: z.string().uuid(),
  sport_slug: z.string(),
  host_user_id: z.string().uuid(),
  host_display_name: z.string(),
  venue_name: z.string().nullable(),
  venue_photo_url: z.string().nullable().optional(),
  lat: z.number(),
  lng: z.number(),
  starts_at: z.string(),
  duration_minutes: z.number().int().positive(),
  capacity: z.number().int().positive(),
  participants_count: z.number().int().nonnegative(),
  skill_min_elo: z.number().int().nullable(),
  skill_max_elo: z.number().int().nullable(),
  distance_km: z.number().nullable(),
  /** 0..1, two-decimal precision. Higher is a stronger match. */
  score: z.number().min(0).max(1),
  /** Pre-localized phrases the client renders verbatim. */
  reasons: z.array(z.string()),
});
export type RecommendedGame = z.infer<typeof RecommendedGame>;

export const RecommendedGamesResponse = z.object({
  items: z.array(RecommendedGame),
});
export type RecommendedGamesResponse = z.infer<typeof RecommendedGamesResponse>;

/** A "player to follow" recommendation. We surface the same `score` +
 *  `reasons` shape as games so the iOS card stays uniform.
 *
 *  `reason_codes` carries machine-readable tokens the client localises
 *  itself ("same_skill" → "Eyni səviyyə"). `reasons` keeps the legacy
 *  EN strings so older clients (and the integration tests pinned in
 *  matchmaking.test.ts) keep working. New surfaces should prefer
 *  `reason_codes`. */
export const RecommendedPlayerReasonCode = z.enum([
  "same_skill",
  "same_city",
  "recently_active",
  "plays_with_your_friends",
  "reliable",
  "nearby",
  "new_player",
]);
export type RecommendedPlayerReasonCode = z.infer<typeof RecommendedPlayerReasonCode>;

export const RecommendedPlayer = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  primary_sport_slug: z.string().nullable(),
  elo_rating: z.number().int().nullable(),
  reliability_score: z.number().int().nullable(),
  distance_km: z.number().nullable(),
  mutual_followers_count: z.number().int().nonnegative(),
  score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  reason_codes: z.array(RecommendedPlayerReasonCode),
});
export type RecommendedPlayer = z.infer<typeof RecommendedPlayer>;

export const RecommendedPlayersResponse = z.object({
  items: z.array(RecommendedPlayer),
});
export type RecommendedPlayersResponse = z.infer<typeof RecommendedPlayersResponse>;
