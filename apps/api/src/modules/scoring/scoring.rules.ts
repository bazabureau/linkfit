// === Scoring agent — padel rules ===
//
// Pure functions, no DB. The service holds DB transactions and calls these
// to advance state. Keeping rules pure means we can drive them from unit
// tests at ~zero cost and replay/undo by re-running point events.
//
// Padel scoring (best-of-3 sets):
//   • A game: 0/15/30/40, then deuce → advantage → game on next point.
//     Encoded as 0,1,2,3,4 where 4 means "advantage" (only valid when the
//     opponent is also at 3; pair (3,3) is deuce).
//   • A set: first to 6 games with a 2-game lead OR 7-5; at 6-6 a tiebreak.
//   • A tiebreak: first to 7 points with a 2-point lead. The tiebreak
//     replaces the would-be 13th game, and the set is recorded 7-6.
//   • A match: first to 2 sets wins. After the 2nd set, the match ends.
//
// We don't model the "golden point" rule — Linkfit games can opt into it
// later via a flag; for now matches use traditional deuce/advantage.

import { type MatchScoreSetJson } from "../../shared/db/types.js";

/** Mutable state passed through every rule transition. */
export interface ScoreState {
  sets: MatchScoreSetJson[];
  current_set: number;
  current_game_a: number;
  current_game_b: number;
  point_a: number;
  point_b: number;
  status: "in_progress" | "completed";
  winning_team: "a" | "b" | null;
}

/** Initial empty state — no points, no games, no sets played. */
export function initialScoreState(): ScoreState {
  return {
    sets: [],
    current_set: 0,
    current_game_a: 0,
    current_game_b: 0,
    point_a: 0,
    point_b: 0,
    status: "in_progress",
    winning_team: null,
  };
}

/**
 * Are we currently in a tiebreak (6-6 in the in-progress set)?
 *
 * Padel uses standard scoring during a tiebreak (first to 7 by 2), so the
 * point counters here are raw integers, not 0/15/30/40.
 */
function inTiebreak(state: ScoreState): boolean {
  return state.current_game_a === 6 && state.current_game_b === 6;
}

/**
 * Did the just-incremented tiebreak finish? First to 7 by 2.
 */
function tiebreakWinner(pA: number, pB: number): "a" | "b" | null {
  if (pA >= 7 && pA - pB >= 2) return "a";
  if (pB >= 7 && pB - pA >= 2) return "b";
  return null;
}

/**
 * Did the just-incremented standard game finish?
 *  - team reaches 4 and opponent ≤ 2 (i.e. 4-0/4-1/4-2 ladder, encoding).
 *  - team reaches 4 and is exactly 1 ahead of opponent at 3 (advantage→game).
 * Returns the team that won or null.
 */
function gameWinner(pA: number, pB: number): "a" | "b" | null {
  if (pA >= 4 && pA - pB >= 2) return "a";
  if (pB >= 4 && pB - pA >= 2) return "b";
  return null;
}

/**
 * Did the just-finished game close out the set?
 *  - team reaches 6 games and leads by ≥ 2 → set over.
 *  - team reaches 7 games (only via 7-5 or 7-6 tiebreak) → set over.
 */
function setWinner(gA: number, gB: number): "a" | "b" | null {
  if (gA >= 6 && gA - gB >= 2) return "a";
  if (gB >= 6 && gB - gA >= 2) return "b";
  if (gA === 7) return "a";
  if (gB === 7) return "b";
  return null;
}

/**
 * Final match decision: first to 2 sets wins. Returns the team that just
 * sealed the match, or null if play continues.
 */
function matchWinner(sets: MatchScoreSetJson[]): "a" | "b" | null {
  let aSets = 0;
  let bSets = 0;
  for (const s of sets) {
    if (s.a > s.b) aSets += 1;
    else if (s.b > s.a) bSets += 1;
  }
  if (aSets >= 2) return "a";
  if (bSets >= 2) return "b";
  return null;
}

/**
 * Apply a single point for `team`. Mutates `state` in place. Idempotent
 * once the match is `completed` (a no-op so racing taps at the end don't
 * blow up).
 */
export function applyPoint(state: ScoreState, team: "a" | "b"): void {
  if (state.status === "completed") return;

  if (inTiebreak(state)) {
    if (team === "a") state.point_a += 1;
    else state.point_b += 1;

    const tbWin = tiebreakWinner(state.point_a, state.point_b);
    if (tbWin === null) return;

    // Tiebreak resolves the set 7-6 with the actual tb score retained.
    const setRow: MatchScoreSetJson = tbWin === "a"
      ? { a: 7, b: 6, tb: { a: state.point_a, b: state.point_b } }
      : { a: 6, b: 7, tb: { a: state.point_a, b: state.point_b } };
    state.sets.push(setRow);
    state.point_a = 0;
    state.point_b = 0;
    state.current_game_a = 0;
    state.current_game_b = 0;
    finalizeAfterSet(state);
    return;
  }

  // Standard game scoring.
  //
  // Special case the "advantage → deuce" rewind: when the team holding
  // advantage (encoded as 4 vs the opponent's 3) loses the next point,
  // we snap back to deuce instead of incrementing into a phantom 4-4
  // state. This keeps the encoding tight and avoids needing a separate
  // boolean flag for "we're past 40".
  if (team === "a" && state.point_b === 4 && state.point_a === 3) {
    state.point_b = 3;
    return;
  }
  if (team === "b" && state.point_a === 4 && state.point_b === 3) {
    state.point_a = 3;
    return;
  }

  if (team === "a") state.point_a += 1;
  else state.point_b += 1;

  const gWin = gameWinner(state.point_a, state.point_b);
  if (gWin === null) return;

  // Award the game. Reset points; bump game counter; check set winner.
  state.point_a = 0;
  state.point_b = 0;
  if (gWin === "a") state.current_game_a += 1;
  else state.current_game_b += 1;

  const sWin = setWinner(state.current_game_a, state.current_game_b);
  if (sWin === null) return;

  state.sets.push({ a: state.current_game_a, b: state.current_game_b });
  state.current_game_a = 0;
  state.current_game_b = 0;
  finalizeAfterSet(state);
}

/** After a set is committed, decide whether the match is over or move on. */
function finalizeAfterSet(state: ScoreState): void {
  const mWin = matchWinner(state.sets);
  if (mWin !== null) {
    state.status = "completed";
    state.winning_team = mWin;
    return;
  }
  state.current_set += 1;
}

/**
 * Replay all points in order. `points` is the chronological list. Used by
 * `undo` — we drop the last point and rebuild. O(n) per undo is fine
 * because games rarely exceed ~200 points.
 */
export function replayPoints(points: ("a" | "b")[]): ScoreState {
  const s = initialScoreState();
  for (const p of points) applyPoint(s, p);
  return s;
}
