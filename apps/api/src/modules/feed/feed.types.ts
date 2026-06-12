import { type FeedEventType, type FeedVisibility } from "../../shared/db/types.js";

/**
 * Shape returned to API clients. Hydrated from `feed_events` rows joined to
 * `users` so the actor display name + photo are baked in. Renderers (iOS)
 * inspect `type` to pick a copy template and pull values from `payload`.
 */
export interface FeedEventOut {
  id: string;
  type: FeedEventType;
  actor: {
    id: string;
    display_name: string;
    photo_url: string | null;
  };
  payload: Record<string, unknown>;
  visibility: FeedVisibility;
  created_at: string;
  /** Total likes on this event. Aggregated from `feed_event_reactions`. */
  likes_count: number;
  /** Whether the calling user has liked this event. Always false for
   *  unauthenticated calls (the feed currently requires auth, so this is
   *  always reliable, but the field is here so the iOS UI doesn't need
   *  a second round-trip to render the heart state). */
  liked_by_me: boolean;
}

export interface FeedPage {
  items: FeedEventOut[];
  next_cursor: string | null;
}

/**
 * Public interface other modules could call to emit feed events synchronously
 * (e.g., the games service could call `emit({ type: 'joined_game', ... })`
 * inside its join transaction). Exposed so we don't have to grow this module
 * later when another agent wants synchronous emission; the polling worker is
 * the fallback path.
 */
export interface FeedEmitter {
  emit(input: EmitFeedEventInput): Promise<void>;
}

export interface EmitFeedEventInput {
  actorUserId: string;
  type: FeedEventType;
  payload?: Record<string, unknown>;
  visibility?: FeedVisibility;
  /**
   * Optional dedupe key. When provided, the row is keyed by
   * (actor, type, sourceKey) via the partial unique index and re-emissions
   * are silently dropped. Use this from the worker for "ratings:<id>"-style
   * idempotency.
   */
  sourceKey?: string;
}
