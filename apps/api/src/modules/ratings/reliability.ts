/**
 * Reliability score formula. Range [0, 100]. Higher = more reliable.
 *
 * Per-sport, not global, so a player who flakes Padel doesn't have their
 * football reputation dragged down (and vice versa).
 *
 * Rule set (designed to be intuitive on a profile card):
 *   - Late cancel (< LATE_CANCEL_THRESHOLD_HOURS before starts_at):  -10
 *   - No-show (marked by host post-game):                            -20
 *   - Played to completion:                                          +1   (capped at 100)
 *   - Early cancel (>= threshold):                                    0   (no penalty)
 *
 * Everyone starts at 100. The slow regen prevents one good game from washing
 * out persistent flaking, while keeping a path back to 100 for reformed users.
 */

export const LATE_CANCEL_THRESHOLD_HOURS = 12;
export const PENALTY_LATE_CANCEL = 10;
export const PENALTY_NO_SHOW = 20;
export const REGEN_PER_PLAYED = 1;

export type ReliabilityEvent =
  | { type: "played" }
  | { type: "late_cancel"; hours_before_start: number }
  | { type: "early_cancel"; hours_before_start: number }
  | { type: "no_show" };

export function deltaForEvent(event: ReliabilityEvent): number {
  switch (event.type) {
    case "played":      return REGEN_PER_PLAYED;
    case "no_show":     return -PENALTY_NO_SHOW;
    case "late_cancel": return -PENALTY_LATE_CANCEL;
    case "early_cancel": return 0;
  }
}

export function applyReliabilityDelta(current: number, delta: number): number {
  const next = current + delta;
  if (next < 0) return 0;
  if (next > 100) return 100;
  return next;
}

/**
 * Classify a cancellation given the game start time and the moment of
 * cancellation. The threshold is "less than N hours before" → late.
 */
export function classifyCancel(
  startsAt: Date,
  cancelledAt: Date,
): ReliabilityEvent {
  const hoursBefore = (startsAt.getTime() - cancelledAt.getTime()) / (60 * 60 * 1000);
  return hoursBefore < LATE_CANCEL_THRESHOLD_HOURS
    ? { type: "late_cancel", hours_before_start: hoursBefore }
    : { type: "early_cancel", hours_before_start: hoursBefore };
}
