import { z } from "zod";

/**
 * Query schema for `GET /api/v1/me/insights`.
 *
 * `sport` — slug from the `sports` table (e.g. "padel"). Required so the
 *           caller is explicit; an "all sports" aggregate mixes ELO ladders
 *           across disciplines, which is meaningless.
 * `days`  — rolling window in days. 7..1825 (5y) — we cap the upper bound to
 *           avoid pathological scans, and 0/negative is rejected.
 */
export const InsightsQuery = z.object({
  sport: z.string().min(1).max(64),
  days: z.coerce.number().int().min(1).max(1825).default(90),
});
export type InsightsQuery = z.infer<typeof InsightsQuery>;

export const InsightsEloPoint = z.object({
  date: z.string(), // ISO date (YYYY-MM-DD)
  elo: z.number().int(),
});

export const InsightsWinRatePoint = z.object({
  date: z.string(),
  win_rate: z.number().min(0).max(100), // percentage
  games: z.number().int().nonnegative(),
});

export const InsightsWeekBucket = z.object({
  week_start: z.string(), // ISO date of Monday
  games: z.number().int().nonnegative(),
});

export const InsightsOpponent = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  games_count: z.number().int().positive(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  win_rate: z.number().min(0).max(100),
});

export const InsightsReliabilityPoint = z.object({
  date: z.string(),
  reliability: z.number().int().min(0).max(100),
});

export const InsightsResponse = z.object({
  sport_slug: z.string(),
  days: z.number().int(),
  total_games: z.number().int().nonnegative(),
  current_elo: z.number().int(),
  current_reliability: z.number().int().min(0).max(100),
  elo_series: z.array(InsightsEloPoint),
  win_rate_series: z.array(InsightsWinRatePoint),
  games_per_week: z.array(InsightsWeekBucket),
  opponents: z.array(InsightsOpponent),
  reliability_series: z.array(InsightsReliabilityPoint),
});
export type InsightsResponse = z.infer<typeof InsightsResponse>;
