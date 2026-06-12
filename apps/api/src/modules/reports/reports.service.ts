import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  ConflictError,
  NotFoundError,
  RateLimitedError,
} from "../../shared/errors/AppError.js";
import {
  type ReportReason,
  type ReportStatus,
  type ReportTargetKind,
} from "../../shared/db/types.js";
import {
  type CreateReportRequest,
  type MyReportItem,
  type MyReportsQuery,
  type MyReportsResponse,
  type ReportOut,
  type ReportsListQuery,
  type ReviewReportRequest,
} from "./reports.schema.js";

/**
 * Opaque cursor for the user-facing `GET /me/reports` feed. Keyset-paginated
 * over `(created_at DESC, id DESC)` — same shape used by the feed-comments
 * module so the iOS history screen scrolls newest-first without skipping
 * rows at identical timestamps.
 */
interface MyReportsCursor {
  created_at: string;
  id: string;
}

function encodeMyReportsCursor(c: MyReportsCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeMyReportsCursor(s: string): MyReportsCursor | null {
  try {
    const raw = Buffer.from(s, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "created_at" in parsed &&
      "id" in parsed &&
      typeof (parsed as { created_at: unknown }).created_at === "string" &&
      typeof (parsed as { id: unknown }).id === "string"
    ) {
      return parsed as MyReportsCursor;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Reasons that trigger threshold-based auto-flagging. Two of the six
 * because the others (spam, no_show, inappropriate_content, other) tend to
 * generate more noise per offence and would auto-flag too aggressively. */
const HIGH_SIGNAL_REASONS: ReadonlySet<ReportReason> = new Set([
  "harassment",
  "fake_profile",
]);

/** Threshold at which we emit the `report.auto_flagged` audit entry. */
const AUTO_FLAG_THRESHOLD = 3;

/** Rate limit: 5 reports per user per rolling hour. Prevents a single
 * disgruntled user from drowning the moderation queue. Implemented in-DB,
 * not via @fastify/rate-limit, so the limit follows the user across IPs /
 * devices and survives restarts. */
const MAX_REPORTS_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export interface ReportsServiceDeps {
  db: DbHandle;
}

interface ReportRowWithReporter {
  id: string;
  reporter_user_id: string;
  reporter_display_name: string | null;
  target_kind: ReportTargetKind;
  target_id: string;
  reason: ReportReason;
  status: ReportStatus;
  notes: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

function toOut(r: ReportRowWithReporter): ReportOut {
  return {
    id: r.id,
    reporter_user_id: r.reporter_user_id,
    reporter_display_name: r.reporter_display_name,
    target_kind: r.target_kind,
    target_id: r.target_id,
    reason: r.reason,
    status: r.status,
    notes: r.notes,
    reviewed_by_user_id: r.reviewed_by_user_id,
    reviewed_at: r.reviewed_at?.toISOString() ?? null,
    created_at: r.created_at.toISOString(),
  };
}

export class ReportsService {
  constructor(private readonly deps: ReportsServiceDeps) {}

  /**
   * User-facing report creation.
   *
   * Side effects (all inside one transaction):
   *  1. Insert the report row.
   *  2. If reason is high-signal AND the target now has ≥ AUTO_FLAG_THRESHOLD
   *     pending reports, emit a single `report.auto_flagged` audit_log entry
   *     for admin attention. Idempotent — we don't double-emit if a row
   *     already exists for this target/threshold.
   *
   * Pre-checks (before the transaction, to fail fast and avoid the write):
   *  - Rate limit: max 5 reports/user/hour.
   *  - Target existence: prevents reports against deleted/ghost rows.
   */
  async create(reporterUserId: string, req: CreateReportRequest): Promise<ReportOut> {
    await this.enforceRateLimit(reporterUserId);
    await this.assertTargetExists(req.target_kind, req.target_id);

    return withTransaction(this.deps.db.db, async (tx) => {
      const row = await tx
        .insertInto("reports")
        .values({
          reporter_user_id: reporterUserId,
          target_kind: req.target_kind,
          target_id: req.target_id,
          reason: req.reason,
          notes: req.notes ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (HIGH_SIGNAL_REASONS.has(req.reason)) {
        const pendingCountResult = await tx
          .selectFrom("reports")
          .select((eb) => eb.fn.countAll<string>().as("c"))
          .where("target_kind", "=", req.target_kind)
          .where("target_id", "=", req.target_id)
          .where("status", "=", "pending")
          .executeTakeFirst();

        const pendingCount = Number(pendingCountResult?.c ?? "0");
        if (pendingCount >= AUTO_FLAG_THRESHOLD) {
          // Only flag once per (target_kind, target_id) until an admin
          // clears it. The presence of an existing auto_flagged audit row
          // for this target with no follow-up review action is enough.
          const existingFlag = await tx
            .selectFrom("audit_log")
            .select("id")
            .where("action", "=", "report.auto_flagged")
            .where("entity", "=", req.target_kind)
            .where("entity_id", "=", req.target_id)
            .where(
              "created_at",
              ">",
              new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            )
            .executeTakeFirst();
          if (!existingFlag) {
            await tx
              .insertInto("audit_log")
              .values({
                actor_user_id: null,
                action: "report.auto_flagged",
                entity: req.target_kind,
                entity_id: req.target_id,
                metadata: {
                  reason: req.reason,
                  pending_count: pendingCount,
                  triggering_report_id: row.id,
                },
              })
              .execute();
          }
        }
      }

      // Reporter display name is useful for the admin queue UI. Looked up
      // inside the tx so the response always reflects the user's current
      // name even if they renamed seconds before reporting.
      const reporter = await tx
        .selectFrom("users")
        .select("display_name")
        .where("id", "=", reporterUserId)
        .executeTakeFirst();

      return toOut({
        ...row,
        reporter_display_name: reporter?.display_name ?? null,
      });
    });
  }

  /** Admin queue listing. Default status filter `pending` is applied at the
   * route level, not here, so callers can opt out. */
  async list(query: ReportsListQuery): Promise<{ items: ReportOut[]; total: number }> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);

    const baseFilter = query.status
      ? sql`WHERE r.status = ${query.status}::report_status`
      : sql``;

    const rowsResult = await sql<ReportRowWithReporter>`
      SELECT r.id, r.reporter_user_id, u.display_name AS reporter_display_name,
             r.target_kind, r.target_id, r.reason, r.status, r.notes,
             r.reviewed_by_user_id, r.reviewed_at, r.created_at
        FROM reports r
        LEFT JOIN users u ON u.id = r.reporter_user_id
        ${baseFilter}
       ORDER BY r.created_at DESC, r.id ASC
       LIMIT ${limit} OFFSET ${offset}
    `.execute(this.deps.db.db);

    const totalResult = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM reports r ${baseFilter}
    `.execute(this.deps.db.db);

    return {
      items: rowsResult.rows.map(toOut),
      total: Number(totalResult.rows[0]?.c ?? "0"),
    };
  }

  /**
   * Admin marks a pending report as reviewed or dismissed. Idempotency: a
   * non-pending report is rejected with 409 — review decisions don't get
   * silently overwritten. Sets reviewed_by_user_id + reviewed_at and
   * emits an audit_log entry.
   */
  async review(
    adminId: string,
    reportId: string,
    req: ReviewReportRequest,
  ): Promise<ReportOut> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const existing = await tx
        .selectFrom("reports")
        .selectAll()
        .where("id", "=", reportId)
        .executeTakeFirst();
      if (!existing) throw new NotFoundError("Report not found");
      if (existing.status !== "pending") {
        throw new ConflictError("Report has already been reviewed");
      }

      const updated = await tx
        .updateTable("reports")
        .set({
          status: req.status,
          notes: req.notes ?? existing.notes,
          reviewed_by_user_id: adminId,
          reviewed_at: new Date(),
        })
        .where("id", "=", reportId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.reports.review",
          entity: "report",
          entity_id: reportId,
          metadata: {
            status: req.status,
            notes: req.notes ?? null,
            target_kind: existing.target_kind,
            target_id: existing.target_id,
          },
        })
        .execute();

      const reporter = await tx
        .selectFrom("users")
        .select("display_name")
        .where("id", "=", updated.reporter_user_id)
        .executeTakeFirst();

      return toOut({
        ...updated,
        reporter_display_name: reporter?.display_name ?? null,
      });
    });
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private async enforceRateLimit(reporterUserId: string): Promise<void> {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const result = await this.deps.db.db
      .selectFrom("reports")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("reporter_user_id", "=", reporterUserId)
      .where("created_at", ">", windowStart)
      .executeTakeFirst();
    const count = Number(result?.c ?? "0");
    if (count >= MAX_REPORTS_PER_HOUR) {
      throw new RateLimitedError(
        `Too many reports — limit is ${String(MAX_REPORTS_PER_HOUR)} per hour. Try again later.`,
      );
    }
  }

  private async assertTargetExists(kind: ReportTargetKind, id: string): Promise<void> {
    if (kind === "user") {
      const row = await this.deps.db.db
        .selectFrom("users")
        .select("id")
        .where("id", "=", id)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (!row) throw new NotFoundError("Reported user not found");
      return;
    }
    if (kind === "game") {
      const row = await this.deps.db.db
        .selectFrom("games")
        .select("id")
        .where("id", "=", id)
        .executeTakeFirst();
      if (!row) throw new NotFoundError("Reported game not found");
      return;
    }
    if (kind === "story") {
      // Stories hard-delete past `expires_at` via the StoriesExpireSweeper,
      // so a row that still exists is reportable. We don't filter on
      // `expires_at` here — a viewer who reports a story right before it
      // expires shouldn't lose their report to a 5-minute timing window.
      const row = await this.deps.db.db
        .selectFrom("stories")
        .select("id")
        .where("id", "=", id)
        .executeTakeFirst();
      if (!row) throw new NotFoundError("Reported story not found");
      return;
    }
    if (kind === "feed_comment") {
      // feed_comments isn't (yet) in the shared Kysely Database interface
      // — see modules/feed-comments/feed-comments.service.ts for why we
      // use raw SQL here. Same parameterised-query path, no injection
      // delta vs. the typed builder.
      const row = await sql<{ id: string }>`
        SELECT id FROM feed_comments WHERE id = ${id}::uuid
      `.execute(this.deps.db.db);
      if (!row.rows[0]) throw new NotFoundError("Reported comment not found");
      return;
    }
    const row = await this.deps.db.db
      .selectFrom("messages")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError("Reported message not found");
  }

  /**
   * User-facing "my reports" history. Returns the caller's reports newest
   * first with an opaque keyset cursor. Excludes reviewer metadata — the
   * reporter never sees who reviewed it or what notes they wrote.
   *
   * Why not reuse `list()`: the admin queue list is keyed off `status` and
   * does an unfiltered scan inside that bucket; the user-facing query is
   * keyed off `reporter_user_id` and uses a different index path. Mixing
   * the two would force the user query through the admin's status filter
   * and add a permission branch in the middle of an otherwise simple
   * query. Two methods keep both call sites tight.
   */
  async listMy(reporterUserId: string, query: MyReportsQuery): Promise<MyReportsResponse> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    let cursor: MyReportsCursor | null = null;
    if (query.cursor !== undefined && query.cursor.length > 0) {
      cursor = decodeMyReportsCursor(query.cursor);
      // Bad cursor → empty page rather than 400. The iOS client cycles
      // app versions through cursor schema changes; a stale cursor from
      // an older build shouldn't blow up the screen.
      if (!cursor) {
        return { reports: [], next_cursor: null };
      }
    }

    // Pull limit+1 so we know whether there's a next page without a
    // separate COUNT roundtrip.
    let q = this.deps.db.db
      .selectFrom("reports")
      .select(["id", "target_kind", "target_id", "status", "created_at"])
      .where("reporter_user_id", "=", reporterUserId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(limit + 1);
    if (cursor) {
      const cursorCreatedAt = cursor.created_at;
      const cursorId = cursor.id;
      q = q.where((eb) =>
        eb.or([
          eb("created_at", "<", new Date(cursorCreatedAt)),
          eb.and([
            eb("created_at", "=", new Date(cursorCreatedAt)),
            eb("id", "<", cursorId),
          ]),
        ]),
      );
    }

    const rows = await q.execute();
    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const reports: MyReportItem[] = trimmed.map((r) => ({
      id: r.id,
      target_kind: r.target_kind,
      target_id: r.target_id,
      status: r.status,
      created_at: r.created_at.toISOString(),
    }));
    const last = trimmed[trimmed.length - 1];
    const next_cursor =
      hasMore && last
        ? encodeMyReportsCursor({
            created_at: last.created_at.toISOString(),
            id: last.id,
          })
        : null;

    return { reports, next_cursor };
  }
}
