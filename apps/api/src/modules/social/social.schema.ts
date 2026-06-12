import { z } from "zod";
import { SkillLevelEnum } from "../../shared/skill/skillLevel.js";

/**
 * Word-based skill label — see `shared/skill/skillLevel.ts`. Surfaced
 * alongside (not in place of) the raw ELO so iOS can still feed analytics
 * and ELO-delta math the integer while rendering the label directly.
 */
const SkillLevelSchema = z.enum(SkillLevelEnum);

// ─── Notifications ─────────────────────────────────────────────────────

export const NotificationTypeEnum = z.enum([
  "game_joined", "game_cancelled", "game_reminder",
  "no_show_marked", "rating_received", "tournament_invite",
  "message_received", "system",
]);

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  type: NotificationTypeEnum,
  title: z.string(),
  body: z.string(),
  payload: z.record(z.unknown()),
  read_at: z.string().nullable(),
  created_at: z.string(),
});

export const NotificationsListResponse = z.object({
  items: z.array(NotificationSchema),
  unread_count: z.number().int().nonnegative(),
});

// ─── Messages ──────────────────────────────────────────────────────────

export const MessageAttachmentTypeEnum = z.enum(["image", "voice"]);

export const MessageSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  sender_user_id: z.string().uuid(),
  body: z.string(),
  attachment_url: z.string().nullable(),
  attachment_type: MessageAttachmentTypeEnum.nullable(),
  created_at: z.string(),
});

export const ConversationSummarySchema = z.object({
  id: z.string().uuid(),
  other_user_id: z.string().uuid(),
  other_display_name: z.string(),
  other_photo_url: z.string().nullable(),
  last_message_body: z.string().nullable(),
  last_message_at: z.string().nullable(),
  unread: z.boolean(),
});

export const ConversationListResponse = z.object({
  items: z.array(ConversationSummarySchema),
});

export const ConversationThreadResponse = z.object({
  conversation_id: z.string().uuid(),
  other_user_id: z.string().uuid(),
  other_display_name: z.string(),
  other_last_read_at: z.string().nullable().optional(),
  messages: z.array(MessageSchema),
});

export const SendMessageRequest = z
  .object({
    body: z.string().max(4000).optional(),
    attachment_url: z.string().min(1).max(2048).optional(),
    attachment_type: MessageAttachmentTypeEnum.optional(),
  })
  .refine(
    (m) => (m.body !== undefined && m.body.trim().length > 0) || m.attachment_url !== undefined,
    { message: "Message must have a body or an attachment" },
  )
  .refine(
    (m) => (m.attachment_url === undefined) === (m.attachment_type === undefined),
    { message: "attachment_url and attachment_type must be provided together" },
  );
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

export const UploadImageResponse = z.object({
  url: z.string(),
});

export const StartConversationRequest = z.object({
  other_user_id: z.string().uuid(),
});
export type StartConversationRequest = z.infer<typeof StartConversationRequest>;

// Tournament schemas moved to src/modules/tournaments/tournaments.schema.ts

// ─── Rankings ──────────────────────────────────────────────────────────

export const RankingItemSchema = z.object({
  rank: z.number().int().positive(),
  user_id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  elo_rating: z.number().int(),
  /** Word-based label derived from `elo_rating`. iOS renders this directly. */
  skill_level: SkillLevelSchema,
  games_played: z.number().int().nonnegative(),
  games_won: z.number().int().nonnegative(),
  reliability_score: z.number().int().min(0).max(100),
});

export const RankingsResponse = z.object({
  sport_slug: z.string(),
  items: z.array(RankingItemSchema),
});

// ─── Players directory ─────────────────────────────────────────────────

export const PlayerSummarySchema = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  primary_sport: z.string().nullable(),
  primary_elo: z.number().int().nullable(),
  /**
   * Word-based label derived from `primary_elo`. `null` when `primary_elo`
   * is `null` (player has no recorded stats yet) — keeping the field nullable
   * lets the iOS list render the "skill chip" only when we actually know
   * the player's level.
   */
  primary_skill_level: SkillLevelSchema.nullable(),
  reliability_score: z.number().int().min(0).max(100).nullable(),
  distance_km: z.number().nullable(),
  followers_count: z.number().int().nonnegative(),
  is_followed_by_me: z.boolean(),
  /**
   * ISO-8601 timestamp of the user's last successful authentication; NULL
   * if we have no presence signal yet. iOS maps this to "Active now" /
   * "5m ago" / "Active yesterday" presence chips.
   */
  last_seen_at: z.string().nullable(),
});

export const PlayersListResponse = z.object({
  items: z.array(PlayerSummarySchema),
});

export const PlayersListQuery = z
  .object({
    q: z.string().min(1).max(80).optional(),
    sport: z.string().optional(),
    min_elo: z.coerce.number().int().min(0).max(4000).optional(),
    max_elo: z.coerce.number().int().min(0).max(4000).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius_km: z.coerce.number().positive().max(200).optional(),
    limit: z.coerce.number().int().positive().max(50).optional(),
    // Restrict results to users the authenticated caller follows. Quietly
    // returns [] for anonymous callers — the filter cannot resolve without
    // an identity.
    following_only: z.coerce.boolean().optional(),
  })
  .refine(
    (q) =>
      (q.lat === undefined && q.lng === undefined && q.radius_km === undefined) ||
      (q.lat !== undefined && q.lng !== undefined && q.radius_km !== undefined),
    { message: "lat, lng and radius_km must all be provided together" },
  );
export type PlayersListQuery = z.infer<typeof PlayersListQuery>;
