import { z } from "zod";

// === Scoring agent — Zod schemas ===
//
// The wire shape mirrors `MatchScoreTable` 1:1 plus a derived `winning_team`
// field when the match ends. We keep `sets` as an array of `{a, b}` (with
// optional `tb`) — the same shape stored in jsonb so encode/decode is a
// pass-through.

export const MatchScoreStatusEnum = z.enum(["in_progress", "completed"]);

export const MatchScoreSetSchema = z.object({
  a: z.number().int().nonnegative(),
  b: z.number().int().nonnegative(),
  tb: z
    .object({
      a: z.number().int().nonnegative(),
      b: z.number().int().nonnegative(),
    })
    .optional(),
});

export const MatchScoreSchema = z.object({
  game_id: z.string().uuid(),
  team_a_user_ids: z.array(z.string().uuid()).min(1),
  team_b_user_ids: z.array(z.string().uuid()).min(1),
  sets: z.array(MatchScoreSetSchema),
  current_set: z.number().int().min(0).max(2),
  current_game_a: z.number().int().min(0).max(7),
  current_game_b: z.number().int().min(0).max(7),
  point_a: z.number().int().min(0),
  point_b: z.number().int().min(0),
  status: MatchScoreStatusEnum,
  started_at: z.string(),
  completed_at: z.string().nullable(),
  winning_team: z.enum(["a", "b"]).nullable(),
  // Per-user ELO change once the ratings flow has processed the game.
  // Empty `{}` until the first batch of ratings is submitted; on iOS the
  // FinalResultCard reads the viewer's user_id out of this map to render
  // the "+18" / "-12" delta chip. Integer values (post - pre).
  elo_delta_by_user: z.record(z.number().int()),
});
export type MatchScoreView = z.infer<typeof MatchScoreSchema>;

export const StartScoringRequest = z
  .object({
    team_a_user_ids: z.array(z.string().uuid()).min(1).max(4),
    team_b_user_ids: z.array(z.string().uuid()).min(1).max(4),
  })
  .refine(
    (v) =>
      // Teams must be disjoint — same user can't be on both sides.
      v.team_a_user_ids.every((u) => !v.team_b_user_ids.includes(u)),
    { message: "Teams must not share players" },
  );
export type StartScoringRequest = z.infer<typeof StartScoringRequest>;

export const PointRequest = z.object({
  team: z.enum(["a", "b"]),
});
export type PointRequest = z.infer<typeof PointRequest>;
