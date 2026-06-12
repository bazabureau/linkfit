import { type ColumnType, type Generated } from "kysely";

/**
 * Kysely Database interface. Grown per module — each new table extends this.
 *
 * Conventions:
 *  - `Generated<T>`: column the DB fills in (defaults, triggers).
 *  - `ColumnType<Select, Insert, Update>`: timestamps come back as Date but
 *    insert accepts string | Date.
 *  - `null` is explicit on nullable columns; we don't fudge with optionals.
 */

export type AdminRole = "admin" | "moderator" | "partner";

export interface UserTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  display_name: string;
  photo_url: string | null;
  home_lat: string | null; // numeric(9,6) — pg returns as string
  home_lng: string | null;
  admin_role: ColumnType<AdminRole | null, AdminRole | null | undefined, AdminRole | null>;
  venue_id: ColumnType<string | null, string | null | undefined, string | null>;
  birth_date: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  email_verified_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  /**
   * Per-user shareable code (6 chars, ambiguity-free alphabet). NOT NULL in
   * the DB but typed as nullable here because the service lazily fills the
   * value the first time `codeFor()` runs after a brand-new sign-up. See
   * `ReferralsService` (modules/referrals).
   */
  referral_code: ColumnType<string | null, string | null | undefined, string | null>;
  /**
   * Wave-10 referrals expansion. `referred_by_user_id` is the user whose
   * code this account redeemed at signup (nullable for organic sign-ups
   * and pre-Wave-10 accounts). `referral_count` is the lifetime tally of
   * accounts that came in through this user's code — denormalized from
   * the `referrals` ledger so the dashboard count badge reads in a single
   * row fetch. See migration `1700000382000_referrals.sql`.
   */
  referred_by_user_id: ColumnType<string | null, string | null | undefined, string | null>;
  referral_count: ColumnType<number, number | undefined, number>;
  /**
   * Quiet hours (UTC). Either both NULL (no quiet window) or both set
   * (window may wrap midnight). Enforced by a DB CHECK constraint so
   * the service layer can read these without a "half-set" branch.
   */
  quiet_hours_start: ColumnType<number | null, number | null | undefined, number | null>;
  quiet_hours_end: ColumnType<number | null, number | null | undefined, number | null>;
  /**
   * IANA time zone (e.g. "Asia/Baku", "Europe/London"). Used by the Wave-10
   * daily-digest sweeper to decide whether the user's local clock is at
   * 18:00 — the only hour the digest fires. DEFAULT 'Asia/Baku' matches
   * Linkfit's primary market, so existing rows backfill correctly without
   * touching application code.
   */
  time_zone: ColumnType<string, string | undefined, string>;
  /**
   * Per-user opt-out for the daily-digest push (Wave-10). Lives outside
   * `notification_preferences` because the digest isn't one of the eight
   * `notification_type` enum values — adding it would force a cross-cutting
   * PG enum migration. Defaults to `true` so engagement wins out-of-the-box;
   * the user can flip it off from the settings screen.
   */
  daily_digest_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  /**
   * Last time we saw the user authenticate to the API. Refreshed by the auth
   * guard on a debounced (60s) cadence — see `apps/api/src/shared/auth/guard.ts`.
   * Surfaced on `PlayerSummary` and `PublicProfile` so the iOS UI can render
   * "Active now" / "5m ago" presence chips. Nullable: existing rows backfilled
   * to NOW() on migration, but new INSERTs that don't set it (tests, fixtures)
   * legitimately have no signal yet.
   */
  last_seen_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  /**
   * Trust & safety: set to TRUE by `shared/security/spam-checks.ts` when
   * the user trips a suspicious-pattern detector (e.g. follow burst). Does
   * NOT block the account — admins triage from the partial index added in
   * migration 1700000381000. The follow service reads this column to
   * decide whether to silently rate-limit further high-frequency actions.
   */
  flagged_for_review: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<Date, Date | string | undefined, never>;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

// === Trust & safety ===
// Append-only log of registration attempts keyed on source IP. Read inside
// the `checkSignupAllowed()` gate to count attempts in the trailing 24h
// window; written on every register hit (success or not — counting the
// attempt itself is the whole point of rate-limiting). See migration
// 1700000381000 and `shared/security/spam-checks.ts`.
export interface SignupAttemptTable {
  ip: string;
  attempted_at: ColumnType<Date, Date | string | undefined, never>;
}

// === Referrals agent ===
// Friend-referral system. `users.referral_code` (above) is the canonical
// shareable code; `referrals` is the redemption ledger keyed on the
// referee so each new account can be referred at most once.
export interface ReferralTable {
  referee_user_id: string;
  referrer_user_id: string;
  code_used: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// === Email agent ===
// Single-purpose magic-link token table. `kind` partitions the table into
// the two flows the email module owns; `token_hash` is the sha256 of the
// raw token we mail out. See `apps/api/src/modules/email/` for the full
// life-cycle (issue → mail → verify/consume).
export type EmailTokenKind = "verify" | "reset_password";

export interface EmailTokenTable {
  id: Generated<string>;
  user_id: string;
  kind: EmailTokenKind;
  token_hash: Buffer;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  used_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface RefreshTokenTable {
  id: Generated<string>;
  user_id: string;
  token_hash: Buffer;
  family_id: string;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  revoked_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  replaced_by: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  // === Session metadata (migration 1700000310000) ===
  // Free-form UA string captured from the request header at mint time.
  // NULL for rows minted before the migration, or when the caller didn't
  // supply a User-Agent. Drives the "Logged-in devices" screen.
  user_agent: ColumnType<string | null, string | null | undefined, string | null>;
  // Updated to NOW() on every successful refresh that consumes this row
  // (and stamped at mint time so the list shows a sensible "last active"
  // even for sessions that never refreshed).
  last_used_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface SportTable {
  id: Generated<string>;
  slug: string;
  name: string;
  min_players: number;
  max_players: number;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface VenueTable {
  id: Generated<string>;
  name: string;
  address: string;
  lat: string; // numeric(9,6)
  lng: string;
  owner_user_id: string | null;
  is_partner: Generated<boolean>;
  phone: string | null;
  description: string | null;
  photo_url: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface CourtTable {
  id: Generated<string>;
  venue_id: string;
  sport_id: string;
  name: string;
  hourly_price_minor: number;
  currency: Generated<string>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export type GameStatus = "open" | "full" | "cancelled" | "completed";
export type GameVisibility = "public" | "invite";
export type ParticipantStatus = "confirmed" | "cancelled" | "no_show" | "played";

export interface GameTable {
  id: Generated<string>;
  sport_id: string;
  court_id: string | null;
  host_user_id: string;
  lat: string;
  lng: string;
  starts_at: ColumnType<Date, Date | string, Date | string>;
  duration_minutes: number;
  capacity: number;
  skill_min_elo: number | null;
  skill_max_elo: number | null;
  visibility: Generated<GameVisibility>;
  status: Generated<GameStatus>;
  notes: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<Date, Date | string | undefined, never>;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface GameParticipantTable {
  game_id: string;
  user_id: string;
  joined_at: Generated<Date>;
  status: Generated<ParticipantStatus>;
  status_changed_at: Generated<Date>;
}

export type RatingOutcome = "win" | "loss" | "draw";

export interface RatingTable {
  id: Generated<string>;
  game_id: string;
  rater_user_id: string;
  rated_user_id: string;
  sport_id: string;
  outcome: RatingOutcome;
  behavior_ok: boolean;
  processed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface PlayerSportStatsTable {
  user_id: string;
  sport_id: string;
  elo_rating: Generated<number>;
  games_played: Generated<number>;
  games_won: Generated<number>;
  reliability_score: Generated<number>;
  last_recalc_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  updated_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface AuditLogTable {
  id: Generated<string>;
  actor_user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  metadata: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, Record<string, unknown>>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export type BookingStatus =
  | "pending_payment"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "refunded"
  | "failed";

export type PaymentSplitStatus =
  | "pending"
  | "authorized"
  | "captured"
  | "refunded"
  | "failed";

export interface BookingTable {
  id: Generated<string>;
  game_id: string | null;
  court_id: string;
  user_id: string;
  starts_at: ColumnType<Date, Date | string, Date | string>;
  duration_minutes: number;
  total_minor: number;
  currency: string;
  status: ColumnType<BookingStatus, BookingStatus | undefined, BookingStatus>;
  idempotency_key: string;
  external_ref: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<Date, Date | string | undefined, never>;
  paid_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  cancelled_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface PaymentSplitTable {
  id: Generated<string>;
  booking_id: string;
  user_id: string;
  amount_minor: number;
  status: Generated<PaymentSplitStatus>;
  external_ref: string | null;
  paid_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  refunded_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<Date, Date | string | undefined, never>;
}

export type NotificationType =
  | "game_joined" | "game_cancelled" | "game_reminder"
  | "no_show_marked" | "rating_received" | "tournament_invite"
  | "message_received" | "system";

export interface NotificationTable {
  id: Generated<string>;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, Record<string, unknown>>;
  read_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// === Notification preferences ===
// Sparse: row exists ONLY when the user has overridden the application
// default for that (user, type) pair. Absent rows are treated as
// "use default" by the lookup, which keeps the table small and makes
// default-policy changes a code change instead of a backfill.
export interface NotificationPreferenceTable {
  user_id: string;
  type: NotificationType;
  push_enabled: boolean;
  email_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  in_app_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  // Writable so the upsert path can stamp it explicitly; the migration
  // also sets DEFAULT now() so INSERT-without-set still gets a sane value.
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export type ConversationKind = "direct" | "group";

export interface ConversationTable {
  id: Generated<string>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  last_message_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  // Added by migration 1700000009100 — group-chat extension. Existing 1:1 DM
  // rows default to 'direct'; new tournament/game group threads use 'group'
  // with `title`/`game_id`/`tournament_id` populated.
  kind: Generated<ConversationKind>;
  title: ColumnType<string | null, string | null | undefined, string | null>;
  game_id: ColumnType<string | null, string | null | undefined, string | null>;
  tournament_id: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface ConversationParticipantTable {
  conversation_id: string;
  user_id: string;
  last_read_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  // Soft-delete column populated by DELETE /api/v1/conversations/:id.
  // Set to NOW() when the participant leaves their inbox; the conversation
  // list query filters `WHERE left_at IS NULL` so the row is hidden from
  // THIS user without affecting the counterparty's view. Kept (not row-
  // deleted) so `getOrCreateWith` can resurrect via UPDATE rather than
  // colliding on the (conversation_id, user_id) PK.
  left_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export type MessageAttachmentType = "image" | "voice";

export interface MessageTable {
  id: Generated<string>;
  conversation_id: string;
  sender_user_id: string;
  body: string;
  attachment_url: ColumnType<string | null, string | null | undefined, string | null>;
  attachment_type: ColumnType<MessageAttachmentType | null, MessageAttachmentType | null | undefined, MessageAttachmentType | null>;
  attachment_meta: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null | undefined, Record<string, unknown> | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface FollowTable {
  follower_user_id: string;
  followed_user_id: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// === User blocks (FAZA 61.5) ===
// Composite PK (blocker, blocked) enforces idempotent block. CHECK in the
// migration guards against self-blocks. We keep a reverse-lookup index on
// `blocked_user_id` for the "who blocked me?" query.
export interface UserBlockTable {
  blocker_user_id: string;
  blocked_user_id: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export type ReportTargetKind = "user" | "game" | "message" | "story" | "feed_comment";
export type ReportStatus = "pending" | "reviewed" | "dismissed";
export type ReportReason =
  | "spam"
  | "harassment"
  | "no_show"
  | "fake_profile"
  | "inappropriate_content"
  | "other";

export interface ReportTable {
  id: Generated<string>;
  reporter_user_id: string;
  target_kind: ReportTargetKind;
  target_id: string;
  reason: ReportReason;
  status: Generated<ReportStatus>;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
  reviewed_by_user_id: ColumnType<string | null, string | null | undefined, string | null>;
  reviewed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export type TournamentStatus =
  | "announced" | "registration_open" | "registration_closed"
  | "in_progress" | "completed" | "cancelled";

export interface TournamentTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  sport_id: string;
  venue_id: string | null;
  starts_at: ColumnType<Date, Date | string, Date | string>;
  ends_at: ColumnType<Date, Date | string, Date | string>;
  registration_deadline: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  max_squads: number;
  squad_size: number;
  entry_fee_minor: Generated<number>;
  currency: Generated<string>;
  status: Generated<TournamentStatus>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface TournamentEntryTable {
  id: Generated<string>;
  tournament_id: string;
  captain_user_id: string;
  squad_name: string;
  player_ids: string[];
  status: Generated<string>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export type GameInvitationStatus = "pending" | "accepted" | "declined" | "expired";

export interface GameInvitationTable {
  id: Generated<string>;
  game_id: string;
  inviter_user_id: string;
  invitee_user_id: string;
  status: Generated<GameInvitationStatus>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  responded_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export type DevicePlatform = "ios" | "android";

export interface DeviceTokenTable {
  id: Generated<string>;
  user_id: string;
  token: string;
  platform: DevicePlatform;
  last_seen: ColumnType<Date, Date | string | undefined, Date | string>;
  revoked_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// === Feed agent ===
// Activity feed tables. `feed_events` is an append-only log written by the
// fan-out worker (`feed.worker.ts`) and read by `GET /api/v1/feed`.
// `feed_cursor` is a key/value bag that stores the worker's high-water mark
// per source — see `feed.worker.ts` for the mutation pattern.

export type FeedEventType =
  | "joined_game"
  | "won_match"
  | "registered_tournament"
  | "elo_milestone"
  | "followed_user"
  | "new_partnership";

export type FeedVisibility = "public" | "followers" | "private";

export interface FeedEventTable {
  id: Generated<string>;
  actor_user_id: string;
  type: FeedEventType;
  payload: ColumnType<
    Record<string, unknown>,
    Record<string, unknown> | undefined,
    Record<string, unknown>
  >;
  visibility: Generated<FeedVisibility>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface FeedCursorTable {
  source: string;
  watermark: ColumnType<Date, Date | string, Date | string>;
  updated_at: ColumnType<Date, Date | string | undefined, never>;
}

// === Medical agent ===
// Optional health / emergency info displayed to a game host if a player gets
// hurt during a match. Every text column is stored as `bytea` so the medical
// service can transparently switch between AES-256-GCM ciphertext and raw
// UTF-8 plaintext depending on whether `MEDICAL_ENCRYPTION_KEY` is set —
// no schema change required when encryption is enabled later.
//
// `share_medical_with_host` is the opt-in flag the host summary endpoint
// consults. It defaults to `false` so a freshly inserted profile never
// leaks data; the user must explicitly enable sharing.

export interface MedicalProfileTable {
  user_id: string;
  blood_type: ColumnType<Buffer | null, Buffer | null | undefined, Buffer | null>;
  allergies: ColumnType<Buffer | null, Buffer | null | undefined, Buffer | null>;
  conditions: ColumnType<Buffer | null, Buffer | null | undefined, Buffer | null>;
  medications: ColumnType<Buffer | null, Buffer | null | undefined, Buffer | null>;
  emergency_contact_name: ColumnType<Buffer | null, Buffer | null | undefined, Buffer | null>;
  emergency_contact_phone: ColumnType<Buffer | null, Buffer | null | undefined, Buffer | null>;
  share_medical_with_host: ColumnType<boolean, boolean | undefined, boolean>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

// === Medical agent — tournament waivers ===
// Append-only ledger of waiver acknowledgments. Composite PK makes
// double-signing a no-op via `ON CONFLICT DO NOTHING`. `ip` and
// `user_agent` are stored as evidence; both nullable for tests / replays.

export interface TournamentWaiverTable {
  tournament_id: string;
  user_id: string;
  signed_at: ColumnType<Date, Date | string | undefined, never>;
  ip: ColumnType<string | null, string | null | undefined, string | null>;
  user_agent: ColumnType<string | null, string | null | undefined, string | null>;
}

// === Achievements agent ===
// Catalog of unlockable badges + per-user unlock ledger. The `criteria`
// payload is a small JSON DSL the AchievementsService interprets. Composite
// PK (user_id, achievement_slug) makes ON CONFLICT DO NOTHING the natural
// "idempotent insert" idiom.

export interface AchievementTable {
  id: Generated<string>;
  slug: string;
  name: string;
  description: string;
  icon_name: string;
  criteria: ColumnType<
    Record<string, unknown>,
    Record<string, unknown> | undefined,
    Record<string, unknown>
  >;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface UserAchievementTable {
  user_id: string;
  achievement_slug: string;
  unlocked_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

// === Stripe payments agent ===
// `stripe_customers` maps Linkfit user_id -> Stripe customer id so we can
// attach the same Customer across multiple PaymentIntents (gives PaymentSheet
// stable cards in the future). `tournament_entry_payments` materializes the
// "user paid but the entry row doesn't exist yet" intermediate state — the
// webhook flips status from `pending` to `succeeded` and inserts the
// underlying tournament_entries row inside one transaction.

export interface StripeCustomerTable {
  user_id: string;
  stripe_customer_id: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<Date, Date | string | undefined, never>;
}

export type TournamentEntryPaymentStatus = "pending" | "succeeded" | "failed";

export interface TournamentEntryPaymentTable {
  id: Generated<string>;
  tournament_id: string;
  captain_user_id: string;
  payment_intent_id: string;
  amount_minor: number;
  currency: string;
  squad_name: string;
  player_ids: string[];
  status: Generated<TournamentEntryPaymentStatus>;
  entry_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<Date, Date | string | undefined, never>;
  succeeded_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface StripeWebhookEventTable {
  id: string;
  type: string;
  processed_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

// === Membership agent ===
// Per-user tier row. The Payments agent owns booking + tournament Stripe
// flows; Membership owns recurring subscription billing on a separate set
// of Stripe identifiers so neither cross-writes the other's columns.

export type MembershipTier = "free" | "plus" | "premium";

export interface MembershipTable {
  user_id: string;
  tier: ColumnType<MembershipTier, MembershipTier | undefined, MembershipTier>;
  stripe_customer_id: ColumnType<string | null, string | null | undefined, string | null>;
  stripe_subscription_id: ColumnType<string | null, string | null | undefined, string | null>;
  current_period_end: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  cancel_at_period_end: ColumnType<boolean, boolean | undefined, boolean>;
  updated_at: ColumnType<Date, Date | string | undefined, never>;
}

// === Scoring agent ===
// Live-during-the-match scoring (padel: 0/15/30/40 → game; first to 6 games
// with 2-game lead else tiebreak at 6-6; best of 3 sets). One row per game;
// `sets` is jsonb so the shape can grow without another migration. Point
// state for the in-progress game lives in `point_a` / `point_b`.

export type MatchScoreStatus = "in_progress" | "completed";

export interface MatchScoreSetJson {
  a: number;
  b: number;
  tb?: { a: number; b: number };
}

export interface MatchScoreTable {
  game_id: string;
  team_a_user_ids: string[];
  team_b_user_ids: string[];
  sets: ColumnType<
    MatchScoreSetJson[],
    MatchScoreSetJson[] | string | undefined,
    MatchScoreSetJson[] | string
  >;
  points: ColumnType<
    ("a" | "b")[],
    ("a" | "b")[] | string | undefined,
    ("a" | "b")[] | string
  >;
  current_set: Generated<number>;
  current_game_a: Generated<number>;
  current_game_b: Generated<number>;
  point_a: Generated<number>;
  point_b: Generated<number>;
  status: Generated<MatchScoreStatus>;
  started_at: ColumnType<Date, Date | string | undefined, Date | string>;
  completed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  updated_at: ColumnType<Date, Date | string | undefined, never>;
  // Map of `user_id -> post_elo - pre_elo` populated by the ratings recompute
  // flow when each batch of ratings is processed. Stays `{}` until at least
  // one rating has been submitted for the game.
  elo_delta_by_user: ColumnType<
    Record<string, number>,
    Record<string, number> | string | undefined,
    Record<string, number> | string
  >;
}

// === Data-rights (GDPR) agent ===
// Two tables back the data-rights surface. See migration
// `1700000210000_data-rights.sql` for the full schema rationale; in short:
//   - `data_export_requests` queues per-user JSON exports. The service walks
//     every owning module's tables and writes the JSON file out, then flips
//     status to 'ready' with the download URL populated.
//   - `account_deletion_requests` PK-on-user_id schedules a hard delete in
//     +30 days. PII is anonymized immediately on schedule; the row sticks
//     around so /delete/cancel can undo within the window.
export type DataExportStatus = "queued" | "processing" | "ready" | "failed";

export interface DataExportRequestTable {
  id: Generated<string>;
  user_id: string;
  status: ColumnType<DataExportStatus, DataExportStatus | undefined, DataExportStatus>;
  download_url: ColumnType<string | null, string | null | undefined, string | null>;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  completed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export type AccountDeletionStatus = "scheduled" | "cancelled" | "completed";

export interface AccountDeletionRequestTable {
  user_id: string;
  requested_at: ColumnType<Date, Date | string | undefined, never>;
  hard_delete_at: ColumnType<Date, Date | string, Date | string>;
  status: ColumnType<AccountDeletionStatus, AccountDeletionStatus | undefined, AccountDeletionStatus>;
  cancelled_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  completed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface Database {
  users: UserTable;
  refresh_tokens: RefreshTokenTable;
  signup_attempts: SignupAttemptTable;
  email_tokens: EmailTokenTable;
  device_tokens: DeviceTokenTable;
  sports: SportTable;
  venues: VenueTable;
  courts: CourtTable;
  games: GameTable;
  game_participants: GameParticipantTable;
  ratings: RatingTable;
  player_sport_stats: PlayerSportStatsTable;
  audit_log: AuditLogTable;
  bookings: BookingTable;
  payment_splits: PaymentSplitTable;
  notifications: NotificationTable;
  conversations: ConversationTable;
  conversation_participants: ConversationParticipantTable;
  messages: MessageTable;
  tournaments: TournamentTable;
  tournament_entries: TournamentEntryTable;
  follows: FollowTable;
  reports: ReportTable;
  game_invitations: GameInvitationTable;
  feed_events: FeedEventTable;
  feed_cursor: FeedCursorTable;
  achievements: AchievementTable;
  user_achievements: UserAchievementTable;
  stripe_customers: StripeCustomerTable;
  tournament_entry_payments: TournamentEntryPaymentTable;
  stripe_webhook_events: StripeWebhookEventTable;
  memberships: MembershipTable;
  match_scores: MatchScoreTable;
  referrals: ReferralTable;
  medical_profiles: MedicalProfileTable;
  tournament_waivers: TournamentWaiverTable;
  data_export_requests: DataExportRequestTable;
  account_deletion_requests: AccountDeletionRequestTable;
  feed_event_reactions: FeedEventReactionTable;
  notification_preferences: NotificationPreferenceTable;
  user_blocks: UserBlockTable;
  game_reminders_sent: GameReminderSentTable;
  daily_digest_sent: DailyDigestSentTable;
  stories: StoryTable;
  story_views: StoryViewTable;
  story_mentions: StoryMentionTable;
  squads: SquadTable;
  squad_members: SquadMemberTable;
  announcements: AnnouncementTable;
  user_dismissed_announcements: UserDismissedAnnouncementTable;
  americano_tournaments: AmericanoTournamentTable;
  americano_teams: AmericanoTeamTable;
  americano_matches: AmericanoMatchTable;
  americano_rewards: AmericanoRewardTable;
}

// === Feed likes ===
// (user_id, feed_event_id) PK; one row per user per event. Composite PK
// enforces idempotent likes — repeated POST /feed/:id/like is a no-op.
export interface FeedEventReactionTable {
  feed_event_id: string;
  user_id: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// === Games reminder sweeper ===
// Idempotency ledger for the "starts in 2 hours" notification. The sweeper
// INSERTs (game_id, user_id) with ON CONFLICT DO NOTHING; only rows that
// actually got inserted (fresh emits) flow through to `notifications.emit()`.
// Composite PK guarantees exactly-once delivery across overlapping ticks and
// process restarts.
export interface GameReminderSentTable {
  game_id: string;
  user_id: string;
  sent_at: ColumnType<Date, Date | string | undefined, never>;
}

// === Daily digest sweeper (Wave-10) ===
// Idempotency ledger for the 18:00-local "Bu gün Linkfit-də" push. The
// hourly sweeper computes the user's LOCAL calendar date from their
// `time_zone` and INSERTs (user_id, sent_date) with ON CONFLICT DO NOTHING
// — composite PK guarantees at most one digest per user per local day,
// across overlapping ticks and across pod restarts. `sent_date` is a `date`
// (not timestamptz) because the natural deduplication key is the local
// calendar day, not the UTC instant.
export interface DailyDigestSentTable {
  user_id: string;
  sent_date: ColumnType<Date, Date | string, Date | string>;
  sent_at: ColumnType<Date, Date | string | undefined, never>;
}

// === Stories agent ===
// Instagram-style ephemeral posts (24h TTL). `view_count` reflects the
// number of UNIQUE viewers — increments are gated by the composite PK on
// `story_views` (INSERT ... ON CONFLICT DO NOTHING). The out-of-band
// `StoriesExpireSweeper` removes rows + media files past `expires_at`.

export type StoryMediaType = "image" | "video";

export interface StoryTable {
  id: Generated<string>;
  user_id: string;
  media_url: string;
  media_type: StoryMediaType;
  caption: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  expires_at: ColumnType<Date, Date | string | undefined, Date | string>;
  view_count: Generated<number>;
  /**
   * Wave-12 overlay payload — opaque JSONB array of `{ kind: "text" |
   * "sticker", payload: {...} }` entries the iOS composer encodes into
   * the story. Mentions are NOT in here; they are normalized into the
   * `story_mentions` table so the "who's tagged?" and "stories I'm in"
   * queries can hit a real index instead of scanning JSON. Nullable so
   * pre-Wave-12 rows continue to load without backfill.
   */
  overlays: ColumnType<unknown, unknown, unknown>;
}

export interface StoryViewTable {
  story_id: string;
  viewer_user_id: string;
  viewed_at: ColumnType<Date, Date | string | undefined, never>;
}

// === Story mentions (Wave-12) ===
// One row per (story, mentioned user). Composite PK so a duplicate
// mention is a no-op via ON CONFLICT DO NOTHING. `(x, y)` are
// normalized [0..1] frame coordinates the iOS viewer renders as a
// tappable chip overlay; ON DELETE CASCADE from both `stories` and
// `users` keeps the table aligned with the 24h story TTL and with
// account deletions.
export interface StoryMentionTable {
  story_id: string;
  mentioned_user_id: string;
  x: ColumnType<number, number, number>;
  y: ColumnType<number, number, number>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// === Squads agent ===
// The persistent doubles foursome. Two tables backing the surface:
//
//   * squads          — owned by `owner_id`. Display fields (name,
//                       description, photo) plus the `max_size` cap (2..16).
//
//   * squad_members   — (squad_id, user_id) composite PK. `role` partitions
//                       owner from member, `status` partitions pending
//                       invites from active memberships. Status flips from
//                       'pending' to 'active' when the invitee accepts.
export type SquadMemberRole = "owner" | "member";
export type SquadMemberStatus = "pending" | "active";

export interface SquadTable {
  id: Generated<string>;
  owner_id: string;
  name: string;
  description: ColumnType<string | null, string | null | undefined, string | null>;
  photo_url: ColumnType<string | null, string | null | undefined, string | null>;
  max_size: Generated<number>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface SquadMemberTable {
  squad_id: string;
  user_id: string;
  role: SquadMemberRole;
  status: SquadMemberStatus;
  joined_at: Generated<Date>;
}

// === Announcements agent (Wave-10) ===
// Admin-curated, time-windowed broadcasts the iOS client surfaces as a
// slim dismissible banner at the very top of HomeView. Two tables:
//
//   * announcements                — the curated copy (AZ/EN/RU title/body/
//                                    CTA label, optional CTA URL, window
//                                    bounds, audience filter, priority).
//   * user_dismissed_announcements — per-user dismissal ledger so a banner
//                                    the user closed never re-shows.
//
// `audience` constrained to the three locales the iOS app ships plus the
// catch-all `all`. `priority` smaller = higher priority (only the
// top-priority active row is returned per request).
export type AnnouncementAudience = "all" | "az" | "en" | "ru";

export interface AnnouncementTable {
  id: Generated<string>;
  title_az: string;
  title_en: string;
  title_ru: string;
  body_az: ColumnType<string | null, string | null | undefined, string | null>;
  body_en: ColumnType<string | null, string | null | undefined, string | null>;
  body_ru: ColumnType<string | null, string | null | undefined, string | null>;
  cta_label_az: ColumnType<string | null, string | null | undefined, string | null>;
  cta_label_en: ColumnType<string | null, string | null | undefined, string | null>;
  cta_label_ru: ColumnType<string | null, string | null | undefined, string | null>;
  cta_url: ColumnType<string | null, string | null | undefined, string | null>;
  starts_at: ColumnType<Date, Date | string | undefined, Date | string>;
  ends_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  audience: ColumnType<AnnouncementAudience, AnnouncementAudience | undefined, AnnouncementAudience>;
  priority: ColumnType<number, number | undefined, number>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  created_by_user_id: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface UserDismissedAnnouncementTable {
  user_id: string;
  announcement_id: string;
  dismissed_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface AmericanoTournamentTable {
  id: Generated<string>;
  name: string;
  format: "solo" | "team";
  host_id: string;
  court_count: number;
  scoring_system: string;
  status: Generated<"open" | "playing" | "completed">;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface AmericanoTeamTable {
  id: Generated<string>;
  tournament_id: string;
  display_name: string;
  wins: Generated<number>;
  draws: Generated<number>;
  losses: Generated<number>;
  score: Generated<number>;
}

export interface AmericanoMatchTable {
  id: Generated<string>;
  tournament_id: string;
  court_name: string;
  round_number: number;
  team_a_id: string;
  team_b_id: string;
  score_a: number | null;
  score_b: number | null;
  status: Generated<"pending" | "completed">;
}

export interface AmericanoRewardTable {
  id: Generated<string>;
  tournament_id: string;
  winner_team_id: string;
  sponsor_coupon_code: string;
  prize_name: string;
}
