import { z } from "zod";

/**
 * Shared Zod schemas for the stories routes. Stories are Instagram-style
 * 24-hour ephemeral posts surfaced as round avatars on top of the iOS
 * home page — court photos, match wins, group chat clips.
 *
 * The OpenAPI generator picks these up via `fastify-type-provider-zod`.
 */

export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

export const Empty = z.object({}).strict();

export const StoryMediaType = z.enum(["image", "video"]);
export type StoryMediaType = z.infer<typeof StoryMediaType>;

/**
 * Wave-12 overlay primitives.
 *
 * The composer paints two flavors of non-mention overlay onto a story
 * frame:
 *
 *   - `text`    — a styled text label (caption text, headline). The
 *                 payload carries the rendered string + font / color /
 *                 position state the iOS renderer needs to round-trip
 *                 across views.
 *   - `sticker` — a pictographic element (emoji-style or asset-backed).
 *                 The payload carries the sticker id + transform.
 *
 * The server treats `payload` as opaque (JSONB on disk, `z.record` here)
 * so iOS can evolve its overlay schema independently of the API. A
 * future overlay kind ("poll", "music") is added by extending the enum
 * and shipping a matching iOS renderer — no migration required.
 *
 * Mentions are deliberately NOT in this union: they're a separate
 * `mentions: [{user_id, x, y}]` list at the top level of the create
 * body because the server normalizes them into `story_mentions` for
 * push-fanout + the reverse-lookup index. See `StoryMentionInput`.
 */
export const StoryOverlayKind = z.enum(["text", "sticker"]);
export type StoryOverlayKind = z.infer<typeof StoryOverlayKind>;

export const StoryOverlay = z.object({
  kind: StoryOverlayKind,
  payload: z.record(z.unknown()),
});
export type StoryOverlay = z.infer<typeof StoryOverlay>;

/**
 * Mention overlay input. `x`/`y` are normalized [0..1] frame
 * coordinates — the iOS viewer multiplies them by the rendered frame
 * size to position the tappable chip. The server clamps neither;
 * out-of-range values are rejected at the Zod boundary so a bad
 * client can't poison the table with absurd anchors.
 */
export const StoryMentionInput = z.object({
  user_id: z.string().uuid(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type StoryMentionInput = z.infer<typeof StoryMentionInput>;

/**
 * Wire shape for a mention rendered by the viewer. The server hydrates
 * the mentioned user's `display_name` so the chip can render the
 * label without a second round-trip.
 */
export const StoryMention = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  x: z.number(),
  y: z.number(),
});
export type StoryMention = z.infer<typeof StoryMention>;

/**
 * Allowed reaction emojis on stories. Mirrors the CHECK constraint in
 * `1700000370000_story-reactions.sql` — adding a new emoji needs a
 * migration extending the CHECK list AND a bump to this enum.
 *
 * - `heart` 💜  — the catch-all positive
 * - `fire`  🔥  — "what a shot", clutch wins
 * - `100`   💯  — perfection / agreement
 * - `clap`  👏  — applause, post-match
 * - `padel` 🎾  — domain-flavored cheer (padel court emoji proxy)
 */
export const StoryReactionEmoji = z.enum(["heart", "fire", "100", "clap", "padel"]);
export type StoryReactionEmoji = z.infer<typeof StoryReactionEmoji>;

/**
 * Per-story reaction counts keyed by emoji. Absent keys are zero — the
 * service always returns the full keyset so the iOS reaction bar can
 * render five chips with explicit counts without nil-coalescing.
 */
export const StoryReactionCounts = z.object({
  heart: z.number().int().nonnegative(),
  fire:  z.number().int().nonnegative(),
  "100": z.number().int().nonnegative(),
  clap:  z.number().int().nonnegative(),
  padel: z.number().int().nonnegative(),
});
export type StoryReactionCounts = z.infer<typeof StoryReactionCounts>;

/**
 * Wire shape for a single story. `viewed_by_me` is computed per-viewer
 * (the auth subject) — the same story row reads `true` for the author
 * and any user who has POSTed `/stories/:id/view` at least once.
 *
 * `reactions` is the full per-emoji count map (all five keys present,
 * zero when absent). `my_reaction` is the viewer's own current emoji, or
 * null when the viewer hasn't reacted (or has DELETEd their reaction).
 */
export const StorySchema = z.object({
  id: z.string().uuid(),
  media_url: z.string(),
  media_type: StoryMediaType,
  caption: z.string().nullable(),
  created_at: z.string(),
  viewed_by_me: z.boolean(),
  reactions: StoryReactionCounts,
  my_reaction: StoryReactionEmoji.nullable(),
  /**
   * Wave-12 non-mention overlays (text labels, stickers). Defaults to
   * `[]` on the wire for pre-Wave-12 stories so existing iOS clients
   * keep deserializing the feed without breaking.
   */
  overlays: z.array(StoryOverlay),
  /**
   * Wave-12 mention chips. Empty on stories without tagged users; the
   * iOS viewer hides the chip layer when this is `[]`.
   */
  mentions: z.array(StoryMention),
});
export type Story = z.infer<typeof StorySchema>;

/**
 * Feed entry — one bucket per author. The iOS home page renders the
 * outer ring colored by `has_unviewed`; `latest_story_at` sorts the
 * carousel newest-first.
 */
export const StoriesFeedItemSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  has_unviewed: z.boolean(),
  latest_story_at: z.string(),
  stories: z.array(StorySchema),
});
export type StoriesFeedItem = z.infer<typeof StoriesFeedItemSchema>;

export const StoriesFeedResponse = z.object({
  items: z.array(StoriesFeedItemSchema),
});
export type StoriesFeedResponse = z.infer<typeof StoriesFeedResponse>;

/**
 * `POST /stories` body. `media_url` is the URL returned by the parallel
 * `POST /stories/upload-image` endpoint — clients first upload bytes, then
 * post the URL with optional caption.
 */
export const CreateStoryBody = z.object({
  media_url: z.string().min(1).max(2_048),
  media_type: StoryMediaType,
  caption: z.string().trim().max(500).optional(),
  /**
   * Wave-12 — optional list of text + sticker overlays the composer
   * painted on the frame. Mentions live in the parallel `mentions`
   * field so they can be normalized into `story_mentions` for push
   * fan-out and the reverse-lookup feed. Cap of 32 prevents
   * pathological clients; the iOS composer maxes out at 8 in practice.
   */
  overlays: z.array(StoryOverlay).max(32).optional(),
  /**
   * Wave-12 — optional list of mention chips placed on the frame.
   * Each entry is a `(user_id, x, y)` triple; the server inserts a
   * row into `story_mentions` for each AFTER filtering bidirectional
   * blocks (silently dropped), and emits a `story.mention` push to
   * the successfully-inserted mentioned users. Cap of 16 mirrors
   * the iOS composer limit.
   */
  mentions: z.array(StoryMentionInput).max(16).optional(),
});
export type CreateStoryInput = z.infer<typeof CreateStoryBody>;

/** Created-story shape returned by `POST /stories`. */
export const CreatedStorySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  media_url: z.string(),
  media_type: StoryMediaType,
  caption: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string(),
  view_count: z.number().int().nonnegative(),
  /**
   * Echoed back so the composer can confirm the server accepted what
   * it sent. Defaults to `[]` on the wire when the create body
   * omitted the field; pre-Wave-12 callers see no change.
   */
  overlays: z.array(StoryOverlay),
  /**
   * Mentions that actually landed in the database (post block-filter).
   * The composer compares this list against what it sent to surface a
   * "X user(s) couldn't be tagged" toast when block filtering dropped
   * one or more entries — purely informational.
   */
  mentions: z.array(StoryMention),
});
export type CreatedStory = z.infer<typeof CreatedStorySchema>;

/** Viewer projection — list of users who saw a given story. */
export const StoryViewerSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  viewed_at: z.string(),
});
export type StoryViewer = z.infer<typeof StoryViewerSchema>;

export const StoryViewersResponse = z.object({
  story_id: z.string().uuid(),
  viewers: z.array(StoryViewerSchema),
});
export type StoryViewersResponse = z.infer<typeof StoryViewersResponse>;

export const UploadStoryImageResponse = z.object({
  url: z.string(),
});
export type UploadStoryImageResponse = z.infer<typeof UploadStoryImageResponse>;

/**
 * `POST /stories/:storyId/react` request body. The single `emoji` field is
 * one of the five `StoryReactionEmoji` values; any other value is rejected
 * at the Zod boundary before the service is invoked.
 */
export const StoryReactBody = z.object({
  emoji: StoryReactionEmoji,
});
export type StoryReactInput = z.infer<typeof StoryReactBody>;

/**
 * Wire shape returned by both `POST /react` and `DELETE /react`. After a
 * POST the caller can read `my_reaction` as the emoji they just set; after
 * a DELETE it's always `null`. `reactions` is the fresh aggregate count
 * map so the iOS UI can update without a separate re-fetch.
 */
export const StoryReactionStateResponse = z.object({
  reactions: StoryReactionCounts,
  my_reaction: StoryReactionEmoji.nullable(),
});
export type StoryReactionStateResponse = z.infer<typeof StoryReactionStateResponse>;

/**
 * Wave-13 — body for `POST /api/v1/stories/:id/reply`. Instagram-style
 * "reply to story": the viewer types a message which the server fans
 * out as a 1-to-1 DM to the story author, with the story attached as
 * context. Body is the freeform user text (1..500 chars after trim);
 * the server prefixes "↩ Story reply: " in the persisted message body
 * so the recipient's existing thread renderer surfaces it as a story
 * quote without needing schema changes on the message row.
 */
export const StoryReplyBody = z.object({
  body: z.string().trim().min(1).max(500),
});
export type StoryReplyInput = z.infer<typeof StoryReplyBody>;

/**
 * Wave-13 — response from `POST /api/v1/stories/:id/reply`. Returns
 * enough identifiers for the iOS client to navigate straight into the
 * resulting DM thread on success (deep-link target = the same surface
 * the inbox uses for a manually-opened conversation).
 *
 * - `conversation_id` is stable across replies to multiple stories
 *   from the same author (we resolve via `getOrCreateWith`, which
 *   resurrects an existing 1:1 thread instead of minting a new one).
 * - `message_id` is the freshly-persisted message row id — iOS can
 *   pre-select / scroll-to it when it lands in the thread.
 */
export const StoryReplyResponse = z.object({
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
});
export type StoryReplyResponse = z.infer<typeof StoryReplyResponse>;
