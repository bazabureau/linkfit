/**
 * Standard ELO with provisional K-factor.
 *
 *   E_a       = 1 / (1 + 10^((Rb - Ra) / 400))
 *   R_a_new   = R_a + K * (S_a - E_a)
 *
 *   K = 32 if games_played < 30  (provisional, rating moves fast)
 *   K = 16 otherwise              (established, rating moves slow)
 *
 * Outcomes map to score: win = 1, draw = 0.5, loss = 0.
 *
 * This is intentionally minimal — Glicko-2 would be theoretically nicer but
 * it requires per-player rating-deviation tracking we don't have yet. ELO is
 * well-understood, well-loved, and "good enough" for amateur padel/futsal
 * matchmaking. Easy to swap later behind the same function signature.
 */

export type Outcome = "win" | "loss" | "draw";

export interface EloInput {
  rating: number;
  gamesPlayed: number;
}

export interface EloUpdate {
  newRating: number;
  delta: number;
}

const PROVISIONAL_THRESHOLD = 30;
const K_PROVISIONAL = 32;
const K_ESTABLISHED = 16;

export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < PROVISIONAL_THRESHOLD ? K_PROVISIONAL : K_ESTABLISHED;
}

export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

function outcomeToScore(o: Outcome): number {
  switch (o) {
    case "win":  return 1;
    case "loss": return 0;
    case "draw": return 0.5;
  }
}

export function eloUpdate(self: EloInput, opponent: EloInput, outcome: Outcome): EloUpdate {
  const expected = expectedScore(self.rating, opponent.rating);
  const score = outcomeToScore(outcome);
  const delta = Math.round(kFactor(self.gamesPlayed) * (score - expected));
  const newRating = clampRating(self.rating + delta);
  return { newRating, delta: newRating - self.rating };
}

function clampRating(r: number): number {
  if (r < 0) return 0;
  if (r > 4000) return 4000;
  return r;
}

/**
 * Apply a batch of ratings against a snapshot of player stats and return the
 * updated snapshot. Pure function — no DB calls — so it's trivially testable
 * and idempotent: feeding the same inputs always yields the same outputs.
 *
 * The caller is responsible for the transactional dance of: SELECT current
 * stats → call this → UPSERT the result → mark the ratings rows processed.
 *
 * Each rating row contributes one "head-to-head match" for the rated user
 * against the rater. We never mutate the rater's rating from someone else's
 * submission — only the rated user. (The rater submits their OWN result for
 * each opponent; their rating moves when those opponents submit theirs.)
 */
export interface RatingRow {
  rated_user_id: string;
  rater_user_id: string;
  outcome: Outcome;
}
export interface PlayerSnapshot {
  user_id: string;
  rating: number;
  games_played: number;
  games_won: number;
}
export interface BatchResult {
  updated: Map<string, PlayerSnapshot>;
}

export function applyRatingBatch(
  initial: Map<string, PlayerSnapshot>,
  rows: RatingRow[],
): BatchResult {
  const updated = new Map<string, PlayerSnapshot>();
  for (const [id, snap] of initial) {
    updated.set(id, { ...snap });
  }

  for (const r of rows) {
    const rated = updated.get(r.rated_user_id);
    const rater = updated.get(r.rater_user_id);
    if (!rated || !rater) continue; // defensive: caller should pre-populate
    const u = eloUpdate(
      { rating: rated.rating, gamesPlayed: rated.games_played },
      { rating: rater.rating, gamesPlayed: rater.games_played },
      r.outcome,
    );
    rated.rating = u.newRating;
    rated.games_played += 1;
    if (r.outcome === "win") rated.games_won += 1;
  }

  return { updated };
}
