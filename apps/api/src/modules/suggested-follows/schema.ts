import { z } from "zod";
import { SkillLevelEnum } from "../../shared/skill/skillLevel.js";

/**
 * Suggested-follows — Zod schemas for `GET /api/v1/me/suggested-follows`.
 *
 * The iOS PlayersView renders these as a horizontal carousel: "people you've
 * played with most". Ranking signal is `shared_games_count` — number of
 * confirmed games the viewer has co-attended with the candidate.
 *
 * The surface is intentionally minimal — no pagination, no filtering. The
 * carousel is a snapshot, and v1 caps the list at 20 (see service). A future
 * iteration can add cursor pagination if product wants a full-screen view.
 *
 * `reason` is a stable machine-readable enum (not free-text) so the iOS
 * client can map it to localized copy. v1 only emits `"played_together"`;
 * we leave the field as an enum so adding `"mutual_friends"` etc later is a
 * non-breaking schema change.
 */
export const SuggestedFollowReason = z.enum(["played_together"]);
export type SuggestedFollowReason = z.infer<typeof SuggestedFollowReason>;

export const SuggestedFollowItem = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  /** Candidate's ELO on THEIR primary sport (highest games_played). Null if
   *  the candidate has no `player_sport_stats` row yet. */
  primary_elo: z.number().int().nullable(),
  /**
   * Word-based label derived from `primary_elo`. Always present — when
   * `primary_elo` is `null` (no stats yet) this falls through to
   * `"beginner"`, matching the welcoming default in `skillLevelFromElo`.
   * iOS uses this to render the skill chip on the suggestion card.
   */
  skill_level: z.enum(SkillLevelEnum),
  /** Count of distinct confirmed games the viewer + candidate co-attended. */
  shared_games_count: z.number().int().positive(),
  reason: SuggestedFollowReason,
});
export type SuggestedFollowItem = z.infer<typeof SuggestedFollowItem>;

export const SuggestedFollowsResponse = z.object({
  items: z.array(SuggestedFollowItem),
});
export type SuggestedFollowsResponse = z.infer<typeof SuggestedFollowsResponse>;
