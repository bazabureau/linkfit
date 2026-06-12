import { z } from "zod";

/**
 * Streaks payload — derived purely from `game_participants` ∝ `games.starts_at`.
 *
 * "Active week" = the user has ≥1 participation row (status in
 *   confirmed | played) whose host game started inside that ISO week.
 *
 * `current_streak_weeks` counts consecutive active weeks ending at the
 * CURRENT calendar week. If the current week is not active but the previous
 * one was, the streak is considered alive for "this week" — players don't
 * want to lose their streak on Monday morning before they've had a chance to
 * play. We use a 1-week grace: streak only breaks once two consecutive
 * weeks are missed.
 *
 * `longest_streak_weeks` is the maximum consecutive active-week run found
 * anywhere in the user's play history (so it never decreases).
 *
 * `weeks` is the 26-week trailing window the iOS heatmap renders, oldest
 * first, with `games_count` zero-filled for inactive weeks.
 */
export const StreaksWeekSchema = z.object({
  /** Monday (UTC) of the week as ISO `YYYY-MM-DD`. */
  week_start: z.string(),
  /** Number of distinct games the user played in this week. */
  games_count: z.number().int().nonnegative(),
});
export type StreaksWeek = z.infer<typeof StreaksWeekSchema>;

export const StreaksResponseSchema = z.object({
  current_streak_weeks: z.number().int().nonnegative(),
  longest_streak_weeks: z.number().int().nonnegative(),
  /** Exactly 26 entries (current week last). Inactive weeks have count 0. */
  weeks: z.array(StreaksWeekSchema),
});
export type StreaksResponse = z.infer<typeof StreaksResponseSchema>;
