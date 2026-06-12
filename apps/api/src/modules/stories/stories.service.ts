import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { renderPushTemplate } from "../../shared/i18n/index.js";
import { type NotificationsService } from "../social/notifications.service.js";
import { type MessagesService } from "../social/messages.service.js";
import { type RealtimeBus } from "../realtime/realtime.bus.js";
import {
  type CreatedStory,
  type CreateStoryInput,
  type StoriesFeedResponse,
  type StoryMention,
  type StoryOverlay,
  type StoryReactionCounts,
  type StoryReactionEmoji,
  type StoryReactionStateResponse,
  type StoryReplyResponse,
  type StoryViewersResponse,
} from "./stories.schema.js";

export interface StoriesServiceDeps {
  db: DbHandle;
  /** Optional — used to emit a `system` notification (with payload-tagged
   *  `event: "story_react"`) to the story author when someone reacts. The
   *  emit is skipped silently when this dep isn't wired so unit tests can
   *  exercise the reaction CRUD without standing up a notifications stack. */
  notifications?: NotificationsService | undefined;
  /** Optional — used to broadcast a `story:react` SSE event to the story
   *  author + the author's followers so any live viewer of the story
   *  refreshes its reaction counts. Skipped when absent. */
  realtime?: RealtimeBus | undefined;
  /** Wave-13 — required for the "reply to story" flow. The replyToStory
   *  path uses MessagesService.getOrCreateWith() + send() to (a) resolve
   *  the viewer↔author DM thread and (b) deliver the freeform reply body
   *  as a regular 1-to-1 message, inheriting the existing push + SSE
   *  fan-out for free. Optional only so the unit tests for the reaction
   *  paths don't have to stand up a messages stack. */
  messages?: MessagesService | undefined;
}

interface StoryRow {
  id: string;
  user_id: string;
  media_url: string;
  media_type: "image" | "video";
  caption: string | null;
  created_at: Date;
  expires_at: Date;
  view_count: number;
  /**
   * Raw JSONB column. `pg` returns it as the already-parsed JS value
   * (array | object | null), not a string — we normalize through
   * `parseOverlays` defensively.
   */
  overlays: unknown;
}

interface FeedRow {
  id: string;
  user_id: string;
  display_name: string;
  photo_url: string | null;
  media_url: string;
  media_type: "image" | "video";
  caption: string | null;
  created_at: Date;
  viewed_by_me: boolean;
  /** JSON object keyed by emoji → count. Aggregated in-SQL via a lateral
   *  `jsonb_object_agg`, so the wire shape is `{heart: 3, fire: 1, …}` with
   *  ONLY non-zero keys present (we hydrate missing keys to 0 in TS). */
  reactions_json: Record<string, number> | null;
  /** The viewer's own current emoji on this story, or null if they
   *  haven't reacted. */
  my_reaction: StoryReactionEmoji | null;
  /** Raw JSONB overlays column — see `StoryRow.overlays`. */
  overlays: unknown;
  /**
   * Pre-aggregated mention list. The LATERAL subquery joins
   * `story_mentions` against `users` and packs the result as a JSON
   * array of `{user_id, display_name, x, y}` objects. NULL when the
   * story has no surviving mentions (either none were ever added or
   * every mentioned user has been soft-deleted).
   */
  mentions_json: StoryMention[] | null;
}

/**
 * Defensive parser for the JSONB `overlays` column. `pg` typically
 * returns JSONB as the already-decoded JS value, but historical bugs
 * (and string-vs-object inconsistencies across drivers) make it
 * worth tolerating both shapes. Anything that doesn't decode to an
 * array of `{kind, payload}` shapes is coerced to `[]` so the wire
 * Zod schema doesn't reject the feed response.
 */
function parseOverlays(raw: unknown): StoryOverlay[] {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: StoryOverlay[] = [];
  for (const entry of value) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      "kind" in entry &&
      "payload" in entry
    ) {
      const e = entry as { kind: unknown; payload: unknown };
      if (
        (e.kind === "text" || e.kind === "sticker") &&
        e.payload !== null &&
        typeof e.payload === "object" &&
        !Array.isArray(e.payload)
      ) {
        out.push({
          kind: e.kind,
          payload: e.payload as Record<string, unknown>,
        });
      }
    }
  }
  return out;
}

/** All five emoji keys, in the canonical order the iOS reaction bar
 *  renders left-to-right. Used to hydrate the per-story counts map so
 *  every response carries the full keyset. */
const EMOJI_KEYS: readonly StoryReactionEmoji[] = [
  "heart",
  "fire",
  "100",
  "clap",
  "padel",
];

/**
 * Hydrate a sparse `{emoji: count}` map (only non-zero keys) into the dense
 * `StoryReactionCounts` shape that the wire schema requires (every key
 * present, zero when absent). Negative counts are clamped to zero —
 * defensive, the aggregate query can never produce them.
 */
function hydrateReactionCounts(
  sparse: Record<string, number> | null | undefined,
): StoryReactionCounts {
  const out: StoryReactionCounts = {
    heart: 0,
    fire: 0,
    "100": 0,
    clap: 0,
    padel: 0,
  };
  if (!sparse) return out;
  for (const k of EMOJI_KEYS) {
    const v = sparse[k];
    if (typeof v === "number" && v > 0) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * StoriesService — owns CRUD on `stories` + the bucketed feed query.
 *
 * Feed semantics: returns stories from users the viewer follows + the
 * viewer themselves, grouped by author and ordered newest-first. The
 * bidirectional block filter (drop edges in either direction) mirrors the
 * one used by the players list and suggested-follows.
 *
 * `view_count` reflects unique viewers — the `markViewed` path is
 * idempotent via `INSERT ... ON CONFLICT DO NOTHING` and only bumps the
 * counter on rows that actually inserted (the `xmax = 0` trick — see
 * `markViewed` below).
 */
export class StoriesService {
  constructor(private readonly deps: StoriesServiceDeps) {}

  /**
   * Server-generated "system story" for a user — i.e. a story whose
   * `actor_user_id` is the user themselves but whose content originates
   * from a backend agent (Wave-10 weekly recap, future "anniversary"
   * cards, etc.) rather than a user-driven upload.
   *
   * Semantics:
   *   - Persists into the same `stories` table the user-facing `create()`
   *     path uses, so the recap shows up in BOTH the user's own rail and
   *     their followers' rails without any feed-fanout side channel.
   *   - The caller is expected to have pre-uploaded the media bytes (the
   *     weekly-recap sweeper writes a PNG into `${upload_dir}/recap/` and
   *     passes the resulting public URL here).
   *   - Skipped silently when an active (non-expired) recap already
   *     exists for the same author with the well-known
   *     `system_kind: "weekly_recap"` payload — prevents two ticks
   *     racing within the same Sunday window from posting two recap
   *     stories on the same day. Returns `null` in that case so the
   *     sweeper can count the skip.
   *
   * The story carries no special "system" flag in-DB — by design, an
   * idempotency key in the upper sweeper (see `weekly_recap_sent`
   * ledger) is what keeps duplicates out. This method's pre-check is
   * defense-in-depth: if the ledger were dropped, we'd still bail
   * rather than spam the rail.
   */
  async createSystemStory(
    userId: string,
    input: {
      media_url: string;
      caption?: string | null;
      /**
       * Free-form discriminator tag for the upstream caller. Used solely
       * by the caption-based dedupe scan below — passing a stable
       * caption ("Bu həftə padel") doubles as the user-visible label
       * AND the dedupe key, so the helper doesn't need a separate
       * column or a tag table for now.
       */
      dedupe_caption?: string;
    },
  ): Promise<CreatedStory | null> {
    const caption = input.caption ?? null;
    const dedupeKey = input.dedupe_caption ?? caption;

    // Light dedupe: skip when an active story for THIS user with the
    // exact same caption already exists. The 24-hour TTL guarantees the
    // window naturally rolls forward each day, so a weekly recap from
    // last Sunday no longer blocks today's tick.
    if (dedupeKey !== null) {
      const existing = await sql<{ id: string }>`
        SELECT id FROM stories
         WHERE user_id = ${userId}::uuid
           AND caption = ${dedupeKey}
           AND expires_at > NOW()
         LIMIT 1
      `.execute(this.deps.db.db);
      if (existing.rows.length > 0) return null;
    }

    const inserted = await sql<StoryRow>`
      INSERT INTO stories (user_id, media_url, media_type, caption, overlays)
      VALUES (${userId}::uuid, ${input.media_url}, 'image', ${caption}, '[]'::jsonb)
      RETURNING id, user_id, media_url, media_type, caption, created_at, expires_at, view_count, overlays
    `.execute(this.deps.db.db);
    const row = inserted.rows[0];
    if (!row) throw new Error("System story INSERT returned no row");

    return {
      id: row.id,
      user_id: row.user_id,
      media_url: row.media_url,
      media_type: row.media_type,
      caption: row.caption,
      created_at: row.created_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
      view_count: row.view_count,
      // System stories carry no overlays / mentions by construction —
      // the weekly recap is a single rendered PNG with the caption text
      // baked in, not an interactive composer surface.
      overlays: [],
      mentions: [],
    };
  }

  /**
   * Persist a fresh story for the given author. Returns the canonical row
   * including the server-stamped `expires_at` so the iOS client can render
   * a countdown without a second round-trip.
   *
   * Wave-12 additions:
   *   1. `input.overlays` (text + sticker entries) is persisted verbatim
   *      into the JSONB `stories.overlays` column.
   *   2. `input.mentions` is normalized into the `story_mentions` table.
   *      Each mention is first filtered against `user_blocks` in both
   *      directions — a mention pointing at someone the author has
   *      blocked (or vice versa) is silently dropped so the author
   *      can't bypass the block via a story tag. The composer compares
   *      the returned `mentions` against what it sent to decide whether
   *      to show a "couldn't tag X user(s)" toast.
   *   3. For each mention that actually landed in the DB, a
   *      `story.mention` push is dispatched to the mentioned user via
   *      `NotificationsService.emit` (the preferences gate inside
   *      `emit` decides whether APNs fires). Best-effort — a busted
   *      push transport never rolls back the story.
   */
  async create(authorUserId: string, input: CreateStoryInput): Promise<CreatedStory> {
    const caption = input.caption !== undefined && input.caption.length > 0 ? input.caption : null;
    // Persist the JSON array as a single jsonb literal — `JSON.stringify`
    // here is safe because Zod has already validated the shape, and the
    // `::jsonb` cast in the SQL guards against any malformed input the
    // driver might accept silently. `[]` (not `null`) is the canonical
    // empty representation so reads via `parseOverlays` always see an
    // array — keeps the wire schema's non-nullable `overlays` honest.
    const overlaysJson = JSON.stringify(input.overlays ?? []);

    const inserted = await sql<StoryRow>`
      INSERT INTO stories (user_id, media_url, media_type, caption, overlays)
      VALUES (${authorUserId}::uuid, ${input.media_url}, ${input.media_type}, ${caption}, ${overlaysJson}::jsonb)
      RETURNING id, user_id, media_url, media_type, caption, created_at, expires_at, view_count, overlays
    `.execute(this.deps.db.db);

    const row = inserted.rows[0];
    if (!row) throw new Error("Story INSERT returned no row — should be impossible");

    // Fan-out mentions — block filter, INSERT into story_mentions, push.
    const insertedMentions = await this.persistMentions(
      row.id,
      authorUserId,
      input.mentions ?? [],
    );

    return {
      id: row.id,
      user_id: row.user_id,
      media_url: row.media_url,
      media_type: row.media_type,
      caption: row.caption,
      created_at: row.created_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
      view_count: row.view_count,
      overlays: parseOverlays(row.overlays),
      mentions: insertedMentions,
    };
  }

  /**
   * Insert one row per mention into `story_mentions`, dropping any
   * mention whose target is in a bidirectional block with the author
   * (or refers to a soft-deleted / non-existent user). Returns the
   * hydrated `{user_id, display_name, x, y}` shape the composer
   * surfaces back to the user.
   *
   * Then dispatches a `story.mention` push to each successfully-
   * inserted mentioned user. Best-effort: a push failure does not
   * roll back the mention row, and a duplicate mention (same user
   * twice in the input) is folded into a single row via the
   * composite-PK conflict.
   */
  private async persistMentions(
    storyId: string,
    authorUserId: string,
    mentions: readonly { user_id: string; x: number; y: number }[],
  ): Promise<StoryMention[]> {
    if (mentions.length === 0) return [];

    // De-duplicate by user_id while preserving first-seen position —
    // a client that sends two tags for the same user lands a single
    // chip at the first set of coordinates. (The composite PK on
    // story_mentions enforces this server-side anyway; deduping in
    // TS keeps the returned list one-to-one with reality.)
    const seen = new Set<string>();
    const candidates: { user_id: string; x: number; y: number }[] = [];
    for (const m of mentions) {
      if (m.user_id === authorUserId) continue; // self-mention silently dropped
      if (seen.has(m.user_id)) continue;
      seen.add(m.user_id);
      candidates.push(m);
    }
    if (candidates.length === 0) return [];

    // Bidirectional block + soft-delete filter, plus display-name
    // hydration. One query — `unnest` lets us pass the candidate set
    // in parallel arrays for a single round-trip.
    const userIds = candidates.map((c) => c.user_id);
    const allowed = await sql<{ user_id: string; display_name: string }>`
      SELECT u.id AS user_id, u.display_name
        FROM users u
       WHERE u.id = ANY(${userIds}::uuid[])
         AND u.deleted_at IS NULL
         AND NOT EXISTS (
              SELECT 1 FROM user_blocks ub
               WHERE (ub.blocker_user_id = ${authorUserId}::uuid AND ub.blocked_user_id = u.id)
                  OR (ub.blocker_user_id = u.id AND ub.blocked_user_id = ${authorUserId}::uuid)
         )
    `.execute(this.deps.db.db);
    const allowedById = new Map(
      allowed.rows.map((r) => [r.user_id, r.display_name]),
    );

    const survivors: { user_id: string; display_name: string; x: number; y: number }[] = [];
    for (const c of candidates) {
      const displayName = allowedById.get(c.user_id);
      if (displayName === undefined) continue; // blocked, deleted, or non-existent
      survivors.push({ ...c, display_name: displayName });
    }
    if (survivors.length === 0) return [];

    // Bulk insert in one statement via `unnest` of three parallel
    // arrays. ON CONFLICT DO NOTHING covers the (story, user)
    // composite PK collision a retry would otherwise produce.
    const insertUserIds = survivors.map((s) => s.user_id);
    const insertXs = survivors.map((s) => s.x);
    const insertYs = survivors.map((s) => s.y);
    await sql`
      INSERT INTO story_mentions (story_id, mentioned_user_id, x, y)
      SELECT ${storyId}::uuid, u.user_id::uuid, u.x, u.y
        FROM UNNEST(
          ${insertUserIds}::uuid[],
          ${insertXs}::real[],
          ${insertYs}::real[]
        ) AS u(user_id, x, y)
      ON CONFLICT (story_id, mentioned_user_id) DO NOTHING
    `.execute(this.deps.db.db);

    // Push notify each surviving mention — best-effort.
    await this.notifyMentioned(storyId, authorUserId, survivors);

    return survivors.map((s) => ({
      user_id: s.user_id,
      display_name: s.display_name,
      x: s.x,
      y: s.y,
    }));
  }

  /**
   * Emit a `story.mention` notification for each mentioned user.
   *
   * Goes through `NotificationsService.emit` so the in-DB row, the SSE
   * fan-out, and the preferences/quiet-hours gate are all consistent
   * with every other push surface. The push copy lives in
   * `shared/i18n/push.templates.ts` under the `story.mention` key —
   * adding a new locale is a template-file change, no service edit.
   *
   * No `users.locale` column exists yet (see daily-digest.sweeper.ts
   * note), so we render with `null` locale → AZ fallback via
   * `normalizeLocale`. When per-user locale lands we'll plumb it
   * through here.
   *
   * Wrapped in try/catch per recipient so one bad row doesn't poison
   * the rest of the fan-out (mirrors `notifyAuthorOfReaction`).
   */
  private async notifyMentioned(
    storyId: string,
    authorUserId: string,
    mentioned: readonly { user_id: string; display_name: string }[],
  ): Promise<void> {
    if (!this.deps.notifications) return;
    // Look up the author's display name once so every mention banner
    // reads "Aliyev sizi öz story-sində qeyd etdi". One extra query
    // beats N (we already paid for the mentioned-users hydrate).
    const author = await this.deps.db.db
      .selectFrom("users")
      .select("display_name")
      .where("id", "=", authorUserId)
      .executeTakeFirst();
    const mentionerName = author?.display_name ?? "Someone";

    for (const target of mentioned) {
      try {
        const { title, body } = renderPushTemplate(
          "story.mention",
          // Per-user locale not threaded yet — falls back to AZ.
          null,
          { mentioner: mentionerName },
        );
        await this.deps.notifications.emit({
          userId: target.user_id,
          type: "system",
          title,
          body,
          payload: {
            // iOS tap routing: `type` picks the screen, `story_id`
            // deeplinks. Matches the convention story.react uses.
            type: "story.mention",
            event: "story_mention",
            story_id: storyId,
            author_user_id: authorUserId,
            mentioner_name: mentionerName,
          },
        });
      } catch {
        // Best-effort fan-out — a single failed emit must not block
        // the rest, and must not roll back the mention row.
      }
    }
  }

  /**
   * Bucketed feed for the viewer. One SQL round-trip:
   *   - Active stories (expires_at > NOW()) from authors in the viewer's
   *     follows set + the viewer themselves.
   *   - Excluded: stories from users in a bidirectional block with the viewer.
   *   - Excluded: soft-deleted authors.
   *   - LEFT JOIN `story_views` keyed on viewer to compute `viewed_by_me`.
   *   - LEFT JOIN LATERAL aggregate over `story_reactions` to fold the
   *     per-emoji counts into a single `jsonb_object_agg` column.
   *   - LEFT JOIN `story_reactions` keyed on viewer to compute `my_reaction`.
   *
   * Then we bucket in-process (keeps the SQL portable; the result set is
   * tiny — bounded by follows count * stories-per-author, both small in
   * the social-app sense).
   */
  async feedForViewer(viewerUserId: string): Promise<StoriesFeedResponse> {
    // `agg.reactions` comes out of the LATERAL subquery as `jsonb` when
    // at least one reaction exists, NULL otherwise (the GROUP BY produces
    // zero rows for stories with no reactions, so the LEFT JOIN yields
    // NULL). We hydrate NULL → {} in TS via `hydrateReactionCounts`.
    //
    // `mentions.mentions_json` joins `story_mentions` against `users` to
    // pack `(user_id, display_name, x, y)` tuples into a single JSON
    // array per story. Soft-deleted mentioned users are filtered out
    // (the row stays in `story_mentions` — it just doesn't surface in
    // the feed, which matches the "deleted_at hides everywhere" rule
    // applied to authors above). NULL when the story has no surviving
    // mentions; hydrated to `[]` in TS.
    const result = await sql<FeedRow>`
      SELECT s.id,
             s.user_id,
             u.display_name,
             u.photo_url,
             s.media_url,
             s.media_type,
             s.caption,
             s.created_at,
             (sv.viewer_user_id IS NOT NULL) AS viewed_by_me,
             agg.reactions AS reactions_json,
             mine.emoji   AS my_reaction,
             s.overlays   AS overlays,
             mentions.mentions_json AS mentions_json
        FROM stories s
        JOIN users u ON u.id = s.user_id
   LEFT JOIN story_views sv
          ON sv.story_id = s.id
         AND sv.viewer_user_id = ${viewerUserId}::uuid
   LEFT JOIN LATERAL (
          SELECT jsonb_object_agg(r.emoji, r.count) AS reactions
            FROM (
              SELECT emoji, COUNT(*)::int AS count
                FROM story_reactions
               WHERE story_id = s.id
               GROUP BY emoji
            ) r
        ) agg ON TRUE
   LEFT JOIN story_reactions mine
          ON mine.story_id = s.id
         AND mine.user_id = ${viewerUserId}::uuid
   LEFT JOIN LATERAL (
          SELECT jsonb_agg(
                   jsonb_build_object(
                     'user_id', sm.mentioned_user_id,
                     'display_name', mu.display_name,
                     'x', sm.x,
                     'y', sm.y
                   )
                 ) AS mentions_json
            FROM story_mentions sm
            JOIN users mu ON mu.id = sm.mentioned_user_id
           WHERE sm.story_id = s.id
             AND mu.deleted_at IS NULL
        ) mentions ON TRUE
       WHERE s.expires_at > NOW()
         AND u.deleted_at IS NULL
         AND (
              s.user_id = ${viewerUserId}::uuid
           OR s.user_id IN (
                SELECT followed_user_id
                  FROM follows
                 WHERE follower_user_id = ${viewerUserId}::uuid
              )
         )
         AND NOT EXISTS (
              SELECT 1 FROM user_blocks ub
               WHERE (ub.blocker_user_id = ${viewerUserId}::uuid AND ub.blocked_user_id = s.user_id)
                  OR (ub.blocker_user_id = s.user_id AND ub.blocked_user_id = ${viewerUserId}::uuid)
         )
       ORDER BY s.user_id, s.created_at DESC
    `.execute(this.deps.db.db);

    interface Bucket {
      user_id: string;
      display_name: string;
      photo_url: string | null;
      has_unviewed: boolean;
      latest_story_at: Date;
      stories: {
        id: string;
        media_url: string;
        media_type: "image" | "video";
        caption: string | null;
        created_at: Date;
        viewed_by_me: boolean;
        reactions: StoryReactionCounts;
        my_reaction: StoryReactionEmoji | null;
        overlays: StoryOverlay[];
        mentions: StoryMention[];
      }[];
    }
    const buckets = new Map<string, Bucket>();

    for (const r of result.rows) {
      let bucket = buckets.get(r.user_id);
      if (!bucket) {
        bucket = {
          user_id: r.user_id,
          display_name: r.display_name,
          photo_url: r.photo_url,
          has_unviewed: false,
          latest_story_at: r.created_at,
          stories: [],
        };
        buckets.set(r.user_id, bucket);
      }
      bucket.stories.push({
        id: r.id,
        media_url: r.media_url,
        media_type: r.media_type,
        caption: r.caption,
        created_at: r.created_at,
        viewed_by_me: r.viewed_by_me,
        reactions: hydrateReactionCounts(r.reactions_json),
        my_reaction: r.my_reaction,
        overlays: parseOverlays(r.overlays),
        // The jsonb_agg shape already matches `StoryMention`; we only
        // need to handle the NULL-means-empty case.
        mentions: r.mentions_json ?? [],
      });
      if (!r.viewed_by_me) bucket.has_unviewed = true;
      if (r.created_at > bucket.latest_story_at) {
        bucket.latest_story_at = r.created_at;
      }
    }

    // Bucket order: latest story first. Within a bucket, stories already
    // come out newest-first from the SQL `ORDER BY s.user_id, s.created_at DESC`.
    const items = [...buckets.values()]
      .sort((a, b) => b.latest_story_at.getTime() - a.latest_story_at.getTime())
      .map((b) => ({
        user_id: b.user_id,
        display_name: b.display_name,
        photo_url: b.photo_url,
        has_unviewed: b.has_unviewed,
        latest_story_at: b.latest_story_at.toISOString(),
        stories: b.stories.map((s) => ({
          id: s.id,
          media_url: s.media_url,
          media_type: s.media_type,
          caption: s.caption,
          created_at: s.created_at.toISOString(),
          viewed_by_me: s.viewed_by_me,
          reactions: s.reactions,
          my_reaction: s.my_reaction,
          overlays: s.overlays,
          mentions: s.mentions,
        })),
      }));

    return { items };
  }

  /**
   * Record a view from `viewerUserId` against `storyId`. Idempotent:
   * subsequent calls from the same viewer don't bump `view_count`.
   *
   * We use the standard "did I actually INSERT?" trick:
   * `xmax = 0` is true exactly for freshly inserted tuples (xmax tracks the
   * row's last-modifying transaction; INSERTs leave it at 0). On a
   * conflict, `xmax` is set to the conflicting xid, so `xmax = 0` is false
   * — letting us drive a conditional `UPDATE stories SET view_count = ...`
   * from the RETURNING clause without a second round-trip.
   */
  async markViewed(storyId: string, viewerUserId: string): Promise<void> {
    const existing = await this.deps.db.db
      .selectFrom("stories")
      .select(["id", "user_id"])
      .where("id", "=", storyId)
      .where(sql<boolean>`expires_at > NOW()`)
      .executeTakeFirst();
    if (!existing) throw new NotFoundError("Story not found");

    // Author's own views don't bump the counter — they DO insert a
    // story_views row (so the iOS UI can show "viewed by me" symmetrically)
    // but the public `view_count` should reflect OTHER users only.
    const isAuthor = existing.user_id === viewerUserId;

    const insertResult = await sql<{ inserted: boolean }>`
      INSERT INTO story_views (story_id, viewer_user_id)
      VALUES (${storyId}::uuid, ${viewerUserId}::uuid)
      ON CONFLICT (story_id, viewer_user_id) DO NOTHING
      RETURNING (xmax = 0) AS inserted
    `.execute(this.deps.db.db);

    const didInsert = insertResult.rows[0]?.inserted === true;
    if (didInsert && !isAuthor) {
      await sql`
        UPDATE stories
           SET view_count = view_count + 1
         WHERE id = ${storyId}::uuid
      `.execute(this.deps.db.db);
    }
  }

  /**
   * List viewers of a story. Author-only — 403 for everybody else, 404 if
   * the story doesn't exist (expired or never existed).
   */
  async listViewers(
    storyId: string,
    requesterUserId: string,
  ): Promise<StoryViewersResponse> {
    const story = await this.deps.db.db
      .selectFrom("stories")
      .select(["id", "user_id"])
      .where("id", "=", storyId)
      .where(sql<boolean>`expires_at > NOW()`)
      .executeTakeFirst();
    if (!story) throw new NotFoundError("Story not found");
    if (story.user_id !== requesterUserId) {
      throw new ForbiddenError("Only the author can list viewers of this story");
    }

    const rows = await sql<{
      user_id: string;
      display_name: string;
      photo_url: string | null;
      viewed_at: Date;
    }>`
      SELECT u.id AS user_id,
             u.display_name,
             u.photo_url,
             sv.viewed_at
        FROM story_views sv
        JOIN users u ON u.id = sv.viewer_user_id
       WHERE sv.story_id = ${storyId}::uuid
         AND u.deleted_at IS NULL
         AND sv.viewer_user_id <> ${requesterUserId}::uuid
       ORDER BY sv.viewed_at DESC
    `.execute(this.deps.db.db);

    return {
      story_id: storyId,
      viewers: rows.rows.map((r) => ({
        user_id: r.user_id,
        display_name: r.display_name,
        photo_url: r.photo_url,
        viewed_at: r.viewed_at.toISOString(),
      })),
    };
  }

  /**
   * Author-only delete. 404 if the story is already gone (expired or
   * never existed); 403 if a non-author calls.
   */
  async remove(storyId: string, requesterUserId: string): Promise<void> {
    const story = await this.deps.db.db
      .selectFrom("stories")
      .select(["id", "user_id"])
      .where("id", "=", storyId)
      .executeTakeFirst();
    if (!story) throw new NotFoundError("Story not found");
    if (story.user_id !== requesterUserId) {
      throw new ForbiddenError("Only the author can delete this story");
    }
    await this.deps.db.db
      .deleteFrom("stories")
      .where("id", "=", storyId)
      .execute();
  }

  /**
   * Add or REPLACE the caller's reaction on a story. One row per
   * (story_id, user_id) — picking a new emoji overwrites the prior one
   * via `ON CONFLICT (story_id, user_id) DO UPDATE`.
   *
   * Side effects (best-effort, swallowed on failure):
   *   - When the reactor is NOT the story author, emit a `system`
   *     notification to the author (payload `event: "story_react"`).
   *     Skipped silently when no `NotificationsService` is wired.
   *   - Broadcast a `story:react` SSE event to the author and to every
   *     follower of the author. Other viewers refresh their reaction
   *     counts; `my_reaction` is set to null in the broadcast (per-viewer
   *     state is not the broadcaster's to know).
   *
   * 404 when the story is expired or doesn't exist. Blocks are NOT
   * enforced here — the feed query already filters story rows visible to
   * the reactor, so a reactor exercising the endpoint against a hidden
   * story is using a stale id and the 404 is the right answer (we don't
   * leak existence to a block target via 403).
   */
  async react(
    storyId: string,
    reactorUserId: string,
    emoji: StoryReactionEmoji,
  ): Promise<StoryReactionStateResponse> {
    const story = await this.deps.db.db
      .selectFrom("stories")
      .select(["id", "user_id"])
      .where("id", "=", storyId)
      .where(sql<boolean>`expires_at > NOW()`)
      .executeTakeFirst();
    if (!story) throw new NotFoundError("Story not found");

    // Detect whether THIS call changed the user's reaction (a brand-new
    // emoji or a switch from a different one). Only fire the author
    // notification on a meaningful change so a client retrying the same
    // POST doesn't push-spam the author.
    const prior = await sql<{ emoji: StoryReactionEmoji }>`
      SELECT emoji
        FROM story_reactions
       WHERE story_id = ${storyId}::uuid
         AND user_id  = ${reactorUserId}::uuid
    `.execute(this.deps.db.db);
    const priorEmoji = prior.rows[0]?.emoji ?? null;
    const changed = priorEmoji !== emoji;

    await sql`
      INSERT INTO story_reactions (story_id, user_id, emoji)
      VALUES (${storyId}::uuid, ${reactorUserId}::uuid, ${emoji})
      ON CONFLICT (story_id, user_id)
      DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()
    `.execute(this.deps.db.db);

    const state = await this.loadReactionState(storyId, reactorUserId);

    // Push notification to the author — only on meaningful change AND
    // when the reactor isn't the author themselves. Self-reactions are
    // accepted (the row goes in, the counts update) but we don't push.
    if (changed && story.user_id !== reactorUserId) {
      await this.notifyAuthorOfReaction(story.user_id, reactorUserId, storyId, emoji);
    }

    // Realtime fan-out so any open viewer of this story updates counts.
    // `my_reaction: null` in the broadcast — see the docstring above.
    await this.broadcastStoryReact(story.user_id, storyId, state.reactions);

    return state;
  }

  /**
   * Remove the caller's reaction on a story. Idempotent — DELETEing when
   * no row exists is a no-op (still returns the current state). 404 only
   * when the story itself is gone.
   */
  async unreact(
    storyId: string,
    reactorUserId: string,
  ): Promise<StoryReactionStateResponse> {
    const story = await this.deps.db.db
      .selectFrom("stories")
      .select(["id", "user_id"])
      .where("id", "=", storyId)
      .where(sql<boolean>`expires_at > NOW()`)
      .executeTakeFirst();
    if (!story) throw new NotFoundError("Story not found");

    await sql`
      DELETE FROM story_reactions
       WHERE story_id = ${storyId}::uuid
         AND user_id  = ${reactorUserId}::uuid
    `.execute(this.deps.db.db);

    const state = await this.loadReactionState(storyId, reactorUserId);
    // `my_reaction` in the response is guaranteed to be null here (we
    // just deleted that exact row); the type covers it as nullable so no
    // narrowing assertion is needed.
    await this.broadcastStoryReact(story.user_id, storyId, state.reactions);
    return state;
  }

  /**
   * Read the current reaction state for one story from the viewer's PoV.
   * Two cheap aggregates: a GROUP BY for the per-emoji counts and a
   * single-row lookup for `my_reaction`. Used by `react`/`unreact` and
   * (indirectly) by the broadcast helper.
   */
  private async loadReactionState(
    storyId: string,
    viewerUserId: string,
  ): Promise<StoryReactionStateResponse> {
    const counts = await sql<{ emoji: StoryReactionEmoji; count: string }>`
      SELECT emoji, COUNT(*)::text AS count
        FROM story_reactions
       WHERE story_id = ${storyId}::uuid
       GROUP BY emoji
    `.execute(this.deps.db.db);
    const sparse: Record<string, number> = {};
    for (const row of counts.rows) {
      sparse[row.emoji] = Number.parseInt(row.count, 10);
    }

    const mine = await sql<{ emoji: StoryReactionEmoji }>`
      SELECT emoji
        FROM story_reactions
       WHERE story_id = ${storyId}::uuid
         AND user_id  = ${viewerUserId}::uuid
    `.execute(this.deps.db.db);

    return {
      reactions: hydrateReactionCounts(sparse),
      my_reaction: mine.rows[0]?.emoji ?? null,
    };
  }

  /**
   * Best-effort author notification. Looks up the reactor's display name
   * so the body copy reads "${name} reacted ${emoji} to your story" on
   * the iOS banner. Wrapped in try/catch — a busted notifications stack
   * must NOT roll back the reaction write.
   *
   * The DB notification row uses `type: "system"` because the
   * `NotificationType` enum doesn't yet include a `story.react` member;
   * the payload's `event: "story_react"` discriminator + `type: "story.react"`
   * key let iOS route consistently with the spec.
   */
  private async notifyAuthorOfReaction(
    authorUserId: string,
    reactorUserId: string,
    storyId: string,
    emoji: StoryReactionEmoji,
  ): Promise<void> {
    if (!this.deps.notifications) return;
    try {
      const reactor = await this.deps.db.db
        .selectFrom("users")
        .select("display_name")
        .where("id", "=", reactorUserId)
        .executeTakeFirst();
      const reactorName = reactor?.display_name ?? "Someone";
      await this.deps.notifications.emit({
        userId: authorUserId,
        type: "system",
        title: "New story reaction",
        body: `${reactorName} reacted ${emoji} to your story`,
        payload: {
          // iOS tap routing reads `type` first to pick the screen, then
          // `story_id` to deeplink. The `event` key matches the same
          // convention `follows.service.ts` uses for follow events.
          type: "story.react",
          event: "story_react",
          story_id: storyId,
          reactor_user_id: reactorUserId,
          reactor_name: reactorName,
          emoji,
        },
      });
    } catch {
      // Best-effort — never break the reaction write on a notification
      // hiccup. The notification row is already committed (or wasn't),
      // and the reaction itself is durable either way.
    }
  }

  /**
   * Wave-13 — Instagram-style "reply to story". The viewer types a
   * message which lands in a 1-to-1 DM thread between viewer and
   * author, with the story attached as quoted context.
   *
   * Pipeline:
   *   1. Auth + visibility — the story must exist, not be expired, and
   *      the viewer must not be in a bidirectional block with the
   *      author (the feed query enforces this on the read path; we
   *      re-check here so a stale id from a third-party endpoint can't
   *      bypass it).
   *   2. Resolve or create the DM conversation via
   *      `MessagesService.getOrCreateWith(viewer, author)`. Existing
   *      threads are reused (idempotent re-DM); a freshly-minted thread
   *      gets the viewer + author rows in `conversation_participants`.
   *   3. Build the message body with a sentinel prefix
   *      ("↩ Story reply: <text>") so the existing inbox renderer
   *      surfaces a quote affordance without a schema migration on the
   *      `messages` table. The trimmed body is server-validated for
   *      1..500 chars before this method is invoked (route layer).
   *   4. Delegate the actual insert to `MessagesService.send()` — this
   *      gives us the existing push notification + SSE fan-out + the
   *      conversation `last_message_at` update for free. The push title
   *      reads "{viewer_name} story-yə cavab verdi" via the body preview
   *      truncation already baked into `send()`.
   *
   * Self-reply (viewer == author) is a 400 — there's no real DM thread
   * with yourself and the iOS composer hides itself on owner stories.
   *
   * Returns the `(conversation_id, message_id)` pair so the iOS client
   * can navigate into the freshly-populated thread on success.
   */
  async replyToStory(
    storyId: string,
    viewerUserId: string,
    rawBody: string,
  ): Promise<StoryReplyResponse> {
    if (!this.deps.messages) {
      // Dep is optional only for the unit-test surface that exercises
      // reactions. The route layer asserts the wiring at startup; if we
      // ever land here in prod it's an internal misconfig.
      throw new Error(
        "StoriesService.replyToStory: messages dep is not wired",
      );
    }

    // Body normalization — also enforced at the Zod boundary, but
    // duplicated here so a future caller that bypasses the route layer
    // can't poison the messages table with empty/oversize content.
    const trimmed = rawBody.trim();
    if (trimmed.length === 0) {
      throw new ValidationError("Reply body must not be empty");
    }
    if (trimmed.length > 500) {
      throw new ValidationError("Reply body must be 500 chars or fewer");
    }

    // Resolve the story + author. 404 when expired or never existed —
    // we use the same predicate as the reaction path so a viewer can't
    // probe for the existence of an expired story via a 403 response.
    const story = await this.deps.db.db
      .selectFrom("stories")
      .select(["id", "user_id"])
      .where("id", "=", storyId)
      .where(sql<boolean>`expires_at > NOW()`)
      .executeTakeFirst();
    if (!story) throw new NotFoundError("Story not found");

    if (story.user_id === viewerUserId) {
      // Replying to your own story is meaningless — the iOS composer
      // already hides itself on owner stories. A 400 is the honest
      // answer for a third-party caller; we don't want to silently
      // mint a self-thread.
      throw new ValidationError("Cannot reply to your own story");
    }

    // Bidirectional block filter — symmetric with the feed query and
    // the mention-fanout filter. A 404 here (not 403) keeps the block
    // target opaque: the viewer learns "story not found" rather than
    // "you are blocked", matching the existing block-leak posture.
    const blocked = await this.deps.db.db
      .selectFrom("user_blocks")
      .select("blocker_user_id")
      .where((eb) =>
        eb.or([
          eb.and([
            eb("blocker_user_id", "=", viewerUserId),
            eb("blocked_user_id", "=", story.user_id),
          ]),
          eb.and([
            eb("blocker_user_id", "=", story.user_id),
            eb("blocked_user_id", "=", viewerUserId),
          ]),
        ]),
      )
      .executeTakeFirst();
    if (blocked) throw new NotFoundError("Story not found");

    // Resolve (or resurrect) the 1:1 DM thread. `getOrCreateWith` is
    // idempotent; a second reply to the same author re-uses the same
    // conversation_id so the recipient sees a single growing thread
    // rather than N parallel ones — matches Instagram behavior.
    const conversationId = await this.deps.messages.getOrCreateWith(
      viewerUserId,
      story.user_id,
    );

    // Sentinel-prefixed body. The "↩ Story reply:" marker is plain
    // text on purpose so older iOS builds (pre-Wave-13) still render
    // it readably in the inbox; a future iOS update can detect the
    // prefix and swap in a richer story-quote card. We don't store
    // a separate `metadata` JSONB column to keep this change zero-
    // migration — the existing `messages.body` column carries the
    // signal.
    const persistedBody = `↩ Story reply: ${trimmed}`;

    // Delegate to MessagesService.send which already:
    //   - validates participation (viewer was just inserted as a
    //     participant so this is a no-op rather than a 403)
    //   - inserts the row, returning the canonical message
    //   - fires a `message_received` notification to the recipient
    //     with the body preview (truncated to 80 chars by send())
    //   - publishes a `message` SSE event on the recipient's stream
    //     so any open inbox / thread view live-updates without a poll
    const sent = await this.deps.messages.send(
      viewerUserId,
      conversationId,
      { body: persistedBody },
    );

    return {
      conversation_id: conversationId,
      message_id: sent.id,
    };
  }

  /**
   * Broadcast a `story:react` SSE event to the author + the author's
   * followers so any live viewer rerenders the reaction counts. Bidir
   * blocks are filtered at the SQL layer so we never publish to a
   * follower the author has since blocked (or vice versa) — matches
   * the predicate used by `broadcastStoryPosted` in `stories-realtime.ts`.
   *
   * `my_reaction: null` in the data payload because per-viewer state is
   * not the broadcaster's to know — iOS re-fetches `/stories/feed` or
   * relies on the POST/DELETE response for its own `my_reaction` value.
   */
  private async broadcastStoryReact(
    authorUserId: string,
    storyId: string,
    reactions: StoryReactionCounts,
  ): Promise<void> {
    if (!this.deps.realtime) return;
    const realtime = this.deps.realtime;
    const data = {
      story_id: storyId,
      reactions,
      my_reaction: null,
    };

    // Always notify the author so their viewers-list / dashboard updates
    // even when they're not in their own followers list.
    realtime.publish(authorUserId, { kind: "story:react", data });

    try {
      const result = await sql<{ follower_user_id: string }>`
        SELECT f.follower_user_id
          FROM follows f
          JOIN users u ON u.id = f.follower_user_id
         WHERE f.followed_user_id = ${authorUserId}::uuid
           AND u.deleted_at IS NULL
           AND NOT EXISTS (
                SELECT 1 FROM user_blocks ub
                 WHERE (ub.blocker_user_id = ${authorUserId}::uuid AND ub.blocked_user_id = f.follower_user_id)
                    OR (ub.blocker_user_id = f.follower_user_id AND ub.blocked_user_id = ${authorUserId}::uuid)
           )
      `.execute(this.deps.db.db);
      for (const row of result.rows) {
        if (row.follower_user_id === authorUserId) continue;
        realtime.publish(row.follower_user_id, { kind: "story:react", data });
      }
    } catch {
      // Realtime is best-effort fan-out. A broken follower lookup must
      // not roll back the reaction; iOS will catch up on the next feed
      // poll. Logging stays out of scope — service has no logger dep yet.
    }
  }
}
