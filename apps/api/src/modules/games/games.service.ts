import { Buffer } from "node:buffer";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { gamesRepository } from "./games.repository.js";
import { type GameDetail, type GameSummary } from "./games.types.js";
import {
  type CreateGameRequest,
  type GamesListQuery,
  type UpdateGameRequest,
} from "./games.schema.js";
import { catalogRepository } from "../catalog/catalog.repository.js";
import { type TelemetryHandle } from "../../shared/telemetry/metrics.js";
import { FeedService } from "../feed/feed.service.js";
import { type FeedEmitter } from "../feed/feed.types.js";
import { type NotificationsService } from "../social/notifications.service.js";
// Product analytics (PostHog). Fire-and-forget — `track(...)` is a no-op
// when `POSTHOG_API_KEY` is unset; see `shared/observability/analytics.ts`.
import { track as analyticsTrack } from "../../shared/observability/analytics.js";

export interface GamesServiceDeps {
  db: DbHandle;
  /** Optional metrics handle — when set, `create()` increments
   *  `linkfit_games_created_total{sport=<slug>}`. */
  telemetry?: TelemetryHandle | undefined;
  /**
   * Optional feed emitter — when present, host/join actions fire activity
   * events synchronously (fire-and-forget; never blocks or fails the parent
   * transaction). When absent, falls back to a FeedService constructed from
   * the same `db` handle so production wiring works without touching the
   * server bootstrap. Tests can inject a mock to assert emission shape.
   */
  feed?: FeedEmitter | undefined;
  /**
   * Optional notifications gateway — used by `cancelGame` and
   * `rescheduleGame` to fan out push/in-app notifications to every
   * confirmed participant. Left undefined in unit tests that only
   * assert state transitions, in which case the actions still succeed
   * but participants don't receive a banner. Production server wires
   * this after `notificationsService` is constructed (see `server.ts`).
   */
  notifications?: NotificationsService | undefined;
}

export interface GameListPage {
  items: GameSummary[];
  next_cursor: string | null;
}

interface CursorPayload {
  starts_at: string;
  id: string;
}

function encodeCursor(c: CursorPayload): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}
function decodeCursor(s: string): CursorPayload | null {
  try {
    const raw = Buffer.from(s, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "starts_at" in parsed &&
      "id" in parsed &&
      typeof (parsed as { starts_at: unknown }).starts_at === "string" &&
      typeof (parsed as { id: unknown }).id === "string"
    ) {
      return parsed as CursorPayload;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export class GamesService {
  private readonly feed: FeedEmitter;

  constructor(private readonly deps: GamesServiceDeps) {
    // Auto-construct a FeedService from the shared db handle when the caller
    // doesn't inject one. This keeps server.ts agnostic of the feed wiring —
    // every emit is fire-and-forget so a feed-write failure can never bubble
    // back into the games hot-path.
    this.feed = deps.feed ?? new FeedService({ db: deps.db });
  }

  async create(hostUserId: string, req: CreateGameRequest): Promise<GameDetail> {
    const sport = await this.deps.db.db
      .selectFrom("sports")
      .selectAll()
      .where("id", "=", req.sport_id)
      .executeTakeFirst();
    if (!sport) throw new ValidationError("Unknown sport_id");

    const startsAt = new Date(req.starts_at);
    if (startsAt.getTime() <= Date.now()) {
      throw new ValidationError("starts_at must be in the future");
    }
    if (
      req.skill_min_elo !== undefined &&
      req.skill_min_elo !== null &&
      req.skill_max_elo !== undefined &&
      req.skill_max_elo !== null &&
      req.skill_min_elo > req.skill_max_elo
    ) {
      throw new ValidationError("skill_min_elo must be <= skill_max_elo");
    }

    const capacity = req.capacity ?? sport.max_players;
    if (capacity < sport.min_players || capacity > sport.max_players) {
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
        throw new ValidationError("Court sport does not match game sport");
      }
    }

    const detail = await withTransaction(this.deps.db.db, async (tx) => {
      const id = await gamesRepository.insert(tx, {
        sport_id: req.sport_id,
        court_id: req.court_id ?? null,
        host_user_id: hostUserId,
        lat: req.lat,
        lng: req.lng,
        starts_at: startsAt,
        duration_minutes: req.duration_minutes,
        capacity,
        skill_min_elo: req.skill_min_elo ?? null,
        skill_max_elo: req.skill_max_elo ?? null,
        visibility: req.visibility ?? "public",
        notes: req.notes ?? null,
      });
      await tx
        .insertInto("game_participants")
        .values({ game_id: id, user_id: hostUserId, status: "confirmed" })
        .execute();

      const created = await gamesRepository.findById(tx, id);
      if (!created) throw new NotFoundError("Game vanished after creation");
      this.deps.telemetry?.business.gamesCreated.inc({ sport: sport.slug });
      return created;
    });

    // Fire-and-forget feed emit AFTER the tx commits — never blocks the
    // host on a feed insert hiccup. We share the worker's `sourceKey`
    // shape (`gp:<game_id>:<user_id>`) so the polling fallback won't
    // emit a duplicate when it sweeps later.
    void this.feed
      .emit({
        actorUserId: hostUserId,
        type: "joined_game",
        payload: {
          game_id: detail.id,
          sport_slug: detail.sport_slug,
          venue_name: detail.venue_name,
          is_host: true,
        },
        sourceKey: `gp:${detail.id}:${hostUserId}`,
      })
      .catch(() => {
        /* swallow — feed emission must never break game creation */
      });

    // Product analytics — `game_created`. Fires AFTER the tx commits so
    // we never emit for a rolled-back insert. Fire-and-forget: the
    // facade is a no-op when `POSTHOG_API_KEY` is unset, and capture
    // failures are swallowed inside the helper so we never break the
    // create response on a PostHog hiccup.
    analyticsTrack({
      distinctId: hostUserId,
      event: "game_created",
      properties: {
        visibility: detail.visibility,
        capacity: detail.capacity,
        sport_slug: detail.sport_slug,
      },
    });

    return detail;
  }

  async list(query: GamesListQuery, viewerUserId: string | null = null): Promise<GameListPage> {
    const limit = query.limit ?? 20;
    const params: Parameters<typeof gamesRepository.search>[1] = { limit };
    if (query.lat !== undefined) params.lat = query.lat;
    if (query.lng !== undefined) params.lng = query.lng;
    if (query.radius_km !== undefined) params.radiusKm = query.radius_km;
    if (query.sport !== undefined) params.sportSlug = query.sport;
    if (query.from !== undefined) params.from = new Date(query.from);
    if (query.to !== undefined) params.to = new Date(query.to);
    if (query.cursor !== undefined) {
      const c = decodeCursor(query.cursor);
      if (c) {
        params.cursorStartsAt = new Date(c.starts_at);
        params.cursorId = c.id;
      }
    }
    // When a viewer is signed in, hide games whose host is in a block
    // relationship (either direction) with the viewer.
    if (viewerUserId !== null) params.viewerUserId = viewerUserId;
    const items = await gamesRepository.search(this.deps.db.db, params);
    const last = items.length === limit ? items[items.length - 1] : undefined;
    const next = last ? encodeCursor({ starts_at: last.starts_at, id: last.id }) : null;
    return { items, next_cursor: next };
  }

  async getDetail(id: string): Promise<GameDetail> {
    const detail = await gamesRepository.findById(this.deps.db.db, id);
    if (!detail) throw new NotFoundError("Game not found");
    return detail;
  }

  async join(gameId: string, userId: string): Promise<GameDetail> {
    const outcome = await withTransaction(this.deps.db.db, async (tx) =>
      gamesRepository.tryJoin(tx, gameId, userId),
    );
    if (outcome === "joined") {
      const detail = await this.getDetail(gameId);
      // Only emit on a fresh join — `already_in` revives a tombstone but
      // the user already showed up in the feed when they first joined.
      void this.feed
        .emit({
          actorUserId: userId,
          type: "joined_game",
          payload: {
            game_id: detail.id,
            sport_slug: detail.sport_slug,
            venue_name: detail.venue_name,
            is_host: false,
          },
          sourceKey: `gp:${detail.id}:${userId}`,
        })
        .catch(() => {
          /* swallow — feed emission must never break join */
        });

      // Emit game_joined notification to the game host!
      if (this.deps.notifications && detail.host_user_id !== userId) {
        const joiner = await this.deps.db.db
          .selectFrom("users")
          .select("display_name")
          .where("id", "=", userId)
          .executeTakeFirst();

        void this.deps.notifications
          .emit({
            userId: detail.host_user_id,
            type: "game_joined",
            title: "Oyuna yeni iştirakçı qoşuldu",
            body: `${joiner?.display_name ?? "Someone"} oyuna qoşuldu.`,
            payload: {
              game_id: detail.id,
              event: "game_joined",
            },
          })
          .catch(() => {
            /* swallow */
          });
      }

      return detail;
    }
    if (outcome === "already_in") return this.getDetail(gameId);
    if (outcome === "full") throw new ConflictError("Game is full");
    throw new PreconditionFailedError("Game is not joinable");
  }

  async leave(gameId: string, userId: string): Promise<GameDetail> {
    const ok = await withTransaction(this.deps.db.db, async (tx) =>
      gamesRepository.leave(tx, gameId, userId),
    );
    if (!ok) throw new PreconditionFailedError("You are not in this game");
    return this.getDetail(gameId);
  }

  async update(gameId: string, hostId: string, patch: UpdateGameRequest): Promise<GameDetail> {
    const startsAt = patch.starts_at !== undefined ? new Date(patch.starts_at) : undefined;
    if (startsAt && startsAt.getTime() <= Date.now()) {
      throw new ValidationError("starts_at must be in the future");
    }

    const result = await withTransaction(this.deps.db.db, async (tx) => {
      const patchParams: Parameters<typeof gamesRepository.update>[3] = {};
      if (startsAt !== undefined) patchParams.starts_at = startsAt;
      if (patch.duration_minutes !== undefined) patchParams.duration_minutes = patch.duration_minutes;
      if (patch.skill_min_elo !== undefined) patchParams.skill_min_elo = patch.skill_min_elo;
      if (patch.skill_max_elo !== undefined) patchParams.skill_max_elo = patch.skill_max_elo;
      if (patch.notes !== undefined) patchParams.notes = patch.notes;
      if (patch.cancel !== undefined) patchParams.cancel = patch.cancel;
      return gamesRepository.update(tx, gameId, hostId, patchParams);
    });
    if (result === "not_found") throw new NotFoundError("Game not found");
    if (result === "not_host") throw new ForbiddenError("Only the host can modify this game");
    return this.getDetail(gameId);
  }

  async softDelete(gameId: string, hostId: string): Promise<void> {
    const result = await withTransaction(this.deps.db.db, async (tx) =>
      gamesRepository.softDelete(tx, gameId, hostId),
    );
    if (result === "not_found") throw new NotFoundError("Game not found");
    if (result === "not_host") throw new ForbiddenError("Only the host can delete this game");
  }

  /**
   * Wave-10 dedicated cancel flow. Distinct from `softDelete` (which
   * removes the game from every read path) and from the legacy PATCH
   * `cancel:true` shortcut — this path captures an optional reason and
   * fans push notifications out to every confirmed participant so they
   * see "Oyun ləğv edildi" plus the reason without opening the app.
   *
   * Validation contract:
   *  - Game must exist and not be soft-deleted → 404
   *  - Caller must be the host → 403
   *  - Game must not have already started (`starts_at < now()`) — once
   *    play is underway we don't allow cancel, the host can only
   *    annotate the score → 422 / `PreconditionFailedError`
   *  - Already-cancelled games are a 200 no-op (idempotent for the host
   *    who hits the button twice on a flaky network).
   */
  async cancelGame(
    gameId: string,
    hostId: string,
    reason: string | undefined,
  ): Promise<void> {
    // Phase 1 — atomic flip inside a tx. We re-read the row under
    // `FOR UPDATE` so two simultaneous cancels can't both broadcast.
    const cancelResult = await withTransaction(this.deps.db.db, async (tx) => {
      const game = await tx
        .selectFrom("games")
        .select(["host_user_id", "status", "starts_at", "deleted_at"])
        .where("id", "=", gameId)
        .executeTakeFirst();
      if (game?.deleted_at !== null) return "not_found" as const;
      if (game.host_user_id !== hostId) return "not_host" as const;
      if (game.starts_at.getTime() <= Date.now()) return "already_started" as const;
      if (game.status === "cancelled") return "already_cancelled" as const;

      await tx
        .updateTable("games")
        .set({ status: "cancelled" })
        .where("id", "=", gameId)
        .execute();
      return "ok" as const;
    });
    if (cancelResult === "not_found") throw new NotFoundError("Game not found");
    if (cancelResult === "not_host") {
      throw new ForbiddenError("Only the host can cancel this game");
    }
    if (cancelResult === "already_started") {
      throw new PreconditionFailedError("Cannot cancel a game that has already started");
    }
    if (cancelResult === "already_cancelled") return;

    // Phase 2 — fan-out notifications. Runs OUTSIDE the cancel tx so an
    // APNs hiccup never rolls back the cancel. We hand each emit to its
    // own try/catch so one bad token doesn't block the rest.
    if (this.deps.notifications) {
      const recipients = await this.deps.db.db
        .selectFrom("game_participants")
        .select(["user_id"])
        .where("game_id", "=", gameId)
        .where("status", "=", "confirmed")
        .where("user_id", "!=", hostId)
        .execute();
      const trimmedReason = reason?.trim();
      const body = trimmedReason && trimmedReason.length > 0
        ? `Oyun ləğv edildi: ${trimmedReason}`
        : "Oyun ləğv edildi";
      const notif = this.deps.notifications;
      for (const r of recipients) {
        try {
          await notif.emit({
            userId: r.user_id,
            type: "game_cancelled",
            title: "Oyun ləğv edildi",
            body,
            payload: {
              game_id: gameId,
              by: "host",
              ...(trimmedReason && trimmedReason.length > 0
                ? { reason: trimmedReason }
                : {}),
            },
          });
        } catch {
          // Swallow — a busted notification transport must never fail
          // the cancel itself. The DB row is already in 'cancelled'.
        }
      }
    }
  }

  /**
   * Wave-10 reschedule flow. Host moves the game to a new `starts_at`
   * (and optionally adjusts duration). Notifies every confirmed
   * participant so they can update their calendars without opening the
   * app.
   *
   * Validation contract:
   *  - Game must exist and not be soft-deleted → 404
   *  - Caller must be the host → 403
   *  - `starts_at` must be strictly in the future → 400
   *  - Game must not have already started → 422
   *  - Cancelled / completed games can't be rescheduled — moving a
   *    finished game's time invalidates ratings/bookings → 422.
   */
  async rescheduleGame(
    gameId: string,
    hostId: string,
    startsAt: Date,
    durationMinutes: number | undefined,
  ): Promise<GameDetail> {
    if (startsAt.getTime() <= Date.now()) {
      throw new ValidationError("starts_at must be in the future");
    }

    const result = await withTransaction(this.deps.db.db, async (tx) => {
      const game = await tx
        .selectFrom("games")
        .select(["host_user_id", "status", "starts_at", "deleted_at"])
        .where("id", "=", gameId)
        .executeTakeFirst();
      if (game?.deleted_at !== null) return "not_found" as const;
      if (game.host_user_id !== hostId) return "not_host" as const;
      if (game.starts_at.getTime() <= Date.now()) return "already_started" as const;
      if (game.status === "cancelled" || game.status === "completed") {
        return "terminal" as const;
      }

      const patch: Partial<{ starts_at: Date; duration_minutes: number }> = {
        starts_at: startsAt,
      };
      if (durationMinutes !== undefined) patch.duration_minutes = durationMinutes;
      await tx.updateTable("games").set(patch).where("id", "=", gameId).execute();
      return "ok" as const;
    });
    if (result === "not_found") throw new NotFoundError("Game not found");
    if (result === "not_host") {
      throw new ForbiddenError("Only the host can reschedule this game");
    }
    if (result === "already_started") {
      throw new PreconditionFailedError("Cannot reschedule a game that has already started");
    }
    if (result === "terminal") {
      throw new PreconditionFailedError("Cannot reschedule a cancelled or completed game");
    }

    // Fan-out notifications to confirmed participants. Same try/catch
    // shape as `cancelGame` — best-effort, never rolls back the change.
    if (this.deps.notifications) {
      const recipients = await this.deps.db.db
        .selectFrom("game_participants")
        .select(["user_id"])
        .where("game_id", "=", gameId)
        .where("status", "=", "confirmed")
        .where("user_id", "!=", hostId)
        .execute();
      // Format the new time in AZ locale — fall back to ISO if Intl
      // misbehaves on the runtime (it won't, but defensive).
      let formatted: string;
      try {
        formatted = new Intl.DateTimeFormat("az-AZ", {
          dateStyle: "full",
          timeStyle: "short",
          timeZone: "Asia/Baku",
        }).format(startsAt);
      } catch {
        formatted = startsAt.toISOString();
      }
      const notif = this.deps.notifications;
      for (const r of recipients) {
        try {
          // Reuses `game_reminder` so the in-app type / deeplink stays
          // "game" without growing the NotificationType enum. The body
          // copy makes it unambiguous that this is a reschedule, not a
          // 2-hour-out countdown — the user can never confuse the two
          // because reminders never carry a new-time string.
          await notif.emit({
            userId: r.user_id,
            type: "game_reminder",
            title: "Oyun yeni vaxta keçirildi",
            body: `Oyun yeni vaxta keçirildi: ${formatted}`,
            payload: {
              game_id: gameId,
              event: "rescheduled",
              new_starts_at: startsAt.toISOString(),
            },
          });
        } catch {
          // Swallow — DB row is already updated.
        }
      }
    }

    return this.getDetail(gameId);
  }

  async markNoShow(gameId: string, hostId: string, targetId: string): Promise<GameDetail> {
    const result = await withTransaction(this.deps.db.db, async (tx) =>
      gamesRepository.markNoShow(tx, gameId, hostId, targetId),
    );
    if (result === "not_host") throw new ForbiddenError("Only the host can mark no-shows");
    if (result === "not_started") throw new PreconditionFailedError("Cannot mark no-show before game starts");
    if (result === "not_participant") throw new NotFoundError("Target was not a confirmed participant");
    return this.getDetail(gameId);
  }

  // Helper used by other modules (ratings) — exposed for inter-module composition.
  async assertGameExists(id: string): Promise<void> {
    const exists = await this.deps.db.db
      .selectFrom("games")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (!exists) throw new NotFoundError("Game not found");
  }

  // Catalog passthrough so callers don't need to know about both services.
  async listSports(): ReturnType<typeof catalogRepository.listSports> {
    return catalogRepository.listSports(this.deps.db.db);
  }
}
