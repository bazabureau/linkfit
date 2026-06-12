import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  ConflictError,
  NotFoundError,
} from "../../shared/errors/AppError.js";
import {
  type ReportReason,
  type ReportStatus,
  type ReportTargetKind,
} from "../../shared/db/types.js";

/**
 * Admin moderation queue service.
 *
 * Owns the "enriched" view of the reports queue that joins reporter + target
 * context into a single row (saves the web UI N+1 lookups) and the higher-
 * level review action that can ALSO take action on the target (warn /
 * deactivate / delete) in the same transaction.
 *
 * Why this lives in the admin module, not reports:
 *  - The reports module owns user-facing report creation and a thin
 *    pending|reviewed|dismissed lifecycle. Cross-cutting target moderation
 *    (deactivate user, delete game) needs to reach into other tables, which
 *    is the admin module's job. Keeping it here avoids fanning reports'
 *    surface into game/user write paths.
 *  - Reports module is feature-frozen per the W10 contract — only admin
 *    module can extend the moderation surface without changing reports.
 */
export interface AdminModerationServiceDeps {
  db: DbHandle;
}

export type ModerationAction =
  | "dismiss"
  | "warn"
  | "deactivate_target"
  | "delete_target";

export interface EnrichedReporter {
  user_id: string;
  display_name: string | null;
  email: string | null;
  photo_url: string | null;
}

export interface EnrichedTargetUser {
  kind: "user";
  user_id: string;
  display_name: string | null;
  email: string | null;
  photo_url: string | null;
  deleted_at: string | null;
  created_at: string | null;
}

export interface EnrichedTargetGame {
  kind: "game";
  game_id: string;
  host_user_id: string | null;
  host_display_name: string | null;
  sport_slug: string | null;
  starts_at: string | null;
  status: string | null;
  deleted_at: string | null;
}

export interface EnrichedTargetMessage {
  kind: "message";
  message_id: string;
  conversation_id: string | null;
  sender_user_id: string | null;
  sender_display_name: string | null;
  body_preview: string | null;
  created_at: string | null;
}

export interface EnrichedTargetMissing {
  kind: "missing";
  /** The kind the report row claimed. */
  claimed_kind: ReportTargetKind;
  /** The id we tried to resolve. */
  claimed_id: string;
}

export type EnrichedTarget =
  | EnrichedTargetUser
  | EnrichedTargetGame
  | EnrichedTargetMessage
  | EnrichedTargetMissing;

export interface EnrichedReportRow {
  id: string;
  reporter: EnrichedReporter;
  target_kind: ReportTargetKind;
  target_id: string;
  target: EnrichedTarget;
  reason: ReportReason;
  status: ReportStatus;
  notes: string | null;
  reviewed_by_user_id: string | null;
  reviewer_display_name: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface EnrichedReportsPage {
  reports: EnrichedReportRow[];
  total: number;
  next_cursor: string | null;
}

export interface EnrichedUserDetail {
  id: string;
  email: string;
  display_name: string;
  photo_url: string | null;
  admin_role: "admin" | "moderator" | null;
  deleted_at: string | null;
  created_at: string;
  last_seen_at: string | null;
  /** Quick activity stats. */
  games_played_total: number;
  games_hosted_total: number;
  /** Reports filed BY this user. */
  reports_filed_count: number;
  /** Reports received about this user (target_kind='user'). */
  reports_received_count: number;
  /** Most recent reports filed by this user (capped at 10). */
  recent_reports_filed: EnrichedReportRow[];
  /** Most recent reports received about this user (capped at 10). */
  recent_reports_received: EnrichedReportRow[];
}

interface RawReportRow {
  id: string;
  reporter_user_id: string;
  reporter_display_name: string | null;
  reporter_email: string | null;
  reporter_photo_url: string | null;
  target_kind: ReportTargetKind;
  target_id: string;
  reason: ReportReason;
  status: ReportStatus;
  notes: string | null;
  reviewed_by_user_id: string | null;
  reviewer_display_name: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

function buildEnrichedRow(
  raw: RawReportRow,
  target: EnrichedTarget,
): EnrichedReportRow {
  return {
    id: raw.id,
    reporter: {
      user_id: raw.reporter_user_id,
      display_name: raw.reporter_display_name,
      email: raw.reporter_email,
      photo_url: raw.reporter_photo_url,
    },
    target_kind: raw.target_kind,
    target_id: raw.target_id,
    target,
    reason: raw.reason,
    status: raw.status,
    notes: raw.notes,
    reviewed_by_user_id: raw.reviewed_by_user_id,
    reviewer_display_name: raw.reviewer_display_name,
    reviewed_at: raw.reviewed_at?.toISOString() ?? null,
    created_at: raw.created_at.toISOString(),
  };
}

interface ReportsCursorPayload {
  created_at: string;
  id: string;
}

function encodeReportsCursor(p: ReportsCursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}

function decodeReportsCursor(raw: string): ReportsCursorPayload | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<ReportsCursorPayload>;
    if (typeof parsed.created_at === "string" && typeof parsed.id === "string") {
      return { created_at: parsed.created_at, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

export class AdminModerationService {
  constructor(private readonly deps: AdminModerationServiceDeps) {}

  /**
   * Cursor-paginated, target-enriched view of the report queue.
   *
   * One query pulls the report rows + reporter context. A second pass
   * resolves the target rows in three small batched queries (one per kind).
   * For a 25-row page that's 4 round-trips total instead of 1+3×25 — fine
   * given this surface is admin-only and not on the hot path.
   */
  async listReports(opts: {
    status?: ReportStatus;
    limit: number;
    cursor: string | null;
  }): Promise<EnrichedReportsPage> {
    const limit = Math.min(Math.max(opts.limit, 1), 200);
    const cursor = opts.cursor ? decodeReportsCursor(opts.cursor) : null;

    const filters: ReturnType<typeof sql>[] = [];
    if (opts.status) {
      filters.push(sql`r.status = ${opts.status}::report_status`);
    }
    if (cursor) {
      filters.push(
        sql`(r.created_at, r.id) < (${new Date(cursor.created_at)}::timestamptz, ${cursor.id}::uuid)`,
      );
    }
    const whereClause = filters.length
      ? sql`WHERE ${sql.join(filters, sql` AND `)}`
      : sql``;

    const rowsResult = await sql<RawReportRow>`
      SELECT r.id,
             r.reporter_user_id,
             ru.display_name AS reporter_display_name,
             ru.email::text AS reporter_email,
             ru.photo_url AS reporter_photo_url,
             r.target_kind, r.target_id,
             r.reason, r.status, r.notes,
             r.reviewed_by_user_id,
             rv.display_name AS reviewer_display_name,
             r.reviewed_at, r.created_at
        FROM reports r
        LEFT JOIN users ru ON ru.id = r.reporter_user_id
        LEFT JOIN users rv ON rv.id = r.reviewed_by_user_id
        ${whereClause}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ${limit + 1}
    `.execute(this.deps.db.db);

    const totalCountFilters = opts.status
      ? sql`WHERE r.status = ${opts.status}::report_status`
      : sql``;
    const totalResult = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM reports r ${totalCountFilters}
    `.execute(this.deps.db.db);

    const hasMore = rowsResult.rows.length > limit;
    const pageRows = hasMore ? rowsResult.rows.slice(0, limit) : rowsResult.rows;

    const targets = await this.resolveTargets(pageRows);

    const reports: EnrichedReportRow[] = pageRows.map((raw) => {
      const key = `${raw.target_kind}:${raw.target_id}`;
      const t = targets.get(key) ?? {
        kind: "missing" as const,
        claimed_kind: raw.target_kind,
        claimed_id: raw.target_id,
      };
      return buildEnrichedRow(raw, t);
    });

    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeReportsCursor({
            created_at: last.created_at.toISOString(),
            id: last.id,
          })
        : null;

    return {
      reports,
      total: Number(totalResult.rows[0]?.c ?? "0"),
      next_cursor: nextCursor,
    };
  }

  /**
   * Full enriched profile of a user: identity, activity counts, and the
   * most recent reports filed BY and ABOUT them. Used by the moderator
   * "click reporter or target" drilldown.
   */
  async getUserDetail(userId: string): Promise<EnrichedUserDetail> {
    const userResult = await sql<{
      id: string;
      email: string;
      display_name: string;
      photo_url: string | null;
      admin_role: "admin" | "moderator" | null;
      deleted_at: Date | null;
      created_at: Date;
      last_seen_at: Date | null;
    }>`
      SELECT u.id, u.email::text AS email, u.display_name, u.photo_url,
             u.admin_role, u.deleted_at, u.created_at, u.last_seen_at
        FROM users u
       WHERE u.id = ${userId}
    `.execute(this.deps.db.db);
    const userRow = userResult.rows[0];
    if (!userRow) throw new NotFoundError("User not found");

    const playedRow = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM game_participants
       WHERE user_id = ${userId}
         AND status IN ('played','confirmed')
    `.execute(this.deps.db.db);

    const hostedRow = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM games
       WHERE host_user_id = ${userId}
         AND deleted_at IS NULL
    `.execute(this.deps.db.db);

    const filedCountRow = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM reports
       WHERE reporter_user_id = ${userId}
    `.execute(this.deps.db.db);

    const receivedCountRow = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM reports
       WHERE target_kind = 'user' AND target_id = ${userId}
    `.execute(this.deps.db.db);

    const recentFiledRaw = await sql<RawReportRow>`
      SELECT r.id, r.reporter_user_id,
             ru.display_name AS reporter_display_name,
             ru.email::text AS reporter_email,
             ru.photo_url AS reporter_photo_url,
             r.target_kind, r.target_id, r.reason, r.status, r.notes,
             r.reviewed_by_user_id,
             rv.display_name AS reviewer_display_name,
             r.reviewed_at, r.created_at
        FROM reports r
        LEFT JOIN users ru ON ru.id = r.reporter_user_id
        LEFT JOIN users rv ON rv.id = r.reviewed_by_user_id
       WHERE r.reporter_user_id = ${userId}
       ORDER BY r.created_at DESC
       LIMIT 10
    `.execute(this.deps.db.db);

    const recentReceivedRaw = await sql<RawReportRow>`
      SELECT r.id, r.reporter_user_id,
             ru.display_name AS reporter_display_name,
             ru.email::text AS reporter_email,
             ru.photo_url AS reporter_photo_url,
             r.target_kind, r.target_id, r.reason, r.status, r.notes,
             r.reviewed_by_user_id,
             rv.display_name AS reviewer_display_name,
             r.reviewed_at, r.created_at
        FROM reports r
        LEFT JOIN users ru ON ru.id = r.reporter_user_id
        LEFT JOIN users rv ON rv.id = r.reviewed_by_user_id
       WHERE r.target_kind = 'user' AND r.target_id = ${userId}
       ORDER BY r.created_at DESC
       LIMIT 10
    `.execute(this.deps.db.db);

    const combinedRaw = [...recentFiledRaw.rows, ...recentReceivedRaw.rows];
    const targets = await this.resolveTargets(combinedRaw);

    const toEnriched = (rows: RawReportRow[]): EnrichedReportRow[] =>
      rows.map((raw) => {
        const key = `${raw.target_kind}:${raw.target_id}`;
        const t = targets.get(key) ?? {
          kind: "missing" as const,
          claimed_kind: raw.target_kind,
          claimed_id: raw.target_id,
        };
        return buildEnrichedRow(raw, t);
      });

    return {
      id: userRow.id,
      email: userRow.email,
      display_name: userRow.display_name,
      photo_url: userRow.photo_url,
      admin_role: userRow.admin_role,
      deleted_at: userRow.deleted_at?.toISOString() ?? null,
      created_at: userRow.created_at.toISOString(),
      last_seen_at: userRow.last_seen_at?.toISOString() ?? null,
      games_played_total: Number(playedRow.rows[0]?.c ?? "0"),
      games_hosted_total: Number(hostedRow.rows[0]?.c ?? "0"),
      reports_filed_count: Number(filedCountRow.rows[0]?.c ?? "0"),
      reports_received_count: Number(receivedCountRow.rows[0]?.c ?? "0"),
      recent_reports_filed: toEnriched(recentFiledRaw.rows),
      recent_reports_received: toEnriched(recentReceivedRaw.rows),
    };
  }

  /**
   * Reviewing a report with optional target action. All side effects in a
   * single transaction so a partial failure leaves the queue + the target
   * in a consistent state.
   *
   * Action semantics:
   *  - `dismiss` → status='dismissed', no target effect.
   *  - `warn` → status='reviewed', no target effect (warning is delivered
   *    out-of-band; for now we just stamp a moderator note).
   *  - `deactivate_target` → status='reviewed', if target is a user we
   *    soft-delete them (deleted_at + revoke refresh tokens). If target is
   *    a game we cancel the game. If target is a message, we no-op the
   *    target side (messages aren't independently deactivatable) and let
   *    the audit row carry the moderator intent.
   *  - `delete_target` → status='reviewed', stronger variant — for users
   *    same as deactivate (soft-delete); for games we soft-delete (sets
   *    deleted_at); for messages we delete the row.
   *
   * Idempotency: reviewing an already-reviewed/dismissed report is a 409.
   */
  async reviewWithAction(
    adminId: string,
    reportId: string,
    opts: { action: ModerationAction; notes?: string | null },
  ): Promise<EnrichedReportRow> {
    const enriched = await withTransaction(this.deps.db.db, async (tx) => {
      const existing = await tx
        .selectFrom("reports")
        .selectAll()
        .where("id", "=", reportId)
        .executeTakeFirst();
      if (!existing) throw new NotFoundError("Report not found");
      if (existing.status !== "pending") {
        throw new ConflictError("Report has already been reviewed");
      }

      const newStatus: ReportStatus =
        opts.action === "dismiss" ? "dismissed" : "reviewed";

      await tx
        .updateTable("reports")
        .set({
          status: newStatus,
          notes: opts.notes ?? existing.notes,
          reviewed_by_user_id: adminId,
          reviewed_at: new Date(),
        })
        .where("id", "=", reportId)
        .execute();

      // Take the action on the target if requested.
      let targetMutation: Record<string, unknown> = {};
      if (
        opts.action === "deactivate_target" ||
        opts.action === "delete_target"
      ) {
        if (existing.target_kind === "user") {
          const userRow = await tx
            .selectFrom("users")
            .select(["id", "deleted_at"])
            .where("id", "=", existing.target_id)
            .executeTakeFirst();
          const userDeletedAt = userRow ? userRow.deleted_at : undefined;
          if (userDeletedAt === null) {
            await tx
              .updateTable("users")
              .set({ deleted_at: new Date() })
              .where("id", "=", existing.target_id)
              .execute();
            await tx
              .updateTable("refresh_tokens")
              .set({ revoked_at: new Date() })
              .where("user_id", "=", existing.target_id)
              .where("revoked_at", "is", null)
              .execute();
            targetMutation = { user_soft_deleted: existing.target_id };
          }
        } else if (existing.target_kind === "game") {
          const gameRow = await tx
            .selectFrom("games")
            .select(["id", "status", "deleted_at"])
            .where("id", "=", existing.target_id)
            .executeTakeFirst();
          if (gameRow) {
            if (gameRow.status !== "cancelled") {
              await tx
                .updateTable("games")
                .set({ status: "cancelled" })
                .where("id", "=", existing.target_id)
                .execute();
              await tx
                .updateTable("game_participants")
                .set({
                  status: "cancelled",
                  status_changed_at: new Date(),
                })
                .where("game_id", "=", existing.target_id)
                .where("status", "=", "confirmed")
                .execute();
              targetMutation = { game_cancelled: existing.target_id };
            }
            if (
              opts.action === "delete_target" &&
              gameRow.deleted_at === null
            ) {
              await tx
                .updateTable("games")
                .set({ deleted_at: new Date() })
                .where("id", "=", existing.target_id)
                .execute();
              targetMutation = {
                ...targetMutation,
                game_soft_deleted: existing.target_id,
              };
            }
          }
        } else if (existing.target_kind === "message") {
          if (opts.action === "delete_target") {
            await tx
              .deleteFrom("messages")
              .where("id", "=", existing.target_id)
              .execute();
            targetMutation = { message_deleted: existing.target_id };
          }
        }
      }

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.moderation.review",
          entity: "report",
          entity_id: reportId,
          metadata: {
            action: opts.action,
            status: newStatus,
            notes: opts.notes ?? null,
            target_kind: existing.target_kind,
            target_id: existing.target_id,
            ...targetMutation,
          },
        })
        .execute();

      // Re-read the fully-updated row + reporter + reviewer name for the
      // response. Cheaper than re-running the enriched list query.
      const updatedResult = await sql<RawReportRow>`
        SELECT r.id, r.reporter_user_id,
               ru.display_name AS reporter_display_name,
               ru.email::text AS reporter_email,
               ru.photo_url AS reporter_photo_url,
               r.target_kind, r.target_id, r.reason, r.status, r.notes,
               r.reviewed_by_user_id,
               rv.display_name AS reviewer_display_name,
               r.reviewed_at, r.created_at
          FROM reports r
          LEFT JOIN users ru ON ru.id = r.reporter_user_id
          LEFT JOIN users rv ON rv.id = r.reviewed_by_user_id
         WHERE r.id = ${reportId}
      `.execute(tx);
      const raw = updatedResult.rows[0];
      if (!raw) throw new NotFoundError("Report not found");
      return raw;
    });

    const targets = await this.resolveTargets([enriched]);
    const key = `${enriched.target_kind}:${enriched.target_id}`;
    const target =
      targets.get(key) ?? {
        kind: "missing" as const,
        claimed_kind: enriched.target_kind,
        claimed_id: enriched.target_id,
      };
    return buildEnrichedRow(enriched, target);
  }

  /**
   * Admin force-deactivate of a user. Wraps the existing soft-delete with
   * an explicit reason + optional duration so moderators can record intent
   * even when the underlying mechanism is the same (deleted_at NOT NULL).
   *
   * If duration_days is provided we don't auto-restore — that's a future
   * task; we just record the intended duration on the audit row so a
   * scheduled job can pick it up later.
   */
  async deactivateUser(
    adminId: string,
    userId: string,
    opts: { reason: string; duration_days?: number | null },
  ): Promise<void> {
    await withTransaction(this.deps.db.db, async (tx) => {
      const target = await tx
        .selectFrom("users")
        .select(["id", "deleted_at"])
        .where("id", "=", userId)
        .executeTakeFirst();
      if (!target) throw new NotFoundError("User not found");
      if (target.deleted_at !== null) {
        throw new ConflictError("User is already deactivated");
      }

      await tx
        .updateTable("users")
        .set({ deleted_at: new Date() })
        .where("id", "=", userId)
        .execute();

      await tx
        .updateTable("refresh_tokens")
        .set({ revoked_at: new Date() })
        .where("user_id", "=", userId)
        .where("revoked_at", "is", null)
        .execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.users.deactivate",
          entity: "user",
          entity_id: userId,
          metadata: {
            reason: opts.reason,
            duration_days: opts.duration_days ?? null,
          },
        })
        .execute();
    });
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  /**
   * Resolve all target rows in 3 batched queries (one per kind) and
   * return a Map keyed on `${kind}:${id}`. Returns "missing" for targets
   * that have since been deleted.
   */
  private async resolveTargets(
    rows: { target_kind: ReportTargetKind; target_id: string }[],
  ): Promise<Map<string, EnrichedTarget>> {
    const out = new Map<string, EnrichedTarget>();

    const userIds = [
      ...new Set(rows.filter((r) => r.target_kind === "user").map((r) => r.target_id)),
    ];
    const gameIds = [
      ...new Set(rows.filter((r) => r.target_kind === "game").map((r) => r.target_id)),
    ];
    const messageIds = [
      ...new Set(rows.filter((r) => r.target_kind === "message").map((r) => r.target_id)),
    ];

    if (userIds.length > 0) {
      const users = await this.deps.db.db
        .selectFrom("users")
        .select([
          "id",
          "display_name",
          "email",
          "photo_url",
          "deleted_at",
          "created_at",
        ])
        .where("id", "in", userIds)
        .execute();
      for (const u of users) {
        out.set(`user:${u.id}`, {
          kind: "user",
          user_id: u.id,
          display_name: u.display_name,
          // email column is citext — Kysely returns it as the string the DB
          // sends; cast for the response shape.
          email: u.email,
          photo_url: u.photo_url,
          deleted_at: u.deleted_at?.toISOString() ?? null,
          created_at: u.created_at.toISOString(),
        });
      }
    }

    if (gameIds.length > 0) {
      const games = await sql<{
        id: string;
        host_user_id: string;
        host_display_name: string | null;
        sport_slug: string | null;
        starts_at: Date;
        status: string;
        deleted_at: Date | null;
      }>`
        SELECT g.id, g.host_user_id,
               u.display_name AS host_display_name,
               s.slug AS sport_slug,
               g.starts_at, g.status::text AS status, g.deleted_at
          FROM games g
          LEFT JOIN users  u ON u.id = g.host_user_id
          LEFT JOIN sports s ON s.id = g.sport_id
         WHERE g.id IN (${sql.join(gameIds.map((id) => sql`${id}::uuid`))})
      `.execute(this.deps.db.db);
      for (const g of games.rows) {
        out.set(`game:${g.id}`, {
          kind: "game",
          game_id: g.id,
          host_user_id: g.host_user_id,
          host_display_name: g.host_display_name,
          sport_slug: g.sport_slug,
          starts_at: g.starts_at.toISOString(),
          status: g.status,
          deleted_at: g.deleted_at?.toISOString() ?? null,
        });
      }
    }

    if (messageIds.length > 0) {
      const messages = await sql<{
        id: string;
        conversation_id: string;
        sender_user_id: string;
        sender_display_name: string | null;
        body: string;
        created_at: Date;
      }>`
        SELECT m.id, m.conversation_id, m.sender_user_id,
               u.display_name AS sender_display_name,
               m.body, m.created_at
          FROM messages m
          LEFT JOIN users u ON u.id = m.sender_user_id
         WHERE m.id IN (${sql.join(messageIds.map((id) => sql`${id}::uuid`))})
      `.execute(this.deps.db.db);
      for (const m of messages.rows) {
        out.set(`message:${m.id}`, {
          kind: "message",
          message_id: m.id,
          conversation_id: m.conversation_id,
          sender_user_id: m.sender_user_id,
          sender_display_name: m.sender_display_name,
          body_preview: m.body.length > 200 ? `${m.body.slice(0, 200)}…` : m.body,
          created_at: m.created_at.toISOString(),
        });
      }
    }

    return out;
  }
}
