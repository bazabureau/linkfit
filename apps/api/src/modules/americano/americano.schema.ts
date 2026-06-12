import { z } from "zod";

export const CreateAmericanoRequest = z.object({
  name: z.string().min(1).max(100),
  format: z.enum(["solo", "team"]),
  players: z.array(z.string().min(1).max(50)).min(4).max(12),
  courts: z.array(z.string().min(1).max(50)).min(1).max(9),
  scoring_system: z.string().min(1).max(50),
});

export const RecordScoreRequest = z.object({
  score_a: z.number().int().nonnegative(),
  score_b: z.number().int().nonnegative(),
});

export type CreateAmericanoInput = z.infer<typeof CreateAmericanoRequest>;
export type RecordScoreInput = z.infer<typeof RecordScoreRequest>;
