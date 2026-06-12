import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import {
  createTestUser,
  seedBakuPadelVenues,
  truncateAll,
  type SeedVenue,
} from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";

/**
 * Venue reviews integration tests. Exercise the full HTTP surface
 * against a real Postgres so we cover Zod, route plumbing, the service
 * UPSERT path, and the aggregate view in one shot.
 */

interface ReviewBody {
  id: string;
  venue_id: string;
  rating: number;
  body: string | null;
  photo_url: string | null;
  author: { id: string; display_name: string; photo_url: string | null };
  created_at: string;
  updated_at: string;
}

interface ReviewsPage {
  items: ReviewBody[];
  next_cursor: string | null;
}

interface SummaryBody {
  venue_id: string;
  avg_rating: number | null;
  review_count: number;
  histogram: { "1": number; "2": number; "3": number; "4": number; "5": number };
}

describe("venue-reviews routes", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let venues: SeedVenue[];

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
    venues = await seedBakuPadelVenues(db);
  });

  it("creates a review (happy path) and surfaces it in the summary", async () => {
    const alice = await createTestUser(app, { display_name: "Alice" });
    const venueId = venues[0]!.id;

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/venues/${venueId}/reviews`,
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { rating: 5, body: "Best courts in town" },
    });
    expect(res.statusCode).toBe(201);
    const review = res.json<ReviewBody>();
    expect(review.rating).toBe(5);
    expect(review.body).toBe("Best courts in town");
    expect(review.author.display_name).toBe("Alice");

    const summaryRes = await app.inject({
      method: "GET",
      url: `/api/v1/venues/${venueId}/rating-summary`,
    });
    expect(summaryRes.statusCode).toBe(200);
    const summary = summaryRes.json<SummaryBody>();
    expect(summary.avg_rating).toBe(5);
    expect(summary.review_count).toBe(1);
    expect(summary.histogram["5"]).toBe(1);
  });

  it("UPSERTs a second review by the same author onto the same row", async () => {
    const alice = await createTestUser(app, { display_name: "Alice" });
    const venueId = venues[0]!.id;

    await app.inject({
      method: "POST",
      url: `/api/v1/venues/${venueId}/reviews`,
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { rating: 2, body: "Meh" },
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/venues/${venueId}/reviews`,
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { rating: 5, body: "Changed my mind" },
    });
    expect(second.statusCode).toBe(201);

    // Exactly one live row remains.
    const count = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM venue_reviews
       WHERE venue_id = ${venueId} AND removed_at IS NULL
    `.execute(db.db);
    expect(Number(count.rows[0]!.c)).toBe(1);

    const summary = (await app.inject({
      method: "GET",
      url: `/api/v1/venues/${venueId}/rating-summary`,
    })).json<SummaryBody>();
    expect(summary.review_count).toBe(1);
    expect(summary.avg_rating).toBe(5);
  });

  it("rejects rating outside 1..5 with 400", async () => {
    const alice = await createTestUser(app);
    const venueId = venues[0]!.id;

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/venues/${venueId}/reviews`,
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { rating: 7 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("requires authentication on POST and DELETE", async () => {
    const venueId = venues[0]!.id;
    const noAuth = await app.inject({
      method: "POST",
      url: `/api/v1/venues/${venueId}/reviews`,
      payload: { rating: 3 },
    });
    expect(noAuth.statusCode).toBe(401);

    const badDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/reviews/00000000-0000-0000-0000-000000000000`,
    });
    expect(badDelete.statusCode).toBe(401);
  });

  it("lists reviews newest-first with cursor pagination", async () => {
    const venueId = venues[0]!.id;
    // Insert three reviews from three users. Wall-clock order is the
    // expected sort order (newest first).
    const ratings = [3, 4, 5];
    for (const r of ratings) {
      const u = await createTestUser(app, { display_name: `U${r}` });
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/venues/${venueId}/reviews`,
        headers: { authorization: `Bearer ${u.access_token}` },
        payload: { rating: r },
      });
      expect(res.statusCode).toBe(201);
    }

    const page1 = await app.inject({
      method: "GET",
      url: `/api/v1/venues/${venueId}/reviews?limit=2`,
    });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json<ReviewsPage>();
    expect(body1.items).toHaveLength(2);
    expect(body1.items[0]!.rating).toBe(5);
    expect(body1.items[1]!.rating).toBe(4);
    expect(body1.next_cursor).not.toBeNull();

    const page2 = await app.inject({
      method: "GET",
      url: `/api/v1/venues/${venueId}/reviews?limit=2&cursor=${encodeURIComponent(body1.next_cursor!)}`,
    });
    expect(page2.statusCode).toBe(200);
    const body2 = page2.json<ReviewsPage>();
    expect(body2.items).toHaveLength(1);
    expect(body2.items[0]!.rating).toBe(3);
    expect(body2.next_cursor).toBeNull();
  });

  it("orders by highest rating when sort=highest", async () => {
    const venueId = venues[0]!.id;
    for (const r of [3, 5, 2, 5, 4]) {
      const u = await createTestUser(app);
      await app.inject({
        method: "POST",
        url: `/api/v1/venues/${venueId}/reviews`,
        headers: { authorization: `Bearer ${u.access_token}` },
        payload: { rating: r },
      });
    }

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/venues/${venueId}/reviews?sort=highest&limit=10`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<ReviewsPage>();
    expect(body.items.map((i) => i.rating)).toEqual([5, 5, 4, 3, 2]);
  });

  it("author can soft-delete their review (and aggregate drops it)", async () => {
    const alice = await createTestUser(app);
    const bob = await createTestUser(app);
    const venueId = venues[0]!.id;

    const created = (await app.inject({
      method: "POST",
      url: `/api/v1/venues/${venueId}/reviews`,
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { rating: 4, body: "Solid" },
    })).json<ReviewBody>();

    // Bob can't delete Alice's review — 403.
    const forbidden = await app.inject({
      method: "DELETE",
      url: `/api/v1/reviews/${created.id}`,
      headers: { authorization: `Bearer ${bob.access_token}` },
    });
    expect(forbidden.statusCode).toBe(403);

    // Alice deletes — 204.
    const ok = await app.inject({
      method: "DELETE",
      url: `/api/v1/reviews/${created.id}`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(ok.statusCode).toBe(204);

    // Aggregate now empty.
    const summary = (await app.inject({
      method: "GET",
      url: `/api/v1/venues/${venueId}/rating-summary`,
    })).json<SummaryBody>();
    expect(summary.review_count).toBe(0);
    expect(summary.avg_rating).toBeNull();

    // Re-deleting returns 404 because the row is already soft-removed.
    const again = await app.inject({
      method: "DELETE",
      url: `/api/v1/reviews/${created.id}`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(again.statusCode).toBe(404);
  });

  it("returns 404 for an unknown venue id on every read/write surface", async () => {
    const alice = await createTestUser(app);
    const missing = "11111111-1111-1111-1111-111111111111";

    const post = await app.inject({
      method: "POST",
      url: `/api/v1/venues/${missing}/reviews`,
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { rating: 5 },
    });
    expect(post.statusCode).toBe(404);

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/venues/${missing}/reviews`,
    });
    expect(get.statusCode).toBe(404);

    const summary = await app.inject({
      method: "GET",
      url: `/api/v1/venues/${missing}/rating-summary`,
    });
    expect(summary.statusCode).toBe(404);
  });

  it("histogram counts every rating bucket independently", async () => {
    const venueId = venues[0]!.id;
    // 1 one-star, 2 three-stars, 3 five-stars.
    const ratings = [1, 3, 3, 5, 5, 5];
    for (const r of ratings) {
      const u = await createTestUser(app);
      await app.inject({
        method: "POST",
        url: `/api/v1/venues/${venueId}/reviews`,
        headers: { authorization: `Bearer ${u.access_token}` },
        payload: { rating: r },
      });
    }

    const summary = (await app.inject({
      method: "GET",
      url: `/api/v1/venues/${venueId}/rating-summary`,
    })).json<SummaryBody>();
    expect(summary.histogram["1"]).toBe(1);
    expect(summary.histogram["2"]).toBe(0);
    expect(summary.histogram["3"]).toBe(2);
    expect(summary.histogram["4"]).toBe(0);
    expect(summary.histogram["5"]).toBe(3);
    expect(summary.review_count).toBe(6);
    expect(summary.avg_rating).toBeCloseTo((1 + 3 + 3 + 5 + 5 + 5) / 6, 1);
  });

  it("aggregate VIEW exposes the same totals as the summary endpoint", async () => {
    const venueId = venues[0]!.id;
    for (const r of [4, 4, 2]) {
      const u = await createTestUser(app);
      await app.inject({
        method: "POST",
        url: `/api/v1/venues/${venueId}/reviews`,
        headers: { authorization: `Bearer ${u.access_token}` },
        payload: { rating: r },
      });
    }
    const view = await sql<{ avg_rating: string; review_count: number }>`
      SELECT avg_rating::text, review_count FROM venue_rating_summary
       WHERE venue_id = ${venueId}
    `.execute(db.db);
    expect(view.rows.length).toBe(1);
    expect(Number(view.rows[0]!.avg_rating)).toBeCloseTo(10 / 3, 1);
    expect(view.rows[0]!.review_count).toBe(3);
  });
});
