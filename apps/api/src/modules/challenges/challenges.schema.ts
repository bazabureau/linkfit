import { z } from "zod";

/**
 * Daily challenges schemas — wire contract for the iOS card on HomeView.
 *
 * The catalog of codes is a static enum here. Adding a new code means
 * extending this list AND wiring the auto-completion hook in
 * `challenges.service.ts` (or accepting that the new code is iOS-driven
 * only — see `comment_on_feed` for an example that the FeedComments
 * service hooks into directly).
 *
 * Titles + iconography live on iOS — the wire payload omits the title to
 * keep the localization story single-sourced (AZ Localizable.xcstrings
 * is the canonical translation surface). The server only returns the
 * stable `code`, the per-day completion stamp, and an `icon` hint that
 * iOS can map to an SF Symbol.
 */
export const ChallengeCodeSchema = z.enum([
  "follow_one",
  "join_a_game",
  "post_a_story",
  "comment_on_feed",
  "invite_to_game",
  "react_to_story",
]);
export type ChallengeCode = z.infer<typeof ChallengeCodeSchema>;

export const ChallengeItemSchema = z.object({
  code: ChallengeCodeSchema,
  /** AZ-localized server-side fallback. iOS overrides via Localizable.xcstrings
   *  using `challenges.title.<code>` keys — the wire string is only used by
   *  non-iOS callers (admin tools, push payloads). */
  title: z.string(),
  /** Optional short body string — never localized server-side. iOS reads
   *  `challenges.body.<code>` from xcstrings; we ship `""` on the wire so
   *  older clients still decode without breakage. */
  body: z.string(),
  /** ISO-8601 UTC timestamp the user completed the action, or null when
   *  the challenge is still open. Sticky for the day — never resets. */
  completed_at: z.string().nullable(),
  /** SF Symbol hint (`"person.crop.circle.badge.plus"`, etc.). iOS may
   *  ignore this and pick its own glyph; included so non-iOS surfaces
   *  (admin, web, push body) can render a consistent icon. */
  icon: z.string(),
});
export type ChallengeItem = z.infer<typeof ChallengeItemSchema>;

export const TodayChallengesResponseSchema = z.object({
  /** ISO date (YYYY-MM-DD) the challenges are issued for. Matches the
   *  user's local-day rollover (UTC-anchored for simplicity — see
   *  migration header). */
  date: z.string(),
  /** Exactly 3 items, deterministic order per (user_id, date). */
  challenges: z.array(ChallengeItemSchema),
});
export type TodayChallengesResponse = z.infer<typeof TodayChallengesResponseSchema>;

export const CheckChallengeResponseSchema = z.object({
  /** True when the underlying action has actually been performed — i.e.
   *  the server side-effect that the code represents landed. Idempotent:
   *  hitting `/check` twice on a completed challenge returns `true` both
   *  times without re-incrementing anything. */
  completed: z.boolean(),
});
export type CheckChallengeResponse = z.infer<typeof CheckChallengeResponseSchema>;
