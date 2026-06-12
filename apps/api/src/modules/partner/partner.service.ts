import { sql } from "kysely";
import { randomUUID } from "node:crypto";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  ConflictError,
  NotFoundError,
  ForbiddenError,
} from "../../shared/errors/AppError.js";
import {
  type PartnerVenueUpdateSchema,
  type PartnerCourtCreateSchema,
  type PartnerCourtUpdateSchema,
  type PartnerBookingsListQuery,
  type PartnerBookingsListResponse,
  type PartnerStatsResponse,
  type PartnerVenueSchema,
  type PartnerCourtSchema,
  type PartnerBookingStatusValue,
  type PartnerBookingCreateSchema,
  type PartnerBookingRowSchema,
} from "./partner.schema.js";

export interface PartnerServiceDeps {
  db: DbHandle;
}

export class PartnerService {
  constructor(private deps: PartnerServiceDeps) {}

  get db(): DbHandle {
    return this.deps.db;
  }

  // ───────────────────────────── Venue Profile ─────────────────────────────

  async getVenueProfile(venueId: string): Promise<PartnerVenueSchema> {
    const row = await this.deps.db.db
      .selectFrom("venues")
      .selectAll()
      .where("id", "=", venueId)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundError("Venue not found");
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      address: row.address,
      phone: row.phone,
      photo_url: row.photo_url,
      created_at: row.created_at.toISOString(),
    };
  }

  async updateVenueProfile(
    venueId: string,
    update: PartnerVenueUpdateSchema
  ): Promise<PartnerVenueSchema> {
    const updated = await this.deps.db.db
      .updateTable("venues")
      .set({
        name: update.name,
        description: update.description,
        address: update.address,
        phone: update.phone,
        photo_url: update.photo_url,
      })
      .where("id", "=", venueId)
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      throw new NotFoundError("Venue not found");
    }

    return {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      address: updated.address,
      phone: updated.phone,
      photo_url: updated.photo_url,
      created_at: updated.created_at.toISOString(),
    };
  }

  // ───────────────────────────── Courts Management ─────────────────────────────

  async listVenueCourts(venueId: string): Promise<PartnerCourtSchema[]> {
    const rows = await this.deps.db.db
      .selectFrom("courts")
      .innerJoin("sports", "sports.id", "courts.sport_id")
      .select([
        "courts.id",
        "courts.venue_id",
        "courts.sport_id",
        "sports.slug as sport_slug",
        "courts.name",
        "courts.hourly_price_minor",
        "courts.currency",
        "courts.created_at",
      ])
      .where("courts.venue_id", "=", venueId)
      .orderBy("courts.name", "asc")
      .execute();

    return rows.map((r) => ({
      id: r.id,
      venue_id: r.venue_id,
      sport_id: r.sport_id,
      sport_slug: r.sport_slug,
      name: r.name,
      hourly_price_minor: r.hourly_price_minor,
      currency: r.currency,
      created_at: r.created_at.toISOString(),
    }));
  }

  async createVenueCourt(
    venueId: string,
    data: PartnerCourtCreateSchema
  ): Promise<PartnerCourtSchema> {
    const sport = await this.deps.db.db
      .selectFrom("sports")
      .select(["id", "slug"])
      .where("id", "=", data.sport_id)
      .executeTakeFirst();

    if (!sport) {
      throw new NotFoundError("Sport not found");
    }

    const row = await this.deps.db.db
      .insertInto("courts")
      .values({
        venue_id: venueId,
        sport_id: data.sport_id,
        name: data.name,
        hourly_price_minor: data.hourly_price_minor,
        currency: data.currency ?? "AZN",
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      id: row.id,
      venue_id: row.venue_id,
      sport_id: row.sport_id,
      sport_slug: sport.slug,
      name: row.name,
      hourly_price_minor: row.hourly_price_minor,
      currency: row.currency,
      created_at: row.created_at.toISOString(),
    };
  }

  async updateVenueCourt(
    venueId: string,
    courtId: string,
    data: PartnerCourtUpdateSchema
  ): Promise<PartnerCourtSchema> {
    const existing = await this.deps.db.db
      .selectFrom("courts")
      .select(["id", "venue_id"])
      .where("id", "=", courtId)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundError("Court not found");
    }
    if (existing.venue_id !== venueId) {
      throw new ForbiddenError("Not authorized to manage this court");
    }

    let sportSlug = "";
    if (data.sport_id) {
      const sport = await this.deps.db.db
        .selectFrom("sports")
        .select(["id", "slug"])
        .where("id", "=", data.sport_id)
        .executeTakeFirst();
      if (!sport) throw new NotFoundError("Sport not found");
      sportSlug = sport.slug;
    }

    const row = await this.deps.db.db
      .updateTable("courts")
      .set({
        sport_id: data.sport_id,
        name: data.name,
        hourly_price_minor: data.hourly_price_minor,
        currency: data.currency,
      })
      .where("id", "=", courtId)
      .returningAll()
      .executeTakeFirstOrThrow();

    if (!sportSlug) {
      const sport = await this.deps.db.db
        .selectFrom("sports")
        .select(["slug"])
        .where("id", "=", row.sport_id)
        .executeTakeFirstOrThrow();
      sportSlug = sport.slug;
    }

    return {
      id: row.id,
      venue_id: row.venue_id,
      sport_id: row.sport_id,
      sport_slug: sportSlug,
      name: row.name,
      hourly_price_minor: row.hourly_price_minor,
      currency: row.currency,
      created_at: row.created_at.toISOString(),
    };
  }

  async deleteVenueCourt(venueId: string, courtId: string): Promise<void> {
    const existing = await this.deps.db.db
      .selectFrom("courts")
      .select(["id", "venue_id"])
      .where("id", "=", courtId)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundError("Court not found");
    }
    if (existing.venue_id !== venueId) {
      throw new ForbiddenError("Not authorized to manage this court");
    }

    await this.deps.db.db
      .deleteFrom("courts")
      .where("id", "=", courtId)
      .execute();
  }

  // ───────────────────────────── Bookings ─────────────────────────────

  async listVenueBookings(
    venueId: string,
    query: PartnerBookingsListQuery
  ): Promise<PartnerBookingsListResponse> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);

    const filters: ReturnType<typeof sql>[] = [];

    // Force filtering by the partner's venue ID
    filters.push(sql`c.venue_id = ${venueId}::uuid`);

    if (query.status) {
      filters.push(sql`b.status::text = ${query.status}`);
    }
    if (query.court_id) {
      filters.push(sql`b.court_id = ${query.court_id}::uuid`);
    }
    if (query.from) {
      filters.push(sql`b.starts_at >= ${new Date(query.from)}`);
    }
    if (query.to) {
      filters.push(sql`b.starts_at <= ${new Date(query.to)}`);
    }
    if (query.q) {
      const term = `%${query.q.trim()}%`;
      filters.push(sql`(u.display_name ILIKE ${term} OR u.email::text ILIKE ${term})`);
    }

    const whereClause = filters.length
      ? sql`WHERE ${sql.join(filters, sql` AND `)}`
      : sql``;

    const rowsResult = await sql<{
      id: string;
      game_id: string | null;
      court_id: string;
      court_name: string;
      user_id: string;
      booker_display_name: string;
      booker_email: string;
      venue_id: string;
      venue_name: string;
      starts_at: Date;
      duration_minutes: number;
      total_minor: number;
      currency: string;
      status: PartnerBookingStatusValue;
      idempotency_key: string;
      external_ref: string | null;
      created_at: Date;
      paid_at: Date | null;
      cancelled_at: Date | null;
    }>`
      SELECT 
        b.id,
        b.game_id,
        b.court_id,
        c.name as court_name,
        b.user_id,
        u.display_name as booker_display_name,
        u.email::text as booker_email,
        c.venue_id,
        v.name as venue_name,
        b.starts_at,
        b.duration_minutes,
        b.total_minor,
        b.currency,
        b.status::text as status,
        b.idempotency_key,
        b.external_ref,
        b.created_at,
        b.paid_at,
        b.cancelled_at
      FROM bookings b
      INNER JOIN courts c ON c.id = b.court_id
      INNER JOIN venues v ON v.id = c.venue_id
      INNER JOIN users u ON u.id = b.user_id
      ${whereClause}
      ORDER BY b.starts_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `.execute(this.deps.db.db);

    const totalResult = await sql<{ c: string }>`
      SELECT count(*) as c
      FROM bookings b
      INNER JOIN courts c ON c.id = b.court_id
      INNER JOIN users u ON u.id = b.user_id
      ${whereClause}
    `.execute(this.deps.db.db);

    return {
      items: rowsResult.rows.map((r) => ({
        ...r,
        starts_at: r.starts_at.toISOString(),
        created_at: r.created_at.toISOString(),
        paid_at: r.paid_at?.toISOString() ?? null,
        cancelled_at: r.cancelled_at?.toISOString() ?? null,
      })),
      total: Number(totalResult.rows[0]?.c ?? "0"),
    };
  }

  async cancelVenueBooking(
    venueId: string,
    bookingId: string,
    actorId: string
  ): Promise<void> {
    await withTransaction(this.deps.db.db, async (tx) => {
      const existing = await tx
        .selectFrom("bookings")
        .innerJoin("courts", "courts.id", "bookings.court_id")
        .select([
          "bookings.id",
          "bookings.status",
          "bookings.starts_at",
          "courts.venue_id",
        ])
        .where("bookings.id", "=", bookingId)
        .executeTakeFirst();

      if (!existing) throw new NotFoundError("Booking not found");
      if (existing.venue_id !== venueId) {
        throw new ForbiddenError("Not authorized to manage this booking");
      }

      if (existing.status === "cancelled" || existing.status === "refunded") {
        throw new ConflictError("Booking is already cancelled or refunded");
      }

      await tx
        .updateTable("bookings")
        .set({ status: "cancelled", cancelled_at: new Date() })
        .where("id", "=", bookingId)
        .execute();

      await tx
        .updateTable("payment_splits")
        .set({ status: "failed", refunded_at: new Date() })
        .where("booking_id", "=", bookingId)
        .execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: actorId,
          action: "partner.bookings.cancel",
          entity: "booking",
          entity_id: bookingId,
          metadata: { previous_status: existing.status, venue_id: venueId },
        })
        .execute();
    });
  }

  async markVenueBookingPaid(
    venueId: string,
    bookingId: string,
    actorId: string
  ): Promise<void> {
    await withTransaction(this.deps.db.db, async (tx) => {
      const existing = await tx
        .selectFrom("bookings")
        .innerJoin("courts", "courts.id", "bookings.court_id")
        .select([
          "bookings.id",
          "bookings.status",
          "courts.venue_id",
        ])
        .where("bookings.id", "=", bookingId)
        .executeTakeFirst();

      if (!existing) throw new NotFoundError("Booking not found");
      if (existing.venue_id !== venueId) {
        throw new ForbiddenError("Not authorized to manage this booking");
      }

      if (existing.status === "cancelled" || existing.status === "refunded") {
        throw new ConflictError("Cannot mark a cancelled or refunded booking as paid");
      }
      if (existing.status === "paid") return;

      await tx
        .updateTable("bookings")
        .set({ status: "paid", paid_at: new Date() })
        .where("id", "=", bookingId)
        .execute();

      await tx
        .updateTable("payment_splits")
        .set({ status: "captured", paid_at: new Date() })
        .where("booking_id", "=", bookingId)
        .execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: actorId,
          action: "partner.bookings.mark_paid",
          entity: "booking",
          entity_id: bookingId,
          metadata: { previous_status: existing.status, venue_id: venueId },
        })
        .execute();
    });
  }

  // ───────────────────────────── Analytics Stats ─────────────────────────────

  async getVenueStats(venueId: string): Promise<PartnerStatsResponse> {
    const bookings = await this.deps.db.db
      .selectFrom("bookings")
      .innerJoin("courts", "courts.id", "bookings.court_id")
      .select(["bookings.status", "bookings.total_minor", "bookings.currency"])
      .where("courts.venue_id", "=", venueId)
      .execute();

    const total = bookings.length;
    let paid = 0;
    let pending = 0;
    let cancelled = 0;
    let revenueMinor = 0;
    let currency = "AZN";

    bookings.forEach((b) => {
      if (b.status === "paid") {
        paid++;
        revenueMinor += b.total_minor;
        currency = b.currency;
      } else if (b.status === "pending_payment" || b.status === "partially_paid") {
        pending++;
      } else if (b.status === "cancelled" || b.status === "refunded") {
        cancelled++;
      }
    });

    // Compute simple occupancy rate
    // Total hours booked on courts in the current week vs total potential capacity
    const courtsCountResult = await this.deps.db.db
      .selectFrom("courts")
      .select(sql`count(*)`.as("c"))
      .where("venue_id", "=", venueId)
      .executeTakeFirst();
    const courtsCount = Number(courtsCountResult?.c ?? "0");

    // Potential slots in a week: 7 days * 12 active hours * courtsCount
    const potentialSlots = 7 * 12 * courtsCount;
    const occupancyRate = potentialSlots > 0 ? Math.min((paid / potentialSlots) * 100, 100) : 0;

    return {
      total_bookings: total,
      paid_bookings: paid,
      pending_bookings: pending,
      cancelled_bookings: cancelled,
      total_revenue_minor: revenueMinor,
      currency,
      occupancy_rate: Number(occupancyRate.toFixed(1)),
    };
  }

  async createVenueBooking(
    venueId: string,
    actorId: string,
    data: PartnerBookingCreateSchema
  ): Promise<PartnerBookingRowSchema> {
    return await withTransaction(this.deps.db.db, async (tx) => {
      // 1. Validate court belongs to this venue
      const court = await tx
        .selectFrom("courts")
        .select(["id", "venue_id", "name", "hourly_price_minor", "currency"])
        .where("id", "=", data.court_id)
        .forUpdate()
        .executeTakeFirst();
      if (!court) throw new NotFoundError("Court not found");
      if (court.venue_id !== venueId) {
        throw new ForbiddenError("Not authorized to manage this court");
      }

      // 2. Resolve booker user or lazily create a guest
      const email = data.booker_email.trim().toLowerCase();
      let user = await tx
        .selectFrom("users")
        .select(["id", "display_name", "email"])
        .where("email", "=", email)
        .executeTakeFirst();

      if (!user) {
        // Create a guest user
        const guestId = randomUUID();
        const now = new Date();
        await tx
          .insertInto("users")
          .values({
            id: guestId,
            email,
            password_hash: "GUEST_WALK_IN_PASSWORD_HASH_xxxxx",
            display_name: data.booker_display_name,
            created_at: now,
            updated_at: now,
          })
          .execute();
        
        user = {
          id: guestId,
          display_name: data.booker_display_name,
          email,
        };
      }

      // 3. Compute cost
      const hours = data.duration_minutes / 60;
      const totalMinor = Math.round(court.hourly_price_minor * hours);

      // 4. Check for double bookings / overlaps
      const startsAt = new Date(data.starts_at);
      const endsAt = new Date(startsAt.getTime() + data.duration_minutes * 60 * 1000);

      const overlap = await sql<{ id: string }>`
        SELECT id
          FROM bookings
         WHERE court_id = ${data.court_id}
           AND status::text = ANY(${["paid", "pending_payment", "partially_paid"]})
           AND starts_at < ${endsAt}
           AND (starts_at + (duration_minutes * INTERVAL '1 minute')) > ${startsAt}
         FOR UPDATE
      `.execute(tx);

      if (overlap.rows.length > 0) {
        throw new ConflictError("Bu vaxt aralığı artıq rezervasiya olunub.");
      }

      // 5. Insert booking
      const bookingId = randomUUID();
      const now = new Date();
      await tx
        .insertInto("bookings")
        .values({
          id: bookingId,
          court_id: data.court_id,
          user_id: user.id,
          starts_at: startsAt,
          duration_minutes: data.duration_minutes,
          total_minor: totalMinor,
          currency: court.currency,
          status: "paid", // Walk-ins are assumed paid on site immediately
          idempotency_key: data.idempotency_key,
          created_at: now,
          paid_at: now,
        })
        .execute();

      // Create split
      await tx
        .insertInto("payment_splits")
        .values({
          id: randomUUID(),
          booking_id: bookingId,
          user_id: user.id,
          amount_minor: totalMinor,
          status: "captured",
          created_at: now,
          paid_at: now,
        })
        .execute();

      // Audit Log
      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: actorId,
          action: "partner.bookings.create_walk_in",
          entity: "booking",
          entity_id: bookingId,
          metadata: { venue_id: venueId, total_minor: totalMinor },
        })
        .execute();

      // Fetch venue details
      const venue = await tx
        .selectFrom("venues")
        .select(["name"])
        .where("id", "=", venueId)
        .executeTakeFirstOrThrow();

      return {
        id: bookingId,
        game_id: null,
        court_id: data.court_id,
        court_name: court.name,
        user_id: user.id,
        booker_display_name: user.display_name,
        booker_email: user.email,
        venue_id: venueId,
        venue_name: venue.name,
        starts_at: startsAt.toISOString(),
        duration_minutes: data.duration_minutes,
        total_minor: totalMinor,
        currency: court.currency,
        status: "paid",
        idempotency_key: data.idempotency_key,
        external_ref: null,
        created_at: now.toISOString(),
        paid_at: now.toISOString(),
        cancelled_at: null,
      };
    });
  }
}
