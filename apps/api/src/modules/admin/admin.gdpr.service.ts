import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import { NotFoundError } from "../../shared/errors/AppError.js";

export interface AdminGdprServiceDeps {
  db: DbHandle;
  logger: Logger;
}

/**
 * Shape returned to admins listing pending account deletions. We
 * intentionally don't return the raw `account_deletion_requests` row to
 * make the privacy/operations trade-off visible — the projection
 * function `redactDeletionForAdmin` below decides what admins see.
 */
export interface AdminDeletionView {
  user_id: string;
  requested_at: string;
  hard_delete_at: string;
  /** Days remaining before the sweeper hard-deletes. Computed at read
   *  time so the UI doesn't have to do clock math. */
  days_remaining: number;
  /** Populated by the user-fields contributed in `redactDeletionForAdmin`.
   *  When `null` the admin only sees the user_id (most private posture). */
  user: AdminDeletionUserFields | null;
}

/**
 * The fields a deletion row exposes about the deleting user. The exact
 * shape is the design decision made by `redactDeletionForAdmin` — keep
 * this interface in sync if you add new fields there.
 */
export interface AdminDeletionUserFields {
  email: string | null;
  display_name: string | null;
  // Add more fields here if your privacy policy permits.
}

/**
 * Row type returned from the JOIN query. Keep this internal — admins
 * never see the raw shape, only the projection from `redactDeletionForAdmin`.
 */
interface DeletionWithUserRow {
  user_id: string;
  requested_at: Date;
  hard_delete_at: Date;
  email: string;
  display_name: string;
}

/**
 * 🎯 USER DECISION REQUIRED 🎯
 *
 * What should admins see about pending account deletions?
 *
 * This shapes the privacy posture of the entire admin tool. There are
 * three sensible options:
 *
 *   (a) MINIMAL — return `null`. Admins see only user_id + timestamps.
 *       Pros: Best privacy. No admin can browse "who is leaving us".
 *       Cons: Hard for support — they can't help a confused user without
 *             cross-referencing user_id elsewhere first.
 *
 *   (b) IDENTIFYING — return { email, display_name }.
 *       Pros: Support can recognize the user immediately.
 *       Cons: Admin can enumerate departures by name/email. Bad if an
 *             employee starts taking a list "to retain users at risk".
 *
 *   (c) NUANCED — return identifying data BUT only when the deletion is
 *       within N hours of being hard-deleted (e.g. final 48 hours).
 *       Pros: Identifying data only surfaces when ops actually need it
 *             (a user calling support because they regret the delete).
 *       Cons: More complex; reviewers must reason about the cutoff.
 *
 * Pick one and implement below. The function receives the raw JOIN row
 * and returns either an `AdminDeletionUserFields` object or `null`.
 *
 * Lazım olan kod ~5 sətir-dir. Hansı yanaşmanı seçəcəyinizi yazın.
 */
/**
 * Implementation: option (c) NUANCED.
 *
 * Privacy posture by default — admins see only user_id + timestamps for
 * the vast majority of pending deletions. Identifying fields surface
 * ONLY in the last 48 hours before hard-delete, on the assumption that
 * a panicked user calling support fits inside that window and that's
 * exactly when an admin needs to recognize them. Outside that window,
 * a curious admin can't browse "who is leaving" — they only see UUIDs.
 *
 * The cutoff is hard-coded at 48h rather than env-configurable because
 * the threshold is a privacy policy decision, not an operational knob;
 * changing it should require a code review, not an env flip.
 */
const SUPPORT_WINDOW_HOURS = 48;

export function redactDeletionForAdmin(
  row: DeletionWithUserRow,
): AdminDeletionUserFields | null {
  const hoursUntilHardDelete =
    (row.hard_delete_at.getTime() - Date.now()) / (3600 * 1000);
  if (hoursUntilHardDelete > SUPPORT_WINDOW_HOURS) {
    return null;
  }
  return {
    email: row.email,
    display_name: row.display_name,
  };
}

export interface AdminExportView {
  id: string;
  user_id: string;
  status: "queued" | "processing" | "ready" | "failed";
  created_at: string;
  completed_at: string | null;
  expires_at: string;
  /** Whether the download file still exists per the DB row. The actual
   *  on-disk file is purged by the sweeper after `expires_at`. */
  is_downloadable: boolean;
}

export class AdminGdprService {
  constructor(private readonly deps: AdminGdprServiceDeps) {}

  /**
   * List pending account deletions, scheduled-only. Joins users so the
   * redaction function has identifying data to make a decision with;
   * what actually surfaces is whatever `redactDeletionForAdmin` returns.
   *
   * Every call writes a meta-audit row so we can answer "which admin
   * read the deletion list at <time>?" — that's a GDPR Article 30
   * processing-records requirement.
   */
  async listPendingDeletions(
    adminId: string,
    limit: number,
  ): Promise<AdminDeletionView[]> {
    const rows = await this.deps.db.db
      .selectFrom("account_deletion_requests as r")
      .innerJoin("users as u", "u.id", "r.user_id")
      .select([
        "r.user_id",
        "r.requested_at",
        "r.hard_delete_at",
        "u.email",
        "u.display_name",
      ])
      .where("r.status", "=", "scheduled")
      .orderBy("r.hard_delete_at", "asc")
      .limit(limit)
      .execute();

    await this.writeMetaAudit(adminId, "admin.gdpr.list_deletions", {
      result_count: rows.length,
    });

    const now = Date.now();
    return rows.map((row) => ({
      user_id: row.user_id,
      requested_at: row.requested_at.toISOString(),
      hard_delete_at: row.hard_delete_at.toISOString(),
      days_remaining: Math.max(
        0,
        Math.floor((row.hard_delete_at.getTime() - now) / (24 * 3600 * 1000)),
      ),
      user: redactDeletionForAdmin(row),
    }));
  }

  /**
   * Force-cancel a scheduled deletion (e.g., user emailed support
   * begging us to undo). Restores `users.deleted_at = NULL` exactly
   * like the user-facing cancel endpoint.
   */
  async forceCancelDeletion(adminId: string, userId: string): Promise<void> {
    await withTransaction(this.deps.db.db, async (tx) => {
      const row = await tx
        .updateTable("account_deletion_requests")
        .set({ status: "cancelled", cancelled_at: new Date() })
        .where("user_id", "=", userId)
        .where("status", "=", "scheduled")
        .returningAll()
        .executeTakeFirst();

      if (row === undefined) {
        throw new NotFoundError("No scheduled deletion to cancel");
      }

      await tx
        .updateTable("users")
        .set({ deleted_at: null })
        .where("id", "=", userId)
        .execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.gdpr.force_cancel_deletion",
          entity: "user",
          entity_id: userId,
          metadata: {
            original_hard_delete_at: row.hard_delete_at.toISOString(),
          },
        })
        .execute();
    });

    this.deps.logger.info(
      { event: "admin_gdpr_force_cancel", admin_id: adminId, user_id: userId },
      "admin force-cancelled deletion",
    );
  }

  /**
   * List data export request rows. Less privacy-sensitive than deletions
   * (we never see export contents from here, just metadata), so no
   * redaction step — admins see who requested what and when.
   */
  async listExports(
    adminId: string,
    limit: number,
  ): Promise<AdminExportView[]> {
    const rows = await this.deps.db.db
      .selectFrom("data_export_requests")
      .select([
        "id",
        "user_id",
        "status",
        "created_at",
        "completed_at",
        "expires_at",
        "download_url",
      ])
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();

    await this.writeMetaAudit(adminId, "admin.gdpr.list_exports", {
      result_count: rows.length,
    });

    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      status: r.status,
      created_at: r.created_at.toISOString(),
      completed_at: r.completed_at?.toISOString() ?? null,
      expires_at: r.expires_at.toISOString(),
      is_downloadable: r.download_url !== null && r.status === "ready",
    }));
  }

  /**
   * Meta-audit helper. Every admin read of GDPR data is itself an audit
   * event so we can satisfy "who looked at this and when". Failure to
   * write the audit row must not silently swallow the read — we log and
   * proceed because operationally we'd rather have a working endpoint
   * than a denied one, but the gap shows up in logs.
   */
  private async writeMetaAudit(
    adminId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.deps.db.db
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action,
          entity: "data_rights",
          entity_id: null,
          metadata,
        })
        .execute();
    } catch (err) {
      this.deps.logger.error(
        { err, action, admin_id: adminId, event: "meta_audit_write_failed" },
        "failed to write GDPR meta-audit row",
      );
    }
  }
}
