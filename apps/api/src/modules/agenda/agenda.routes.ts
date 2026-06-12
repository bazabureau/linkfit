import { z } from "zod";
import { sql } from "kysely";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { ValidationError } from "../../shared/errors/AppError.js";

/**
 * In-app calendar agent — single aggregated agenda endpoint.
 *
 * The iOS calendar pulls the caller's games, bookings, and tournaments in one
 * round-trip rather than three. This keeps the day-cell heat-map snappy and
 * avoids three independent network states in the view-model.
 *
 * Auth is required: every bucket is scoped to the caller by participation,
 * ownership, or registration. We intentionally don't expose this on a public
 * surface — there's no "agenda" without an authenticated user.
 */

export interface AgendaRouteDeps {
  db: DbHandle;
  jwtAccessSecret: string;
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

const AgendaQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
});

const AgendaItem = z.object({
  id: z.string().uuid(),
  kind: z.enum(["game", "booking", "tournament"]),
  starts_at: z.string(),
  ends_at: z.string(),
  title: z.string(),
  venue_name: z.string().nullable(),
});

const AgendaResponse = z.object({
  games: z.array(AgendaItem),
  bookings: z.array(AgendaItem),
  tournaments: z.array(AgendaItem),
});

interface RangeBounds {
  fromDate: Date;
  toDate: Date;
}

/** Parse the YYYY-MM-DD bounds into a [from 00:00 UTC, to+1 00:00 UTC) range.
 *  We treat the input as a calendar-day range and inclusive on both ends. */
function parseRange(from: string, to: string): RangeBounds {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  // Inclusive end: bump to next day midnight so a `<` comparison catches the
  // whole final calendar day in UTC.
  const toDate = new Date(`${to}T00:00:00.000Z`);
  toDate.setUTCDate(toDate.getUTCDate() + 1);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new ValidationError("Invalid date in range");
  }
  if (fromDate.getTime() >= toDate.getTime()) {
    throw new ValidationError("`from` must be on or before `to`");
  }
  return { fromDate, toDate };
}

export function registerAgendaRoutes(app: LinkfitServer, deps: AgendaRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.get(
    "/api/v1/me/agenda",
    {
      preHandler: authenticate,
      schema: {
        querystring: AgendaQuery,
        response: { 200: AgendaResponse, 400: ErrorEnvelope, 401: ErrorEnvelope },
        tags: ["agenda"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const { fromDate, toDate } = parseRange(req.query.from, req.query.to);

      // Games where the user is the host OR a confirmed participant. We
      // explicitly include cancelled games — the calendar shows them too so
      // users know what's gone.
      const gameRows = await sql<{
        id: string;
        starts_at: Date;
        duration_minutes: number;
        sport_name: string;
        venue_name: string | null;
      }>`
        SELECT g.id,
               g.starts_at,
               g.duration_minutes,
               s.name AS sport_name,
               v.name AS venue_name
          FROM games g
          JOIN sports s ON s.id = g.sport_id
     LEFT JOIN courts c ON c.id = g.court_id
     LEFT JOIN venues v ON v.id = c.venue_id
         WHERE g.starts_at >= ${fromDate}
           AND g.starts_at < ${toDate}
           AND (
                 g.host_user_id = ${userId}
              OR EXISTS (
                   SELECT 1 FROM game_participants gp
                    WHERE gp.game_id = g.id
                      AND gp.user_id = ${userId}
                      AND gp.status IN ('confirmed', 'played')
                 )
               )
         ORDER BY g.starts_at ASC
      `.execute(deps.db.db);

      // Bookings owned by the caller. We rely on (starts_at + duration) being
      // inside the range — a booking spanning midnight still appears under its
      // starting day, which is what users intuitively expect on a calendar.
      const bookingRows = await sql<{
        id: string;
        starts_at: Date;
        duration_minutes: number;
        venue_name: string;
        court_name: string;
      }>`
        SELECT b.id,
               b.starts_at,
               b.duration_minutes,
               v.name AS venue_name,
               c.name AS court_name
          FROM bookings b
          JOIN courts c ON c.id = b.court_id
          JOIN venues v ON v.id = c.venue_id
         WHERE b.user_id = ${userId}
           AND b.starts_at >= ${fromDate}
           AND b.starts_at < ${toDate}
         ORDER BY b.starts_at ASC
      `.execute(deps.db.db);

      // Tournaments where the user is captain OR listed in player_ids.
      // We use an array overlap (`ANY`) on the text[] column so we can match
      // either side. Withdrawn entries are excluded — they're gone from the
      // user's calendar.
      const tournamentRows = await sql<{
        id: string;
        starts_at: Date;
        ends_at: Date;
        name: string;
        venue_name: string | null;
      }>`
        SELECT t.id,
               t.starts_at,
               t.ends_at,
               t.name,
               v.name AS venue_name
          FROM tournaments t
     LEFT JOIN venues v ON v.id = t.venue_id
         WHERE t.starts_at >= ${fromDate}
           AND t.starts_at < ${toDate}
           AND EXISTS (
                 SELECT 1 FROM tournament_entries te
                  WHERE te.tournament_id = t.id
                    AND te.status <> 'withdrawn'
                    AND (
                          te.captain_user_id = ${userId}
                       OR ${userId} = ANY (te.player_ids)
                        )
               )
         ORDER BY t.starts_at ASC
      `.execute(deps.db.db);

      return reply.status(200).send({
        games: gameRows.rows.map((g) => ({
          id: g.id,
          kind: "game" as const,
          starts_at: g.starts_at.toISOString(),
          ends_at: new Date(g.starts_at.getTime() + g.duration_minutes * 60_000).toISOString(),
          title: g.sport_name,
          venue_name: g.venue_name,
        })),
        bookings: bookingRows.rows.map((b) => ({
          id: b.id,
          kind: "booking" as const,
          starts_at: b.starts_at.toISOString(),
          ends_at: new Date(b.starts_at.getTime() + b.duration_minutes * 60_000).toISOString(),
          title: b.court_name,
          venue_name: b.venue_name,
        })),
        tournaments: tournamentRows.rows.map((t) => ({
          id: t.id,
          kind: "tournament" as const,
          starts_at: t.starts_at.toISOString(),
          ends_at: t.ends_at.toISOString(),
          title: t.name,
          venue_name: t.venue_name,
        })),
      });
    },
  );
}
