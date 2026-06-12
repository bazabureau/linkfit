import { type DbHandle } from "../../shared/db/pool.js";
import { type NotificationType } from "../../shared/db/types.js";
import { ValidationError } from "../../shared/errors/AppError.js";

export interface NotificationPreferencesDeps {
  db: DbHandle;
}

/** Per-type preferences as the API returns them. Always 8 entries (one
 *  per NotificationType) so the iOS settings screen can render the full
 *  list without conditionally hiding rows. */
export interface PreferenceView {
  type: NotificationType;
  push_enabled: boolean;
  email_enabled: boolean;
  in_app_enabled: boolean;
}

export interface PreferencesResponse {
  preferences: PreferenceView[];
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  /** Wave-10 daily-digest push opt-out. Defaults to true at the DB level
   *  so engagement wins out-of-the-box; the iOS settings screen renders
   *  a single toggle next to quiet-hours. */
  daily_digest_enabled: boolean;
  /** IANA tz read alongside the digest toggle so the settings screen can
   *  show "Your local 6pm reminder" with the correct context. Always set
   *  in the DB — column has `NOT NULL DEFAULT 'Asia/Baku'`. */
  time_zone: string;
}

export interface UpdatePreferenceInput {
  type: NotificationType;
  /** Each channel toggle is independently optional. Missing keys mean
   *  "preserve existing" (or "use default if no existing row"). The
   *  `| undefined` is explicit so `exactOptionalPropertyTypes` doesn't
   *  reject a forwarded zod-parsed body. */
  push_enabled?: boolean | undefined;
  email_enabled?: boolean | undefined;
  in_app_enabled?: boolean | undefined;
}

export interface UpdateQuietHoursInput {
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
}

/** Wave-10. Patch shape for the daily-digest opt-out + time-zone tuple.
 *  Both fields are optional so iOS can flip the toggle without forcing a
 *  redundant time-zone resubmit on every change. */
export interface UpdateDailyDigestInput {
  daily_digest_enabled?: boolean | undefined;
  /** IANA string. Validated as a non-empty token; full canonical check
   *  defers to PG / `Intl.DateTimeFormat` at render time so we don't ship
   *  a static allow-list that drifts behind tz database updates. */
  time_zone?: string | undefined;
}

/** Every notification type we support, in display order. Single source of
 *  truth for the response so iOS gets all 8 rows even when the user has
 *  zero overrides in the DB. */
const ALL_TYPES: readonly NotificationType[] = [
  "game_joined",
  "game_cancelled",
  "game_reminder",
  "no_show_marked",
  "rating_received",
  "tournament_invite",
  "message_received",
  "system",
];

/**
 * 🎯 USER DECISION REQUIRED 🎯
 *
 * Default push-enabled state for each notification type, applied to users
 * who have NOT overridden the preference. This is the engagement vs.
 * annoyance trade-off:
 *
 *   - Returning `true` for everything: maximum engagement out-of-the-box,
 *     but new users get hit with 5 push notifications per game day.
 *     Likely to drive immediate "Disable all" + churn.
 *
 *   - Returning `false` for most: respectful default, but users miss
 *     real-time events (their game starts in 1h, somebody joined their
 *     match) until they discover the settings screen.
 *
 *   - A curated middle ground: defaults that reflect what the user EXPECTS
 *     ("yes I want to know my game starts in 1h" but "no I don't need a
 *     ping for every rating I get").
 *
 * Pick a policy and fill in the returns below. The signature is just:
 *
 *   (type: NotificationType) => boolean   // true = push by default
 *
 * Lazım olan kod ~10 sətir-dir. Hansı default policy seçirsiniz?
 */
export function defaultPushEnabledForType(type: NotificationType): boolean {
  // TODO: replace the conservative blanket-false with your chosen policy.
  // The conservative default (no surprises) is shipped here so a forgotten
  // implementation never accidentally spams users. Replace with your
  // curated `switch (type)` once you've decided.
  void type;
  return false;
}

/**
 * Returns whether a push notification SHOULD be delivered for this
 * (user, type) right now. Combines per-type preference (or default) with
 * the global quiet-hours check. Pure read — no side effects.
 *
 * Used by `NotificationsService.emit()` before it calls APNs.
 */
export class NotificationPreferencesService {
  constructor(private readonly deps: NotificationPreferencesDeps) {}

  async getPreferences(userId: string): Promise<PreferencesResponse> {
    const [overrides, user] = await Promise.all([
      this.deps.db.db
        .selectFrom("notification_preferences")
        .selectAll()
        .where("user_id", "=", userId)
        .execute(),
      this.deps.db.db
        .selectFrom("users")
        .select([
          "quiet_hours_start",
          "quiet_hours_end",
          "daily_digest_enabled",
          "time_zone",
        ])
        .where("id", "=", userId)
        .executeTakeFirstOrThrow(),
    ]);

    const overrideByType = new Map(overrides.map((o) => [o.type, o]));

    const preferences: PreferenceView[] = ALL_TYPES.map((type) => {
      const override = overrideByType.get(type);
      if (override !== undefined) {
        return {
          type,
          push_enabled: override.push_enabled,
          email_enabled: override.email_enabled,
          in_app_enabled: override.in_app_enabled,
        };
      }
      return {
        type,
        push_enabled: defaultPushEnabledForType(type),
        email_enabled: true,
        in_app_enabled: true,
      };
    });

    return {
      preferences,
      quiet_hours_start: user.quiet_hours_start,
      quiet_hours_end: user.quiet_hours_end,
      daily_digest_enabled: user.daily_digest_enabled,
      time_zone: user.time_zone,
    };
  }

  /**
   * Update the daily-digest opt-out and/or the user's IANA time zone.
   * Both fields are optional — passing only `daily_digest_enabled` keeps
   * the existing time zone untouched. We validate the time zone by
   * round-tripping it through `Intl.DateTimeFormat`; bad values raise
   * `RangeError` which we translate to a 400.
   */
  async updateDailyDigest(userId: string, input: UpdateDailyDigestInput): Promise<void> {
    if (input.daily_digest_enabled === undefined && input.time_zone === undefined) {
      // Nothing to update — short-circuit so we don't burn a write on
      // an empty PATCH. A blank request from a confused client is a
      // no-op, not an error.
      return;
    }
    if (input.time_zone !== undefined) {
      const tz = input.time_zone.trim();
      if (tz.length === 0) {
        throw new ValidationError("time_zone must not be empty");
      }
      try {
        // `Intl.DateTimeFormat` throws `RangeError` for unknown tz strings
        // — the platform's own tz-database lookup, so we never drift
        // behind upstream additions.
        new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
      } catch {
        throw new ValidationError(`Unknown IANA time zone: ${tz}`);
      }
    }
    const patch: { daily_digest_enabled?: boolean; time_zone?: string } = {};
    if (input.daily_digest_enabled !== undefined) patch.daily_digest_enabled = input.daily_digest_enabled;
    if (input.time_zone !== undefined) patch.time_zone = input.time_zone.trim();
    await this.deps.db.db
      .updateTable("users")
      .set(patch)
      .where("id", "=", userId)
      .execute();
  }

  async updatePreference(userId: string, input: UpdatePreferenceInput): Promise<void> {
    // Look up the existing row so we can preserve unchanged channel toggles
    // when the caller patches only one. `INSERT ... ON CONFLICT UPDATE`
    // would also work but the explicit upsert keeps the SQL portable.
    const existing = await this.deps.db.db
      .selectFrom("notification_preferences")
      .selectAll()
      .where("user_id", "=", userId)
      .where("type", "=", input.type)
      .executeTakeFirst();

    const merged = {
      push_enabled: input.push_enabled ?? existing?.push_enabled ?? defaultPushEnabledForType(input.type),
      email_enabled: input.email_enabled ?? existing?.email_enabled ?? true,
      in_app_enabled: input.in_app_enabled ?? existing?.in_app_enabled ?? true,
    };

    await this.deps.db.db
      .insertInto("notification_preferences")
      .values({
        user_id: userId,
        type: input.type,
        push_enabled: merged.push_enabled,
        email_enabled: merged.email_enabled,
        in_app_enabled: merged.in_app_enabled,
      })
      .onConflict((oc) =>
        oc.columns(["user_id", "type"]).doUpdateSet({
          push_enabled: merged.push_enabled,
          email_enabled: merged.email_enabled,
          in_app_enabled: merged.in_app_enabled,
          updated_at: new Date(),
        }),
      )
      .execute();
  }

  async updateQuietHours(userId: string, input: UpdateQuietHoursInput): Promise<void> {
    const start = input.quiet_hours_start;
    const end = input.quiet_hours_end;
    // The DB CHECK constraint also enforces this, but a 400 response
    // beats a 500 from a constraint violation.
    if ((start === null) !== (end === null)) {
      throw new ValidationError("quiet_hours_start and quiet_hours_end must both be set or both be null");
    }
    if (start !== null && (start < 0 || start > 23)) {
      throw new ValidationError("quiet_hours_start must be 0..23");
    }
    if (end !== null && (end < 0 || end > 23)) {
      throw new ValidationError("quiet_hours_end must be 0..23");
    }

    await this.deps.db.db
      .updateTable("users")
      .set({ quiet_hours_start: start, quiet_hours_end: end })
      .where("id", "=", userId)
      .execute();
  }

  /**
   * Hot-path check: should we push this (user, type) right now? Combines
   * the per-type preference (DB row or default) with the global quiet-hours
   * window. Returns true ONLY when both gates open.
   *
   * Called by `NotificationsService.emit()` on every notification.
   */
  async shouldPush(userId: string, type: NotificationType): Promise<boolean> {
    const row = await this.deps.db.db
      .selectFrom("notification_preferences")
      .select("push_enabled")
      .where("user_id", "=", userId)
      .where("type", "=", type)
      .executeTakeFirst();

    const pushEnabled = row?.push_enabled ?? defaultPushEnabledForType(type);
    if (!pushEnabled) return false;

    // Quiet hours: separate query, but unavoidable — we need both the
    // per-type pref AND the global window. Two SELECTs against the same
    // user_id are still <2ms total.
    const user = await this.deps.db.db
      .selectFrom("users")
      .select(["quiet_hours_start", "quiet_hours_end"])
      .where("id", "=", userId)
      .executeTakeFirst();

    const start = user?.quiet_hours_start ?? null;
    const end = user?.quiet_hours_end ?? null;
    if (start === null || end === null) {
      return true;
    }
    return !isInQuietHours(new Date(), start, end);
  }
}

/**
 * Is `now` inside the (start, end) quiet-hours window? Supports
 * windows that wrap midnight UTC (e.g. start=22, end=8). The window is
 * inclusive of `start` and exclusive of `end` to match the intuitive
 * "10pm to 8am" reading (10pm starts the silence, 8am ends it).
 *
 * Exported for unit testing.
 */
export function isInQuietHours(now: Date, start: number, end: number): boolean {
  const hour = now.getUTCHours();
  if (start === end) {
    // start === end is a 24-hour mute. We treat this as "all hours" so
    // there's a clear way to express "no pushes at all" without removing
    // the column.
    return true;
  }
  if (start < end) {
    // Non-wrapping window, e.g. 8..22 → silent 08:00–22:00.
    return hour >= start && hour < end;
  }
  // Wrapping window, e.g. 22..8 → silent 22:00–24:00 ∪ 00:00–08:00.
  return hour >= start || hour < end;
}
