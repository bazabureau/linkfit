import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  ConflictError,
  NotFoundError,
} from "../../shared/errors/AppError.js";
import {
  type DataExportRequest,
  type AccountDeletionRequest,
  type DataExportPayload,
} from "./data-rights.types.js";

export interface DataRightsDeps {
  readonly db: DbHandle;
  readonly logger: Logger;
  /** Absolute filesystem path that holds the JSON dumps. The router serves
   *  the same directory at `/uploads/data-exports/*`, so the directory is
   *  the upload root plus the `data-exports` subdir we create on first use. */
  readonly uploadDir: string;
  /** Public origin used to build the absolute `download_url`. Defaults to
   *  the configured PUBLIC_BASE_URL; tests inject a test-server URL. */
  readonly publicBaseUrl: string;
}

const EXPORT_TTL_DAYS = 7;
const DELETION_GRACE_DAYS = 30;
const MIN_EXPORT_INTERVAL_HOURS = 1;

/**
 * Owner of the GDPR data-rights surface. Two flows:
 *
 *  1. **Account deletion** — `requestDeletion()` immediately anonymizes the
 *     account's PII (email scrambled, display_name -> "deleted user",
 *     photo cleared, `users.deleted_at` set) and inserts an
 *     `account_deletion_requests` row with `hard_delete_at = now() + 30d`.
 *     `cancelDeletion()` flips status back to 'cancelled' if still within
 *     the window. `DataRightsSweeper` performs the eventual hard-delete and
 *     expired export cleanup from the server lifecycle.
 *
 *  2. **Data export** — `requestExport()` queues a job (status='queued')
 *     and synchronously walks every owning module's tables to produce a
 *     JSON file at `<uploadDir>/data-exports/<uuid>.json`. The service
 *     does this inline because the volume per account is small (typical
 *     active user has < 10MB of data) and asynchronous job infrastructure
 *     is out of scope. For large accounts we cap individual collections
 *     at 10k rows to keep the request bounded.
 */
export class DataRightsService {
  constructor(private readonly deps: DataRightsDeps) {
    // Eagerly create the data-exports directory so the first export
    // doesn't race with mkdir during the file write.
    mkdirSync(join(deps.uploadDir, "data-exports"), { recursive: true });
  }

  // ── Account deletion ──────────────────────────────────────────────

  async requestDeletion(userId: string): Promise<AccountDeletionRequest> {
    const now = new Date();
    const hardDeleteAt = new Date(now.getTime() + DELETION_GRACE_DAYS * 24 * 3600 * 1000);

    return this.deps.db.db.transaction().execute(async (tx) => {
      const existing = await tx
        .selectFrom("account_deletion_requests")
        .selectAll()
        .where("user_id", "=", userId)
        .executeTakeFirst();

      if (existing?.status === "scheduled") {
        throw new ConflictError("Account deletion already scheduled");
      }

      // Anonymize PII immediately. The user's account is effectively
      // gone from the product the moment they call /delete; the 30-day
      // grace just keeps the row hooks intact (so cancel can undo) and
      // the out-of-band purge does the final hard tear-down.
      await tx
        .updateTable("users")
        .set({
          email: `deleted-${userId}@linkfit.deleted`,
          display_name: "deleted user",
          photo_url: null,
          deleted_at: now,
        })
        .where("id", "=", userId)
        .execute();

      // Insert OR update the deletion row (PK on user_id so duplicates
      // are rejected by the DB; we already handle the "scheduled twice"
      // case above and re-activating a cancelled row uses UPDATE).
      let row;
      if (existing === undefined) {
        row = await tx
          .insertInto("account_deletion_requests")
          .values({
            user_id: userId,
            hard_delete_at: hardDeleteAt,
            status: "scheduled",
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } else {
        row = await tx
          .updateTable("account_deletion_requests")
          .set({
            status: "scheduled",
            hard_delete_at: hardDeleteAt,
            cancelled_at: null,
            completed_at: null,
          })
          .where("user_id", "=", userId)
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      this.deps.logger.info(
        { event: "account_deletion_scheduled", user_id: userId, hard_delete_at: row.hard_delete_at },
        "account deletion scheduled",
      );

      return mapDeletionRow(row);
    });
  }

  async cancelDeletion(userId: string): Promise<AccountDeletionRequest> {
    const row = await this.deps.db.db
      .updateTable("account_deletion_requests")
      .set({ status: "cancelled", cancelled_at: new Date() })
      .where("user_id", "=", userId)
      .where("status", "=", "scheduled")
      .returningAll()
      .executeTakeFirst();

    if (row === undefined) {
      throw new NotFoundError("No scheduled deletion to cancel");
    }

    // Restore the user's deleted_at = null. We can't restore the original
    // email / display_name because we deliberately scrambled them on
    // schedule — that's a documented trade-off (cancel restores access
    // but the user's display info is reset to "deleted user" until they
    // update their profile).
    await this.deps.db.db
      .updateTable("users")
      .set({ deleted_at: null })
      .where("id", "=", userId)
      .execute();

    this.deps.logger.info(
      { event: "account_deletion_cancelled", user_id: userId },
      "account deletion cancelled",
    );

    return mapDeletionRow(row);
  }

  async getDeletionStatus(userId: string): Promise<AccountDeletionRequest | null> {
    const row = await this.deps.db.db
      .selectFrom("account_deletion_requests")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return row === undefined ? null : mapDeletionRow(row);
  }

  // ── Data export ────────────────────────────────────────────────────

  async requestExport(userId: string): Promise<DataExportRequest> {
    // Per-user rate limit: at most one queued/processing and at most one
    // ready export per hour. Both checks share the same `created_at DESC`
    // index defined in the migration.
    const latest = await this.deps.db.db
      .selectFrom("data_export_requests")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();

    if (latest !== undefined) {
      if (latest.status === "queued" || latest.status === "processing") {
        throw new ConflictError("An export is already in progress");
      }
      const cooldownMs = MIN_EXPORT_INTERVAL_HOURS * 3600 * 1000;
      if (Date.now() - latest.created_at.getTime() < cooldownMs) {
        throw new ConflictError(
          `Wait ${String(MIN_EXPORT_INTERVAL_HOURS)} hour(s) between export requests`,
        );
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPORT_TTL_DAYS * 24 * 3600 * 1000);

    const inserted = await this.deps.db.db
      .insertInto("data_export_requests")
      .values({
        user_id: userId,
        status: "queued",
        expires_at: expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Run the export inline. For large accounts this could take a few
    // seconds; the response stays open so the client gets the final
    // status. If it fails, we still flip status to 'failed' so the row
    // exists with a meaningful state.
    try {
      await this.deps.db.db
        .updateTable("data_export_requests")
        .set({ status: "processing" })
        .where("id", "=", inserted.id)
        .execute();

      const payload = await this.collectUserData(userId);
      const filename = `${randomUUID()}.json`;
      const filepath = join(this.deps.uploadDir, "data-exports", filename);
      writeFileSync(filepath, JSON.stringify(payload, null, 2), { encoding: "utf8" });

      const downloadUrl = `${this.deps.publicBaseUrl}/uploads/data-exports/${filename}`;
      const completed = await this.deps.db.db
        .updateTable("data_export_requests")
        .set({
          status: "ready",
          download_url: downloadUrl,
          completed_at: new Date(),
        })
        .where("id", "=", inserted.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      this.deps.logger.info(
        { event: "data_export_ready", user_id: userId, request_id: inserted.id },
        "data export ready",
      );

      return mapExportRow(completed);
    } catch (err) {
      this.deps.logger.error(
        { err, user_id: userId, request_id: inserted.id },
        "data export failed",
      );
      await this.deps.db.db
        .updateTable("data_export_requests")
        .set({ status: "failed", completed_at: new Date() })
        .where("id", "=", inserted.id)
        .execute();
      throw err;
    }
  }

  async getLatestExport(userId: string): Promise<DataExportRequest | null> {
    const row = await this.deps.db.db
      .selectFrom("data_export_requests")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
    return row === undefined ? null : mapExportRow(row);
  }

  /**
   * Walk every owning module's tables and produce a single JSON object
   * that mirrors the data-model layout. We cap each collection at 10k
   * rows so a power user with millions of feed events doesn't OOM the
   * export. The cap is documented in the JSON output via `_truncated: true`
   * when it kicks in.
   */
  private async collectUserData(userId: string): Promise<DataExportPayload> {
    const cap = 10_000;
    const db = this.deps.db.db;

    const profile = await db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", userId)
      .executeTakeFirst();

    const [
      gamesHosted,
      gamesJoined,
      ratings,
      bookings,
      messages,
      notifications,
      follows,
      reports,
      tournamentEntries,
      memberships,
      feedEvents,
    ] = await Promise.all([
      db.selectFrom("games").selectAll()
        .where("host_user_id", "=", userId).limit(cap + 1).execute(),
      db.selectFrom("game_participants").selectAll()
        .where("user_id", "=", userId).limit(cap + 1).execute(),
      db.selectFrom("ratings").selectAll()
        .where((eb) => eb.or([
          eb("rater_user_id", "=", userId),
          eb("rated_user_id", "=", userId),
        ]))
        .limit(cap + 1).execute(),
      db.selectFrom("bookings").selectAll()
        .where("user_id", "=", userId).limit(cap + 1).execute(),
      db.selectFrom("messages").selectAll()
        .where("sender_user_id", "=", userId).limit(cap + 1).execute(),
      db.selectFrom("notifications").selectAll()
        .where("user_id", "=", userId).limit(cap + 1).execute(),
      db.selectFrom("follows").selectAll()
        .where((eb) => eb.or([
          eb("follower_user_id", "=", userId),
          eb("followed_user_id", "=", userId),
        ]))
        .limit(cap + 1).execute(),
      db.selectFrom("reports").selectAll()
        .where("reporter_user_id", "=", userId).limit(cap + 1).execute(),
      db.selectFrom("tournament_entries").selectAll()
        .where("captain_user_id", "=", userId).limit(cap + 1).execute(),
      db.selectFrom("memberships").selectAll()
        .where("user_id", "=", userId).execute(),
      db.selectFrom("feed_events").selectAll()
        .where("actor_user_id", "=", userId).limit(cap + 1).execute(),
    ]);

    const truncate = <T>(rows: T[]): { rows: T[]; _truncated: boolean } => {
      if (rows.length > cap) {
        return { rows: rows.slice(0, cap), _truncated: true };
      }
      return { rows, _truncated: false };
    };

    return {
      exported_at: new Date().toISOString(),
      user_id: userId,
      profile: profile ?? null,
      games_hosted: truncate(gamesHosted),
      game_participation: truncate(gamesJoined),
      ratings: truncate(ratings),
      bookings: truncate(bookings),
      messages_sent: truncate(messages),
      notifications: truncate(notifications),
      follows: truncate(follows),
      reports_filed: truncate(reports),
      tournament_entries: truncate(tournamentEntries),
      memberships: { rows: memberships, _truncated: false },
      feed_events: truncate(feedEvents),
    };
  }
}

// ── Row mappers ──────────────────────────────────────────────────────

function mapDeletionRow(row: {
  user_id: string;
  requested_at: Date;
  hard_delete_at: Date;
  status: string;
  cancelled_at: Date | null;
  completed_at: Date | null;
}): AccountDeletionRequest {
  const requestedAtIso = row.requested_at.toISOString();
  return {
    // `id` and `scheduled_at` are intentional aliases. iOS models the
    // resource with `let id: String` + optional `scheduled_at`; backend
    // historically used `user_id` + `requested_at`. We surface both shapes
    // so a single response satisfies every client without forcing iOS to
    // learn module-specific CodingKeys.
    id: row.user_id,
    user_id: row.user_id,
    status: row.status as AccountDeletionRequest["status"],
    requested_at: requestedAtIso,
    scheduled_at: requestedAtIso,
    hard_delete_at: row.hard_delete_at.toISOString(),
    cancelled_at: row.cancelled_at?.toISOString() ?? null,
    completed_at: row.completed_at?.toISOString() ?? null,
  };
}

function mapExportRow(row: {
  id: string;
  user_id: string;
  status: string;
  download_url: string | null;
  expires_at: Date;
  created_at: Date;
  completed_at: Date | null;
}): DataExportRequest {
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status as DataExportRequest["status"],
    download_url: row.download_url,
    expires_at: row.expires_at.toISOString(),
    created_at: row.created_at.toISOString(),
    completed_at: row.completed_at?.toISOString() ?? null,
  };
}
