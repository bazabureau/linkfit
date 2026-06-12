import { z } from "zod";

/**
 * Zod schemas + inferred types for the Achievements module.
 *
 * The criteria DSL stays SERVER-SIDE — clients only see `progress`, a
 * structured progress object the service layer derives from the raw rule.
 * That keeps badges add/edit-safe without iOS releases.
 */

export const AchievementSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  icon_name: z.string(),
});

/**
 * Progress toward an achievement. `target` is the value the criterion
 * compares against (e.g. 10 games, ELO 1500). `current` is where the player
 * stands today. `unit` is a hint for the iOS detail sheet to render labels.
 */
export const AchievementProgressSchema = z.object({
  current: z.number(),
  target: z.number(),
  unit: z.string(), // "games" | "elo" | "wins" | "percent" | "days" | "ratings"
});

export const UserAchievementItemSchema = AchievementSchema.extend({
  unlocked: z.boolean(),
  unlocked_at: z.string().nullable(),
  progress: AchievementProgressSchema.nullable(),
});
export type UserAchievementItem = z.infer<typeof UserAchievementItemSchema>;

export const UserAchievementsResponse = z.object({
  items: z.array(UserAchievementItemSchema),
  unlocked_count: z.number().int().nonnegative(),
  total_count: z.number().int().nonnegative(),
});
export type UserAchievementsResponse = z.infer<typeof UserAchievementsResponse>;
