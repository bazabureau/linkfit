import { z } from "zod";
import { SkillLevelEnum } from "../../shared/skill/skillLevel.js";

export const RatingOutcomeEnum = z.enum(["win", "loss", "draw"]);

/**
 * Word-based skill label — see `shared/skill/skillLevel.ts`. Surfaced
 * alongside (not in place of) `elo_rating` so iOS still has the raw integer
 * for analytics and ELO-delta math, while the UI renders the label directly.
 */
export const SkillLevelSchema = z.enum(SkillLevelEnum);

export const RatingItem = z.object({
  rated_user_id: z.string().uuid(),
  outcome: RatingOutcomeEnum,
  behavior_ok: z.boolean(),
});

export const SubmitRatingsRequest = z.object({
  ratings: z.array(RatingItem).min(1).max(40),
});
export type SubmitRatingsRequest = z.infer<typeof SubmitRatingsRequest>;

export const SubmitRatingsResponse = z.object({
  recorded: z.number().int().nonnegative(),
  skipped_duplicates: z.number().int().nonnegative(),
});

export const SportStatsSchema = z.object({
  sport_id: z.string().uuid(),
  sport_slug: z.string(),
  elo_rating: z.number().int(),
  /**
   * Word-based label derived from `elo_rating`. iOS renders this directly
   * so all clients agree on the threshold table.
   */
  skill_level: SkillLevelSchema,
  games_played: z.number().int().nonnegative(),
  games_won: z.number().int().nonnegative(),
  reliability_score: z.number().int().min(0).max(100),
});

export const PublicProfileSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  created_at: z.string(),
  stats: z.array(SportStatsSchema),
  /**
   * Word-based label for the user's strongest sport — derived from the
   * maximum `elo_rating` across `stats`. Falls back to `"beginner"` when
   * the user has no `player_sport_stats` rows yet. iOS uses this for the
   * compact "primary skill" badge on the profile header.
   */
  top_skill_level: SkillLevelSchema,
  /**
   * Whether the calling viewer follows this user. Always present in the
   * response; `false` for anonymous callers and for the user viewing their
   * own profile (a self-follow edge never exists). Lets the iOS profile
   * page render the correct Follow / Following button state on first load.
   */
  is_following: z.boolean(),
  /**
   * Whether this user follows the calling viewer back. Always present in
   * the response; `false` for anonymous callers and for the user viewing
   * their own profile (a self-follow edge never exists). iOS uses this to
   * render the "Follows you" pill on the profile header and to upgrade the
   * primary CTA to "Follow back" when the viewer hasn't yet reciprocated.
   */
  follows_viewer: z.boolean(),
  /**
   * ISO-8601 timestamp of the target user's last successful authentication;
   * NULL if no presence signal exists yet. iOS uses this to render
   * "Active now" / "5m ago" / "Active yesterday" on the profile screen.
   */
  last_seen_at: z.string().nullable(),
  followers_count: z.number().int().nonnegative().optional(),
  following_count: z.number().int().nonnegative().optional(),
});
