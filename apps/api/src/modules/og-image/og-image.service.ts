import { type Buffer } from "node:buffer";
import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { NotFoundError } from "../../shared/errors/AppError.js";
import { PngCache } from "./cache.js";
import { renderToPng } from "./render.js";
import {
  gameCard,
  tournamentCard,
  userCard,
  type GameCardData,
  type TournamentCardData,
  type UserCardData,
} from "./templates.js";

export interface OgImageServiceDeps {
  db: DbHandle;
  cache?: PngCache;
}

interface GameRow {
  id: string;
  starts_at: Date;
  capacity: number;
  participants_count: string;
  skill_min_elo: number | null;
  skill_max_elo: number | null;
  venue_name: string | null;
  host_user_id: string;
  updated_at: Date;
}

interface UserRow {
  id: string;
  display_name: string;
  updated_at: Date;
}

interface TournamentRow {
  id: string;
  name: string;
  starts_at: Date;
  ends_at: Date;
  entry_fee_minor: number;
  currency: string;
  max_squads: number;
  entries_count: string;
  updated_at: Date;
}

interface ParticipantRow {
  user_id: string;
  display_name: string;
  is_host: boolean;
}

/**
 * OG-image service.
 *
 * Each public method follows the same shape:
 *   1. Look up enough metadata to compose a cache key
 *      (`<entity>:<id>:<updated_at>`). When the entity changes the key
 *      naturally invalidates.
 *   2. Cache hit → return the cached PNG buffer.
 *   3. Miss → fetch the full row set, render with satori+resvg, store,
 *      return.
 */
export class OgImageService {
  private readonly db: DbHandle;
  private readonly cache: PngCache;

  constructor(deps: OgImageServiceDeps) {
    this.db = deps.db;
    this.cache = deps.cache ?? new PngCache();
  }

  async renderGame(gameId: string): Promise<Buffer> {
    const gameRows = await sql<GameRow>`
      SELECT g.id,
             g.starts_at,
             g.capacity,
             g.skill_min_elo,
             g.skill_max_elo,
             g.host_user_id,
             g.updated_at,
             v.name AS venue_name,
             (SELECT count(*) FROM game_participants gp
               WHERE gp.game_id = g.id
                 AND gp.status = 'confirmed')::text AS participants_count
        FROM games g
        LEFT JOIN courts c ON c.id = g.court_id
        LEFT JOIN venues v ON v.id = c.venue_id
       WHERE g.id = ${gameId}
       LIMIT 1
    `.execute(this.db.db);

    const game = gameRows.rows[0];
    if (!game) throw new NotFoundError("Game not found");

    const key = `game:${game.id}:${game.updated_at.toISOString()}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const participantRows = await sql<ParticipantRow>`
      SELECT gp.user_id,
             u.display_name,
             (gp.user_id = ${game.host_user_id}) AS is_host
        FROM game_participants gp
        JOIN users u ON u.id = gp.user_id
       WHERE gp.game_id = ${gameId}
         AND gp.status = 'confirmed'
       ORDER BY (gp.user_id = ${game.host_user_id}) DESC, gp.joined_at ASC
       LIMIT 4
    `.execute(this.db.db);

    const data: GameCardData = {
      title: game.venue_name !== null && game.venue_name.length > 0
        ? `Padel match at ${game.venue_name}`
        : "Padel match",
      venueName: game.venue_name,
      startsAt: game.starts_at.toISOString(),
      capacity: game.capacity,
      participantsCount: Number(game.participants_count),
      skillMinElo: game.skill_min_elo,
      skillMaxElo: game.skill_max_elo,
      participants: participantRows.rows.map((p) => ({
        displayName: p.display_name,
        isHost: p.is_host,
      })),
    };

    const png = await renderToPng(gameCard(data));
    this.cache.set(key, png);
    return png;
  }

  async renderUser(userId: string): Promise<Buffer> {
    const userRow = await this.db.db
      .selectFrom("users")
      .select(["id", "display_name", "updated_at"])
      .where("id", "=", userId)
      .where("deleted_at", "is", null)
      .executeTakeFirst() as UserRow | undefined;
    if (!userRow) throw new NotFoundError("User not found");

    const key = `user:${userRow.id}:${userRow.updated_at.toISOString()}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    // Padel stats. ELO defaults to 1200, win rate to 0 when the user has
    // no padel participation yet — same defaults used elsewhere.
    const stats = await sql<{
      elo_rating: number;
      games_played: number;
      games_won: number;
    }>`
      SELECT pss.elo_rating,
             pss.games_played,
             pss.games_won
        FROM player_sport_stats pss
        JOIN sports s ON s.id = pss.sport_id
       WHERE pss.user_id = ${userId}
         AND s.slug      = 'padel'
       LIMIT 1
    `.execute(this.db.db);

    const row = stats.rows[0];
    const elo = row?.elo_rating ?? 1200;
    const played = row?.games_played ?? 0;
    const won = row?.games_won ?? 0;
    const winRate = played === 0 ? 0 : won / played;

    const data: UserCardData = {
      displayName: userRow.display_name,
      elo,
      winRate,
      gamesPlayed: played,
    };
    const png = await renderToPng(userCard(data));
    this.cache.set(key, png);
    return png;
  }

  async renderTournament(tournamentId: string): Promise<Buffer> {
    const rows = await sql<TournamentRow>`
      SELECT t.id,
             t.name,
             t.starts_at,
             t.ends_at,
             t.entry_fee_minor,
             t.currency,
             t.max_squads,
             t.updated_at,
             (SELECT count(*) FROM tournament_entries te
               WHERE te.tournament_id = t.id
                 AND te.status IN ('pending','confirmed'))::text AS entries_count
        FROM tournaments t
       WHERE t.id = ${tournamentId}
       LIMIT 1
    `.execute(this.db.db);
    const t = rows.rows[0];
    if (!t) throw new NotFoundError("Tournament not found");

    const key = `tournament:${t.id}:${t.updated_at.toISOString()}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const data: TournamentCardData = {
      name: t.name,
      startsAt: t.starts_at.toISOString(),
      endsAt: t.ends_at.toISOString(),
      prizeMinor: t.entry_fee_minor,
      currency: t.currency,
      entriesCount: Number(t.entries_count),
      maxSquads: t.max_squads,
    };
    const png = await renderToPng(tournamentCard(data));
    this.cache.set(key, png);
    return png;
  }
}
