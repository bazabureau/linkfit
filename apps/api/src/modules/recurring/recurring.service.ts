import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction, type Executor } from "../../shared/db/withTransaction.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import {
  type CreateSeriesRequest,
  type SeriesStatus,
} from "./recurring.schema.js";

export interface RecurringServiceDeps {
  db: DbHandle;
}

interface SeriesRow {
  id: string;
  host_user_id: string;
  sport_id: string;
  sport_slug: string;
  court_id: string | null;
  venue_name: string | null;
  lat: string;
  lng: string;
  day_of_week: number;
  time_of_day: string;
  duration_minutes: number;
  capacity: number;
  occurrences: number;
  starts_on: Date;
  ends_on: Date;
  status: SeriesStatus;
  notes: string | null;
  created_at: Date;
}

interface SeriesGameRow {
  id: string;
  occurrence_number: number;
  starts_at: Date;
  status: "open" | "full" | "cancelled" | "completed";
  capacity: number;
  participants_count: string;
}

export interface SeriesGameSummary {
  id: string;
  occurrence_number: number;
  starts_at: string;
  status: "open" | "full" | "cancelled" | "completed";
  capacity: number;
  participants_count: number;
}

export interface SeriesDetail {
  id: string;
  host_user_id: string;
  sport_id: string;
  sport_slug: string;
  court_id: string | null;
  venue_name: string | null;
  lat: number;
  lng: number;
  day_of_week: number;
  time_of_day: string;
  duration_minutes: number;
  capacity: number;
  occurrences: number;
  starts_on: string;
  ends_on: string;
  status: SeriesStatus;
  notes: string | null;
  created_at: string;
  games: SeriesGameSummary[];
}

/**
 * Format a Date as a Postgres `date` literal (YYYY-MM-DD) in UTC. The
 * series uses calendar dates, not instants, so we keep everything in UTC
 * — the iOS client renders local times based on the venue.
 */
function toDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${String(y)}-${m}-${day}`;
}

/** Build the timestamptz for occurrence n (1-indexed). */
function nthOccurrenceAt(
  firstUtcMidnight: Date,
  hours: number,
  minutes: number,
  seconds: number,
  n: number,
): Date {
  const ms =
    firstUtcMidnight.getTime() +
    (n - 1) * 7 * 24 * 60 * 60 * 1000 +
    hours * 60 * 60 * 1000 +
    minutes * 60 * 1000 +
    seconds * 1000;
  return new Date(ms);
}

function parseTimeOfDay(t: string): { h: number; m: number; s: number } {
  const parts = t.split(":");
  return {
    h: Number(parts[0]),
    m: Number(parts[1]),
    s: parts[2] !== undefined ? Number(parts[2]) : 0,
  };
}

export class RecurringService {
  constructor(private readonly deps: RecurringServiceDeps) {}

  async create(hostUserId: string, req: CreateSeriesRequest): Promise<SeriesDetail> {
    // Validate sport.
    const sport = await this.deps.db.db
      .selectFrom("sports")
      .selectAll()
      .where("id", "=", req.sport_id)
      .executeTakeFirst();
    if (!sport) throw new ValidationError("Unknown sport_id");

    if (req.capacity < sport.min_players || req.capacity > sport.max_players) {
      throw new ValidationError(
        `capacity for ${sport.name} must be between ${String(sport.min_players)} and ${String(sport.max_players)}`,
      );
    }

    if (req.court_id !== undefined && req.court_id !== null) {
      const court = await this.deps.db.db
        .selectFrom("courts")
        .selectAll()
        .where("id", "=", req.court_id)
        .executeTakeFirst();
      if (!court) throw new ValidationError("Unknown court_id");
      if (court.sport_id !== req.sport_id) {
        throw new ValidationError("Court sport does not match series sport");
      }
    }

    // Compute calendar dates. Anchor = today (UTC) unless caller supplied
    // an explicit starts_on.
    const anchor = req.starts_on
      ? new Date(`${req.starts_on}T00:00:00.000Z`)
      : new Date(Date.UTC(
          new Date().getUTCFullYear(),
          new Date().getUTCMonth(),
          new Date().getUTCDate(),
        ));
    if (Number.isNaN(anchor.getTime())) {
      throw new ValidationError("Invalid starts_on");
    }

    const anchorDow = anchor.getUTCDay(); // 0=Sun .. 6=Sat
    const daysAhead = (req.day_of_week - anchorDow + 7) % 7;
    const firstUtcMidnight = new Date(anchor.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    const { h, m, s } = parseTimeOfDay(req.time_of_day);

    // If the first occurrence falls within the same UTC day as anchor and
    // its computed datetime is already in the past, slide it forward a
    // week — recurring series shouldn't immediately surface a stale game.
    let firstStart = nthOccurrenceAt(firstUtcMidnight, h, m, s, 1);
    if (firstStart.getTime() <= Date.now()) {
      firstStart = new Date(firstStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
    const lastStart = new Date(
      firstStart.getTime() + (req.occurrences - 1) * 7 * 24 * 60 * 60 * 1000,
    );
    const firstDate = new Date(Date.UTC(
      firstStart.getUTCFullYear(),
      firstStart.getUTCMonth(),
      firstStart.getUTCDate(),
    ));
    const lastDate = new Date(Date.UTC(
      lastStart.getUTCFullYear(),
      lastStart.getUTCMonth(),
      lastStart.getUTCDate(),
    ));

    return withTransaction(this.deps.db.db, async (tx) => {
      // Insert the series. We use raw sql since the Kysely Database type
      // intentionally doesn't know about game_series — keeps the migration
      // self-contained and the module file-exclusive.
      const seriesIns = await sql<{ id: string }>`
        INSERT INTO game_series (
          host_user_id, sport_id, court_id, lat, lng,
          day_of_week, time_of_day, duration_minutes, capacity,
          occurrences, starts_on, ends_on, notes
        ) VALUES (
          ${hostUserId}, ${req.sport_id}, ${req.court_id ?? null},
          ${req.lat.toString()}, ${req.lng.toString()},
          ${req.day_of_week}, ${req.time_of_day}, ${req.duration_minutes}, ${req.capacity},
          ${req.occurrences}, ${toDateString(firstDate)}, ${toDateString(lastDate)},
          ${req.notes ?? null}
        )
        RETURNING id
      `.execute(tx);
      const firstRow = seriesIns.rows[0];
      if (firstRow === undefined) {
        throw new Error("recurring: INSERT...RETURNING returned no rows");
      }
      const seriesId = firstRow.id;

      // Materialize N games. Each gets a stable occurrence_number so the
      // series detail endpoint can render them in order and the "cancel
      // from N" operation works without ambiguity.
      for (let i = 1; i <= req.occurrences; i += 1) {
        const startsAt = nthOccurrenceAt(firstUtcMidnight, h, m, s, i);
        // Defensive guard — if the first slide-forward already pushed us
        // past, we still want the actual times.
        const actualStart = startsAt.getTime() <= Date.now()
          ? new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000)
          : startsAt;

        const gameIns = await tx
          .insertInto("games")
          .values({
            sport_id: req.sport_id,
            court_id: req.court_id ?? null,
            host_user_id: hostUserId,
            lat: req.lat.toString(),
            lng: req.lng.toString(),
            starts_at: actualStart,
            duration_minutes: req.duration_minutes,
            capacity: req.capacity,
            skill_min_elo: null,
            skill_max_elo: null,
            visibility: "public",
            notes: req.notes ?? null,
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        // Stamp the series link via raw sql — the Kysely GameTable type
        // doesn't carry the new columns and we want to avoid mutating
        // shared types from this module.
        await sql`
          UPDATE games
             SET series_id = ${seriesId}::uuid,
                 occurrence_number = ${i}
           WHERE id = ${gameIns.id}::uuid
        `.execute(tx);

        // Host is auto-confirmed for every instance — they opted in by
        // creating the series.
        await tx
          .insertInto("game_participants")
          .values({ game_id: gameIns.id, user_id: hostUserId, status: "confirmed" })
          .execute();
      }

      const detail = await this.loadDetail(tx, seriesId);
      if (!detail) throw new NotFoundError("Series vanished after creation");
      return detail;
    });
  }

  async getDetail(id: string): Promise<SeriesDetail> {
    const detail = await this.loadDetail(this.deps.db.db, id);
    if (!detail) throw new NotFoundError("Series not found");
    return detail;
  }

  async cancel(
    seriesId: string,
    hostUserId: string,
    fromOccurrence: number,
  ): Promise<{ cancelled_count: number }> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const owner = await sql<{ host_user_id: string }>`
        SELECT host_user_id FROM game_series WHERE id = ${seriesId}::uuid
      `.execute(tx);
      const row = owner.rows[0];
      if (!row) throw new NotFoundError("Series not found");
      if (row.host_user_id !== hostUserId) {
        throw new ForbiddenError("Only the host can cancel this series");
      }

      // Flip downstream games to 'cancelled', but only the ones that haven't
      // already played or been cancelled — we leave history alone.
      const upd = await sql<{ id: string }>`
        UPDATE games
           SET status = 'cancelled'
         WHERE series_id = ${seriesId}::uuid
           AND occurrence_number >= ${fromOccurrence}
           AND status IN ('open', 'full')
        RETURNING id
      `.execute(tx);

      // If the cancel covers occurrence 1, flag the whole series as
      // cancelled so the host sees it greyed out in lists.
      if (fromOccurrence <= 1) {
        await sql`
          UPDATE game_series
             SET status = 'cancelled'
           WHERE id = ${seriesId}::uuid
        `.execute(tx);
      }

      return { cancelled_count: upd.rows.length };
    });
  }

  private async loadDetail(db: Executor, id: string): Promise<SeriesDetail | null> {
    const seriesRes = await sql<SeriesRow>`
      SELECT gs.id, gs.host_user_id, gs.sport_id, s.slug AS sport_slug,
             gs.court_id, v.name AS venue_name,
             gs.lat, gs.lng, gs.day_of_week,
             to_char(gs.time_of_day, 'HH24:MI:SS') AS time_of_day,
             gs.duration_minutes, gs.capacity, gs.occurrences,
             gs.starts_on, gs.ends_on, gs.status, gs.notes, gs.created_at
        FROM game_series gs
        JOIN sports s ON s.id = gs.sport_id
        LEFT JOIN courts c ON c.id = gs.court_id
        LEFT JOIN venues v ON v.id = c.venue_id
       WHERE gs.id = ${id}::uuid
    `.execute(db);
    const row = seriesRes.rows[0];
    if (!row) return null;

    const gamesRes = await sql<SeriesGameRow>`
      SELECT g.id, g.occurrence_number, g.starts_at, g.status, g.capacity,
             (SELECT count(*) FROM game_participants gp
                WHERE gp.game_id = g.id AND gp.status = 'confirmed')::text AS participants_count
        FROM games g
       WHERE g.series_id = ${id}::uuid
       ORDER BY g.occurrence_number ASC
    `.execute(db);

    return {
      id: row.id,
      host_user_id: row.host_user_id,
      sport_id: row.sport_id,
      sport_slug: row.sport_slug,
      court_id: row.court_id,
      venue_name: row.venue_name,
      lat: Number(row.lat),
      lng: Number(row.lng),
      day_of_week: row.day_of_week,
      time_of_day: row.time_of_day,
      duration_minutes: row.duration_minutes,
      capacity: row.capacity,
      occurrences: row.occurrences,
      starts_on: toDateString(row.starts_on),
      ends_on: toDateString(row.ends_on),
      status: row.status,
      notes: row.notes,
      created_at: row.created_at.toISOString(),
      games: gamesRes.rows.map((g) => ({
        id: g.id,
        occurrence_number: g.occurrence_number,
        starts_at: g.starts_at.toISOString(),
        status: g.status,
        capacity: g.capacity,
        participants_count: Number(g.participants_count),
      })),
    };
  }
}
