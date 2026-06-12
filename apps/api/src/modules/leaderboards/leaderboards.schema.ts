import { z } from "zod";
import { SkillLevelEnum } from "../../shared/skill/skillLevel.js";

/**
 * Leaderboards — Zod schemas for the public top-N-by-ELO endpoint. The
 * surface is intentionally minimal so the iOS "Top Players" screen can
 * render a stable list with rank, ELO, and a quick win-rate glance.
 *
 * - `sport` is the sport slug ("padel", "tennis", ...). Required.
 * - `limit` caps the page size; the server enforces a hard 200 ceiling so
 *   a misbehaving client can't pull the entire ladder in one request.
 * - `offset` is the classic SQL offset for pagination — fine here because
 *   the underlying ranking is deterministic (ELO DESC, games_played DESC)
 *   and the data churns slowly compared to a feed timeline.
 * - `region` is free-text for now (see service for the TODO on real
 *   venue→region mapping). Kept for backwards compat.
 *
 * Wave-9 additions — retention-focused filters surfaced on the iOS
 * Leaderboards screen so the player can carve the ladder by where they
 * play, who they want to compare against, and how recent the games are:
 *
 * - `scope` — `"city"` or `"global"`. Currently both behave the same
 *   server-side (no city column on users yet) so callers pass it for
 *   forward-compat. When the venue→city mapping ships we'll filter
 *   `"city"` to the viewer's local players without iOS needing a
 *   client update.
 * - `skill` — `"beginner"|"intermediate"|"advanced"|"expert"|"all"`.
 *   Maps to ELO ranges identical to `skillLevelFromElo`. `"all"` skips
 *   the filter entirely (the default behavior).
 * - `period` — `"week"|"month"|"all"`. Filters `player_sport_stats` by
 *   the recency window. We approximate this via `pss.updated_at` since
 *   `player_sport_stats` is updated on every confirmed game; precise
 *   week-bucketing would require joining `game_participants` which is
 *   heavier than we want for a top-N read.
 */
export const ScopeEnum = ["city", "global"] as const;
export type Scope = (typeof ScopeEnum)[number];

export const SkillFilterEnum = [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
  "all",
] as const;
export type SkillFilter = (typeof SkillFilterEnum)[number];

export const PeriodEnum = ["week", "month", "all"] as const;
export type Period = (typeof PeriodEnum)[number];

export const LeaderboardEloQuery = z.object({
  sport: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  region: z.string().optional(),
  scope: z.enum(ScopeEnum).optional(),
  skill: z.enum(SkillFilterEnum).optional(),
  period: z.enum(PeriodEnum).optional(),
});
export type LeaderboardEloQuery = z.infer<typeof LeaderboardEloQuery>;

export const LeaderboardEntry = z.object({
  rank: z.number().int().positive(),
  user_id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  elo_rating: z.number().int(),
  /**
   * Word-based label derived from `elo_rating` — see
   * `shared/skill/skillLevel.ts`. iOS renders this directly so the threshold
   * table lives in one place.
   */
  skill_level: z.enum(SkillLevelEnum),
  games_played: z.number().int().nonnegative(),
  /** Total confirmed wins. Drives the "N qələbə" trailing label on iOS. */
  games_won: z.number().int().nonnegative(),
  /** Win rate as a fraction in [0, 1] with two-decimal precision. */
  win_rate: z.number().min(0).max(1),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;

export const LeaderboardEloResponse = z.object({
  items: z.array(LeaderboardEntry),
  total_count: z.number().int().nonnegative(),
});
export type LeaderboardEloResponse = z.infer<typeof LeaderboardEloResponse>;
