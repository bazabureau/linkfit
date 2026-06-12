import { Buffer } from "node:buffer";
import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import {
  type ReviewSort,
  type UpsertVenueReviewInput,
  type VenueRatingSummary,
  type VenueReview,
  type VenueReviewsPage,
} from "./venue-reviews.schema.js";

export interface VenueReviewsServiceDeps {
  db: DbHandle;
}

export interface ListVenueReviewsQuery {
  limit?: number | undefined;
  cursor?: string | undefined;
  sort?: ReviewSort | undefined;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

interface RecentCursor {
  created_at: string;
  id: string;
}
interface HighestCursor {
  rating: number;
  created_at: string;
  id: string;
}
type Cursor = RecentCursor | HighestCursor;

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeRecentCursor(s: string): RecentCursor | null {
  try {
    const raw = Buffer.from(s, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.created_at === "string" &&
      typeof parsed.id === "string"
    ) {
      return { created_at: parsed.created_at, id: parsed.id };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function decodeHighestCursor(s: string): HighestCursor | null {
  try {
    const raw = Buffer.from(s, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.rating === "number" &&
      typeof parsed.created_at === "string" &&
      typeof parsed.id === "string"
    ) {
      return {
        rating: parsed.rating,
        created_at: parsed.created_at,
        id: parsed.id,
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (limit < 1) return 1;
  if (limit > MAX_LIMIT) return MAX_LIMIT;
  return Math.trunc(limit);
}

interface ReviewRow {
  id: string;
  venue_id: string;
  rating: number;
  body: string | null;
  photo_url: string | null;
  created_at: Date;
  updated_at: Date;
  author_id: string;
  author_display_name: string;
  author_photo_url: string | null;
}

function toReview(r: ReviewRow): VenueReview {
  return {
    id: r.id,
    venue_id: r.venue_id,
    rating: r.rating,
    body: r.body,
    photo_url: r.photo_url,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    author: {
      id: r.author_id,
      display_name: r.author_display_name,
      photo_url: r.author_photo_url,
    },
  };
}

/**
 * VenueReviewsService — owns CRUD against `venue_reviews` plus the aggregate
 * surface served by `GET /api/v1/venues/:id/rating-summary`.
 *
 * Soft-delete model: `removed_at` is set on author-initiated deletes. All
 * read queries filter `removed_at IS NULL`, which is also what the
 * `venue_rating_summary` view enforces — so avg/count drop a removed
 * review automatically.
 */
export class VenueReviewsService {
  constructor(private readonly deps: VenueReviewsServiceDeps) {}

  /**
   * Upsert a review. Existing (venue, author) → update; otherwise insert.
   * Returns the canonical row including the author projection so the iOS
   * client can show the new card without a second round-trip.
   */
  async upsert(
    venueId: string,
    authorUserId: string,
    input: UpsertVenueReviewInput,
  ): Promise<VenueReview> {
    await this.assertVenueExists(venueId);

    const body = input.body !== undefined && input.body.length > 0 ? input.body : null;
    const photoUrl = input.photo_url ?? null;

    // Use raw SQL for the ON CONFLICT — it lets us re-activate soft-deleted
    // rows in the same statement by clearing `removed_at`. This means a user
    // who deleted their review can write a fresh one without uniqueness
    // pain, and it's the canonical "I changed my mind" path.
    const inserted = await sql<{ id: string }>`
      INSERT INTO venue_reviews (venue_id, author_user_id, rating, body, photo_url)
      VALUES (${venueId}::uuid, ${authorUserId}::uuid, ${input.rating}::smallint,
              ${body}, ${photoUrl})
      ON CONFLICT (venue_id, author_user_id) DO UPDATE
         SET rating     = EXCLUDED.rating,
             body       = EXCLUDED.body,
             photo_url  = EXCLUDED.photo_url,
             removed_at = NULL,
             updated_at = now()
      RETURNING id
    `.execute(this.deps.db.db);

    const id = inserted.rows[0]?.id;
    if (!id) throw new Error("Upsert returned no row — should be impossible");
    return this.getByIdOrThrow(id);
  }

  /**
   * Paginated review list. Recent-first by default; `highest` orders by
   * rating DESC with newest-first as the tie-breaker. Cursor payloads
   * differ between the two so swapping `sort` mid-pagination is
   * rejected by the decoder.
   */
  async list(venueId: string, query: ListVenueReviewsQuery): Promise<VenueReviewsPage> {
    await this.assertVenueExists(venueId);
    const limit = clampLimit(query.limit);
    const sort: ReviewSort = query.sort ?? "recent";

    let rows: ReviewRow[];

    if (sort === "highest") {
      let cursor: HighestCursor | null = null;
      if (query.cursor !== undefined && query.cursor.length > 0) {
        cursor = decodeHighestCursor(query.cursor);
        if (!cursor) throw new ValidationError("Invalid cursor");
      }
      const result = await sql<ReviewRow>`
        SELECT vr.id, vr.venue_id, vr.rating, vr.body, vr.photo_url,
               vr.created_at, vr.updated_at,
               u.id AS author_id, u.display_name AS author_display_name,
               u.photo_url AS author_photo_url
          FROM venue_reviews vr
          JOIN users u ON u.id = vr.author_user_id
         WHERE vr.venue_id = ${venueId}::uuid
           AND vr.removed_at IS NULL
           AND u.deleted_at IS NULL
           ${
             cursor
               ? sql`AND (vr.rating, vr.created_at, vr.id) < (${cursor.rating}::smallint, ${cursor.created_at}::timestamptz, ${cursor.id}::uuid)`
               : sql``
           }
         ORDER BY vr.rating DESC, vr.created_at DESC, vr.id DESC
         LIMIT ${limit + 1}
      `.execute(this.deps.db.db);
      rows = result.rows;
    } else {
      let cursor: RecentCursor | null = null;
      if (query.cursor !== undefined && query.cursor.length > 0) {
        cursor = decodeRecentCursor(query.cursor);
        if (!cursor) throw new ValidationError("Invalid cursor");
      }
      const result = await sql<ReviewRow>`
        SELECT vr.id, vr.venue_id, vr.rating, vr.body, vr.photo_url,
               vr.created_at, vr.updated_at,
               u.id AS author_id, u.display_name AS author_display_name,
               u.photo_url AS author_photo_url
          FROM venue_reviews vr
          JOIN users u ON u.id = vr.author_user_id
         WHERE vr.venue_id = ${venueId}::uuid
           AND vr.removed_at IS NULL
           AND u.deleted_at IS NULL
           ${
             cursor
               ? sql`AND (vr.created_at, vr.id) < (${cursor.created_at}::timestamptz, ${cursor.id}::uuid)`
               : sql``
           }
         ORDER BY vr.created_at DESC, vr.id DESC
         LIMIT ${limit + 1}
      `.execute(this.deps.db.db);
      rows = result.rows;
    }

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const items = trimmed.map(toReview);

    let next_cursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastRow = trimmed[trimmed.length - 1];
      if (lastRow !== undefined) {
        if (sort === "highest") {
          next_cursor = encodeCursor({
            rating: lastRow.rating,
            created_at: lastRow.created_at.toISOString(),
            id: lastRow.id,
          });
        } else {
          next_cursor = encodeCursor({
            created_at: lastRow.created_at.toISOString(),
            id: lastRow.id,
          });
        }
      }
    }

    return { items, next_cursor };
  }

  /**
   * Avg + count + 1..5 histogram. We compute everything off the live
   * `venue_reviews` rows (not the view) so the histogram comes out of the
   * same query as the totals — one round-trip, zero risk of drift.
   */
  async summary(venueId: string): Promise<VenueRatingSummary> {
    await this.assertVenueExists(venueId);

    const result = await sql<{
      avg_rating: string | null;
      review_count: string;
      c1: string;
      c2: string;
      c3: string;
      c4: string;
      c5: string;
    }>`
      SELECT
        ROUND(AVG(rating)::numeric, 2)::text                   AS avg_rating,
        COUNT(*)::text                                         AS review_count,
        COUNT(*) FILTER (WHERE rating = 1)::text               AS c1,
        COUNT(*) FILTER (WHERE rating = 2)::text               AS c2,
        COUNT(*) FILTER (WHERE rating = 3)::text               AS c3,
        COUNT(*) FILTER (WHERE rating = 4)::text               AS c4,
        COUNT(*) FILTER (WHERE rating = 5)::text               AS c5
        FROM venue_reviews
       WHERE venue_id = ${venueId}::uuid
         AND removed_at IS NULL
    `.execute(this.deps.db.db);

    const row = result.rows[0];
    const avg = row?.avg_rating ?? null;
    return {
      venue_id: venueId,
      avg_rating: avg === null ? null : Number(avg),
      review_count: Number(row?.review_count ?? "0"),
      histogram: {
        "1": Number(row?.c1 ?? "0"),
        "2": Number(row?.c2 ?? "0"),
        "3": Number(row?.c3 ?? "0"),
        "4": Number(row?.c4 ?? "0"),
        "5": Number(row?.c5 ?? "0"),
      },
    };
  }

  /**
   * Author-only soft-delete. Marks `removed_at = now()` so the row
   * disappears from listings and aggregates without losing the audit trail.
   */
  async remove(reviewId: string, authorUserId: string): Promise<void> {
    const row = await sql<{ author_user_id: string; removed_at: Date | null }>`
      SELECT author_user_id, removed_at
        FROM venue_reviews
       WHERE id = ${reviewId}::uuid
    `.execute(this.deps.db.db);
    const existing = row.rows[0];
    if (existing?.removed_at !== null) {
      throw new NotFoundError("Review not found");
    }
    if (existing.author_user_id !== authorUserId) {
      throw new ForbiddenError("Only the author can delete this review");
    }
    await sql`
      UPDATE venue_reviews
         SET removed_at = now(),
             updated_at = now()
       WHERE id = ${reviewId}::uuid
    `.execute(this.deps.db.db);
  }

  // ── internals ──────────────────────────────────────────────────────

  private async assertVenueExists(venueId: string): Promise<void> {
    const row = await this.deps.db.db
      .selectFrom("venues")
      .select("id")
      .where("id", "=", venueId)
      .executeTakeFirst();
    if (!row) throw new NotFoundError("Venue not found");
  }

  private async getByIdOrThrow(reviewId: string): Promise<VenueReview> {
    const result = await sql<ReviewRow>`
      SELECT vr.id, vr.venue_id, vr.rating, vr.body, vr.photo_url,
             vr.created_at, vr.updated_at,
             u.id AS author_id, u.display_name AS author_display_name,
             u.photo_url AS author_photo_url
        FROM venue_reviews vr
        JOIN users u ON u.id = vr.author_user_id
       WHERE vr.id = ${reviewId}::uuid
         AND vr.removed_at IS NULL
    `.execute(this.deps.db.db);
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Review not found");
    return toReview(row);
  }
}
