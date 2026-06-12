import { z } from "zod";

/**
 * Wire schema for the referrals API.
 *
 * `referral_code` is the canonical 6-character code; alphabet is the
 * ambiguity-free set (no 0/O/1/I) so users can read codes aloud without
 * mishearing. We validate on input — anything else gets rejected as 400
 * before it reaches the service layer.
 */
export const ReferralCodeRegex = /^[A-HJ-NP-Z2-9]{6}$/;

export const ReferralCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ReferralCodeRegex, "Invalid referral code");

export const RedeemReferralRequest = z.object({
  code: ReferralCodeSchema,
});
export type RedeemReferralRequest = z.infer<typeof RedeemReferralRequest>;

export const ReferredUserSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  referred_at: z.string(),
});
export type ReferredUser = z.infer<typeof ReferredUserSchema>;

/** Response for GET /api/v1/me/referrals. */
export const MyReferralsResponse = z.object({
  code: z.string(),
  referred_count: z.number().int().nonnegative(),
  referred_users: z.array(ReferredUserSchema),
});
export type MyReferralsResponse = z.infer<typeof MyReferralsResponse>;

/** Response for POST /api/v1/auth/redeem-referral. */
export const RedeemReferralResponse = z.object({
  referrer_user_id: z.string().uuid(),
  referrer_display_name: z.string(),
  code_used: z.string(),
});
export type RedeemReferralResponse = z.infer<typeof RedeemReferralResponse>;

/**
 * Wave-10 compact dashboard payload for `GET /api/v1/me/referral` (singular).
 * Mirrors the brief's contract — just the code, the running count, and the
 * canonical share URL. The richer `/me/referrals` (plural) endpoint still
 * exists for the dashboard's friend list; this one is for the "Dostunu dəvət
 * et" card that only renders the count and copy-to-share affordance.
 */
export const MyReferralResponse = z.object({
  code: z.string(),
  count: z.number().int().nonnegative(),
  share_url: z.string().url(),
});
export type MyReferralResponse = z.infer<typeof MyReferralResponse>;

/**
 * Supported locales for the share-text helper. We keep this set small on
 * purpose — iOS sends the caller's preferred language as a two-letter code
 * and we either match it or fall back to English. Anything outside the set
 * normalises to `en` server-side rather than 400-ing, so a future locale
 * doesn't break the share sheet.
 */
export const ShareLocaleSchema = z
  .enum(["en", "az", "ru"])
  .default("en");
export type ShareLocale = z.infer<typeof ShareLocaleSchema>;

/** Query string for GET /api/v1/me/referrals/share. */
export const ShareReferralQuery = z.object({
  locale: ShareLocaleSchema.optional(),
});
export type ShareReferralQuery = z.infer<typeof ShareReferralQuery>;

/**
 * Response for GET /api/v1/me/referrals/share. Carries the caller's
 * referral code, the canonical share URL, and copy-paste-ready prompts in
 * each supported locale plus a single `share_text` chosen by the server
 * based on the request's `locale` query param. iOS can either show the
 * picked string verbatim or swap in another locale's text if the user
 * later switches language without another round-trip.
 */
export const ShareReferralResponse = z.object({
  code: z.string(),
  share_url: z.string().url(),
  share_text: z.string(),
  share_text_en: z.string(),
  share_text_az: z.string(),
  share_text_ru: z.string(),
});
export type ShareReferralResponse = z.infer<typeof ShareReferralResponse>;
