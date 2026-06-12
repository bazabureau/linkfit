import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction, type Executor } from "../../shared/db/withTransaction.js";
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  SlotConflictError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { type BookingStatus, type PaymentSplitStatus } from "../../shared/db/types.js";
import {
  type AvailabilitySlot,
  type CourtAvailabilityResponse,
  type CreateBookingRequest,
} from "./bookings.schema.js";

/**
 * Azerbaijan-first default. `courts.currency` is `NOT NULL DEFAULT 'AZN'` at
 * the schema level, but we keep this constant in code so any future row that
 * somehow ends up with an empty string still serialises a sane currency to
 * Stripe — the alternative is a 400 from the gateway, which the user sees
 * as a generic "payment failed" with no recourse.
 */
const DEFAULT_CURRENCY = "AZN";

function resolveCurrency(courtCurrency: string | null | undefined): string {
  const trimmed = courtCurrency?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_CURRENCY;
}

export interface BookingsServiceDeps {
  db: DbHandle;
}

export interface BookingDetail {
  id: string;
  game_id: string | null;
  court_id: string;
  user_id: string;
  venue_id: string;
  venue_name: string;
  court_name: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  total_minor: number;
  currency: string;
  status: BookingStatus;
  idempotency_key: string;
  external_ref: string | null;
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  splits: {
    id: string;
    user_id: string;
    amount_minor: number;
    status: PaymentSplitStatus;
    external_ref: string | null;
  }[];
}

export interface BookingsListPage {
  upcoming: BookingDetail[];
  past: BookingDetail[];
}

/** Statuses that should block a new overlapping booking on the same court. */
const ACTIVE_STATUSES: BookingStatus[] = [
  "pending_payment",
  "partially_paid",
  "paid",
];

// ─────────────────────────────────────────────────────────────────────────
// Availability surface — `GET /api/v1/courts/:id/availability` returns a
// pre-computed grid of 30-min slots between AVAILABILITY_OPEN_HOUR and
// AVAILABILITY_CLOSE_HOUR (local court time) annotated with whether they're
// taken by an active booking. The three constants below define the only
// knobs the iOS time-slot picker depends on.
// ─────────────────────────────────────────────────────────────────────────

const AVAILABILITY_OPEN_HOUR = 9;
const AVAILABILITY_CLOSE_HOUR = 22;
const AVAILABILITY_SLOT_MINUTES = 30;

/**
 * Default court timezone — Azerbaijan time. Mirrors `env.APP_DEFAULT_TIMEZONE`
 * but kept as a local constant so the BookingsService stays a pure
 * `{ db }`-dependent component; if/when courts grow their own `timezone`
 * column this is the single fallback point to swap.
 */
const COURT_DEFAULT_TIMEZONE = "Asia/Baku";

/**
 * Asia/Baku is UTC+04:00 with no DST since 2016. We format slot bounds with
 * this fixed offset so the iOS client can render them without a TZ database
 * lookup. If courts ever live outside Baku the formatter must consult the
 * IANA name instead of this literal.
 */
const COURT_DEFAULT_TZ_OFFSET = "+04:00";

/** Bookings in these statuses do NOT occupy a slot — chiefly `cancelled`. */
const AVAILABILITY_BUSY_STATUSES: BookingStatus[] = [
  "pending_payment",
  "partially_paid",
  "paid",
];

/**
 * Format an instant as an ISO string in `Asia/Baku` local time with the
 * fixed `+04:00` offset. Standalone helper because `Date.prototype.toISOString`
 * always emits UTC (`Z`), but the iOS time-slot picker wants the local
 * wall-clock time pre-baked so it never has to apply the offset itself.
 *
 * Implementation note: we use `Intl.DateTimeFormat` with the IANA name so
 * that any future Baku DST policy change is picked up automatically — the
 * `COURT_DEFAULT_TZ_OFFSET` suffix is the *display* offset, not the source
 * of truth, and would need to be derived dynamically if DST ever returned.
 */
function formatBakuISO(epochMs: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: COURT_DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(epochMs));
  const lookup: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") lookup[p.type] = p.value;
  }
  // `Intl` emits "24" for midnight under `hour12: false` on some Node builds;
  // normalize to "00" so the resulting string round-trips through `new Date`.
  const hour = lookup.hour === "24" ? "00" : (lookup.hour ?? "00");
  return `${lookup.year}-${lookup.month}-${lookup.day}T${hour}:${lookup.minute}:${lookup.second}${COURT_DEFAULT_TZ_OFFSET}`;
}

export class BookingsService {
  constructor(private readonly deps: BookingsServiceDeps) {}

  /**
   * Mint a new booking. Idempotent on `idempotency_key`: if the same key
   * arrives twice (client retried after a network blip) we hydrate the
   * original row instead of double-booking. Overlap detection holds a
   * SELECT ... FOR UPDATE on every active booking on the target court so
   * two concurrent requests for the same window can't both win — pattern
   * mirrors `gamesRepository.tryJoin`.
   */
  async create(userId: string, req: CreateBookingRequest): Promise<BookingDetail> {
    const startsAt = new Date(req.starts_at);
    if (Number.isNaN(startsAt.getTime())) {
      throw new ValidationError("starts_at is not a valid timestamp");
    }
    if (startsAt.getTime() <= Date.now()) {
      throw new ValidationError("starts_at must be in the future");
    }
    const endsAt = new Date(startsAt.getTime() + req.duration_minutes * 60_000);

    // Court must exist; pricing comes from the court row, not the caller.
    const court = await this.deps.db.db
      .selectFrom("courts")
      .selectAll()
      .where("id", "=", req.court_id)
      .executeTakeFirst();
    if (!court) throw new ValidationError("Unknown court_id");

    const totalMinor = Math.round((court.hourly_price_minor * req.duration_minutes) / 60);

    if (req.game_id !== null && req.game_id !== undefined) {
      const game = await this.deps.db.db
        .selectFrom("games")
        .select(["id", "sport_id"])
        .where("id", "=", req.game_id)
        .executeTakeFirst();
      if (!game) throw new ValidationError("Unknown game_id");
      if (game.sport_id !== court.sport_id) {
        throw new ValidationError("Game and court sports do not match");
      }
    }

    return withTransaction(this.deps.db.db, async (tx) => {
      // 1. Idempotency replay — return the existing row without touching state.
      const replay = await tx
        .selectFrom("bookings")
        .select("id")
        .where("idempotency_key", "=", req.idempotency_key)
        .executeTakeFirst();
      if (replay) {
        return this.hydrate(tx, replay.id);
      }

      // Lock the parent court row to serialize booking requests on this court
      await tx
        .selectFrom("courts")
        .select("id")
        .where("id", "=", req.court_id)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // 2. Overlap check under FOR UPDATE.  An "overlap" between two windows
      //    [a_start, a_end) and [b_start, b_end) holds iff
      //    a_start < b_end AND b_start < a_end.
      const overlap = await sql<{ id: string }>`
        SELECT id
          FROM bookings
         WHERE court_id = ${req.court_id}
           AND status::text = ANY(${ACTIVE_STATUSES})
           AND starts_at < ${endsAt}
           AND (starts_at + (duration_minutes * INTERVAL '1 minute')) > ${startsAt}
         FOR UPDATE
      `.execute(tx);
      if (overlap.rows.length > 0) {
        throw new SlotConflictError("Court is already booked for that time window", {
          details: { court_id: req.court_id, conflicting_booking_id: overlap.rows[0]?.id },
        });
      }

      // 3. Insert the booking.  Concurrent inserts with the same idempotency
      //    key are squashed by the UNIQUE constraint via onConflict — the
      //    loser then re-reads in step 4 below.  A concurrent insert for an
      //    overlapping window that slipped past the SELECT above (e.g. a
      //    writer that didn't take the court lock) trips the
      //    `bookings_no_overlap_excl` exclusion constraint instead —
      //    23P01 = exclusion_violation, surfaced as the same SLOT_CONFLICT
      //    the explicit check produces so clients see one consistent code.
      let inserted: { id: string } | undefined;
      try {
        inserted = await tx
          .insertInto("bookings")
          .values({
            court_id: req.court_id,
            user_id: userId,
            game_id: req.game_id ?? null,
            starts_at: startsAt,
            duration_minutes: req.duration_minutes,
            total_minor: totalMinor,
            currency: resolveCurrency(court.currency),
            idempotency_key: req.idempotency_key,
          })
          .onConflict((oc) => oc.column("idempotency_key").doNothing())
          .returning("id")
          .executeTakeFirst();
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === "23P01") {
          throw new SlotConflictError("Court is already booked for that time window", {
            details: { court_id: req.court_id },
          });
        }
        throw err;
      }

      const bookingId =
        inserted?.id ??
        (
          await tx
            .selectFrom("bookings")
            .select("id")
            .where("idempotency_key", "=", req.idempotency_key)
            .executeTakeFirstOrThrow()
        ).id;

      // 4. Single-payer split — for v1 the booker owes the whole thing.  The
      //    payment_splits row is what Stripe (or any future payment provider)
      //    will mark `paid` when the charge lands.
      if (inserted) {
        await tx
          .insertInto("payment_splits")
          .values({
            booking_id: bookingId,
            user_id: userId,
            amount_minor: totalMinor,
          })
          .onConflict((oc) => oc.columns(["booking_id", "user_id"]).doNothing())
          .execute();
      }

      return this.hydrate(tx, bookingId);
    });
  }

  async get(id: string, userId: string): Promise<BookingDetail> {
    const detail = await this.hydrate(this.deps.db.db, id);
    if (detail.user_id !== userId) {
      throw new ForbiddenError("You do not have access to this booking");
    }
    return detail;
  }

  async listMine(userId: string): Promise<BookingsListPage> {
    const rows = await this.deps.db.db
      .selectFrom("bookings")
      .select("id")
      .where("user_id", "=", userId)
      .orderBy("starts_at", "desc")
      .execute();
    const details = await Promise.all(rows.map((r) => this.hydrate(this.deps.db.db, r.id)));
    const now = Date.now();
    const upcoming: BookingDetail[] = [];
    const past: BookingDetail[] = [];
    for (const d of details) {
      if (new Date(d.ends_at).getTime() > now && d.status !== "cancelled") {
        upcoming.push(d);
      } else {
        past.push(d);
      }
    }
    // Upcoming sorted ascending (next first); past stays newest-first.
    upcoming.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    return { upcoming, past };
  }

  async cancel(id: string, userId: string): Promise<BookingDetail> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const lock = await sql<{
        id: string;
        user_id: string;
        status: BookingStatus;
        starts_at: Date;
      }>`
        SELECT id, user_id, status, starts_at
          FROM bookings
         WHERE id = ${id}
         FOR UPDATE
      `.execute(tx);
      const row = lock.rows[0];
      if (!row) throw new NotFoundError("Booking not found");
      if (row.user_id !== userId) {
        throw new ForbiddenError("You do not have access to this booking");
      }
      if (row.status === "cancelled" || row.status === "refunded") {
        throw new PreconditionFailedError("Booking is already cancelled");
      }
      if (row.starts_at.getTime() <= Date.now()) {
        throw new PreconditionFailedError("Cannot cancel a booking that has already started");
      }
      await tx
        .updateTable("bookings")
        .set({ status: "cancelled", cancelled_at: new Date() })
        .where("id", "=", id)
        .execute();
      return this.hydrate(tx, id);
    });
  }

  /**
   * Stub used until the real Stripe wiring lands. Flips the booking to `paid`
   * and marks every split as `captured`. Only the owner of the booking may
   * call it — production webhooks will obviously bypass auth.
   */
  async markPaid(id: string, userId: string): Promise<BookingDetail> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const lock = await sql<{
        id: string;
        user_id: string;
        status: BookingStatus;
      }>`
        SELECT id, user_id, status
          FROM bookings
         WHERE id = ${id}
         FOR UPDATE
      `.execute(tx);
      const row = lock.rows[0];
      if (!row) throw new NotFoundError("Booking not found");
      if (row.user_id !== userId) {
        throw new ForbiddenError("You do not have access to this booking");
      }
      if (row.status === "cancelled" || row.status === "refunded") {
        throw new PreconditionFailedError("Cannot mark a cancelled booking as paid");
      }
      if (row.status === "paid") {
        return this.hydrate(tx, id);
      }
      await tx
        .updateTable("bookings")
        .set({ status: "paid", paid_at: new Date() })
        .where("id", "=", id)
        .execute();
      await tx
        .updateTable("payment_splits")
        .set({ status: "captured", paid_at: new Date() })
        .where("booking_id", "=", id)
        .execute();
      return this.hydrate(tx, id);
    });
  }

  /**
   * Day-grain availability for a court. Returns one 30-minute slot per
   * cell between `AVAILABILITY_OPEN_HOUR` and `AVAILABILITY_CLOSE_HOUR` of
   * the requested calendar day in the court's local timezone (currently
   * always `Asia/Baku`). A slot is `"booked"` iff any non-cancelled
   * booking on the same court overlaps it.
   *
   * Auth note: anonymous callers may invoke this. The response intentionally
   * exposes `booking_id` so an owner-aware iOS UI can deep-link to the
   * booking detail when they tap their own slot; non-owners just see an
   * opaque uuid, which is fine — they already need that id to render the
   * conflict on the booking-create error path.
   *
   * Why the busy check fans out to JS rather than a SQL `generate_series`
   * crosswalk: with `(close - open) * 60 / 30 = 26` slots and typically <10
   * bookings per day per court, the constant factor of materialising a 26-row
   * series in PG dwarfs the in-process loop. The chosen design also keeps
   * the SQL identical to the overlap check in `create()` — same predicate,
   * same indexes hit.
   */
  async getAvailability(courtId: string, date: string): Promise<CourtAvailabilityResponse> {
    // 1. Court must exist. We use `executeTakeFirst` (not `OrThrow`) because
    //    a missing court is a user error, not an invariant failure.
    const court = await this.deps.db.db
      .selectFrom("courts")
      .select(["id"])
      .where("id", "=", courtId)
      .executeTakeFirst();
    if (!court) throw new NotFoundError("Court not found");

    // 2. Convert the YYYY-MM-DD into UTC day bounds in the court's timezone.
    //    The cast MUST go through `::timestamp` (naive midnight), because
    //    `<naive timestamp> AT TIME ZONE <tz>` interprets the value as
    //    wall-clock time IN that zone and returns a `timestamptz` — exactly
    //    what the overlap query against `bookings.starts_at` needs. Casting
    //    via `::date` instead would first promote to `timestamptz` using the
    //    *session* timezone and then convert BACK to a naive timestamp,
    //    shifting the whole grid by the server-vs-Baku offset.
    const bounds = await sql<{ day_start: Date; day_end: Date }>`
      SELECT
        (${date}::timestamp AT TIME ZONE ${COURT_DEFAULT_TIMEZONE}) AS day_start,
        ((${date}::timestamp + INTERVAL '1 day') AT TIME ZONE ${COURT_DEFAULT_TIMEZONE}) AS day_end
    `.execute(this.deps.db.db);
    const row = bounds.rows[0];
    if (!row) {
      // Defensive — the SELECT above is constant, so a 0-row result is
      // unreachable in practice. Throwing a typed error keeps the function
      // total without inventing fake values.
      throw new ValidationError("Could not resolve day bounds");
    }
    const dayStart = row.day_start;
    const dayEnd = row.day_end;

    // 3. Pull every active booking that overlaps the requested day. Using
    //    the same `a_start < b_end AND b_start < a_end` predicate as the
    //    create-time overlap check so we hit the (court_id, starts_at)
    //    index and stay consistent with conflict semantics.
    const busyResult = await sql<{
      id: string;
      starts_at: Date;
      duration_minutes: number;
    }>`
      SELECT id, starts_at, duration_minutes
        FROM bookings
       WHERE court_id = ${courtId}
         AND status::text = ANY(${AVAILABILITY_BUSY_STATUSES})
         AND starts_at < ${dayEnd}
         AND (starts_at + (duration_minutes * INTERVAL '1 minute')) > ${dayStart}
    `.execute(this.deps.db.db);

    const busy = busyResult.rows.map((b) => ({
      id: b.id,
      startMs: b.starts_at.getTime(),
      endMs: b.starts_at.getTime() + b.duration_minutes * 60_000,
    }));

    // 4. Generate the slot grid. The loop is bounded by the constants above —
    //    at 30-min granularity from 09:00 to 22:00 that's 26 iterations.
    const slots: AvailabilitySlot[] = [];
    const dayStartMs = dayStart.getTime();
    const slotMs = AVAILABILITY_SLOT_MINUTES * 60_000;
    const firstSlotOffsetMin = AVAILABILITY_OPEN_HOUR * 60;
    const totalMinutes = (AVAILABILITY_CLOSE_HOUR - AVAILABILITY_OPEN_HOUR) * 60;
    const slotCount = Math.floor(totalMinutes / AVAILABILITY_SLOT_MINUTES);

    for (let i = 0; i < slotCount; i += 1) {
      const slotStartMs = dayStartMs + (firstSlotOffsetMin + i * AVAILABILITY_SLOT_MINUTES) * 60_000;
      const slotEndMs = slotStartMs + slotMs;
      // Overlap test, same predicate as the SQL overlap check.
      const hit = busy.find((b) => b.startMs < slotEndMs && b.endMs > slotStartMs);
      slots.push({
        start_at: formatBakuISO(slotStartMs),
        end_at: formatBakuISO(slotEndMs),
        status: hit ? "booked" : "free",
        booking_id: hit?.id ?? null,
      });
    }

    return {
      court_id: courtId,
      date,
      open_hour: AVAILABILITY_OPEN_HOUR,
      close_hour: AVAILABILITY_CLOSE_HOUR,
      slots,
    };
  }

  private async hydrate(executor: Executor, id: string): Promise<BookingDetail> {
    const booking = await executor
      .selectFrom("bookings as b")
      .innerJoin("courts as c", "c.id", "b.court_id")
      .innerJoin("venues as v", "v.id", "c.venue_id")
      .select([
        "b.id as id",
        "b.game_id as game_id",
        "b.court_id as court_id",
        "b.user_id as user_id",
        "b.starts_at as starts_at",
        "b.duration_minutes as duration_minutes",
        "b.total_minor as total_minor",
        "b.currency as currency",
        "b.status as status",
        "b.idempotency_key as idempotency_key",
        "b.external_ref as external_ref",
        "b.created_at as created_at",
        "b.paid_at as paid_at",
        "b.cancelled_at as cancelled_at",
        "c.name as court_name",
        "v.id as venue_id",
        "v.name as venue_name",
      ])
      .where("b.id", "=", id)
      .executeTakeFirst();
    if (!booking) throw new NotFoundError("Booking not found");

    const splits = await executor
      .selectFrom("payment_splits")
      .selectAll()
      .where("booking_id", "=", id)
      .orderBy("user_id")
      .execute();

    const endsAt = new Date(booking.starts_at.getTime() + booking.duration_minutes * 60_000);

    return {
      id: booking.id,
      game_id: booking.game_id,
      court_id: booking.court_id,
      user_id: booking.user_id,
      venue_id: booking.venue_id,
      venue_name: booking.venue_name,
      court_name: booking.court_name,
      starts_at: booking.starts_at.toISOString(),
      ends_at: endsAt.toISOString(),
      duration_minutes: booking.duration_minutes,
      total_minor: booking.total_minor,
      currency: resolveCurrency(booking.currency),
      status: booking.status,
      idempotency_key: booking.idempotency_key,
      external_ref: booking.external_ref,
      created_at: booking.created_at.toISOString(),
      paid_at: booking.paid_at?.toISOString() ?? null,
      cancelled_at: booking.cancelled_at?.toISOString() ?? null,
      splits: splits.map((s) => ({
        id: s.id,
        user_id: s.user_id,
        amount_minor: s.amount_minor,
        status: s.status,
        external_ref: s.external_ref,
      })),
    };
  }
}
