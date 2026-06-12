import { type Buffer } from "node:buffer";
import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors/AppError.js";
import { type MedicalCrypto } from "./medical.crypto.js";
import {
  type GameMedicalParticipant,
  type GameMedicalSummaryResponse,
  type MedicalProfileResponse,
  type SignWaiverResponse,
  type UpdateMedicalProfileRequest,
} from "./medical.schema.js";

export interface MedicalServiceDeps {
  db: DbHandle;
  crypto: MedicalCrypto;
}

interface ProfileRow {
  user_id: string;
  blood_type: Buffer | null;
  allergies: Buffer | null;
  conditions: Buffer | null;
  medications: Buffer | null;
  emergency_contact_name: Buffer | null;
  emergency_contact_phone: Buffer | null;
  share_medical_with_host: boolean;
  updated_at: Date;
}

/**
 * Service for the Medical agent. Owns:
 *   - GET/PUT /api/v1/me/medical-profile
 *   - GET     /api/v1/games/:id/medical-summary  (host-only)
 *   - POST    /api/v1/tournaments/:id/sign-waiver
 *
 * Encryption is opaque to the route layer — the `MedicalCrypto`
 * dependency hides whether columns are AES-256-GCM ciphertext or raw
 * UTF-8. See `medical.crypto.ts` for the envelope format.
 */
export class MedicalService {
  constructor(private readonly deps: MedicalServiceDeps) {}

  /** Empty-profile sentinel returned by `getProfile` when no row exists
   *  yet. We don't pre-create rows on user signup — lazy creation keeps
   *  the medical_profiles table free of stub rows for users who never
   *  visit the screen. */
  private static emptyProfile(): MedicalProfileResponse {
    return {
      blood_type: null,
      allergies: null,
      conditions: null,
      medications: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      share_medical_with_host: false,
      updated_at: null,
    };
  }

  /** Decode a single bytea column to UTF-8 plaintext (post-decryption). */
  private decode(blob: Buffer | null): string | null {
    if (blob === null) return null;
    return this.deps.crypto.decrypt(blob);
  }

  private rowToResponse(row: ProfileRow): MedicalProfileResponse {
    return {
      blood_type: this.decode(row.blood_type),
      allergies: this.decode(row.allergies),
      conditions: this.decode(row.conditions),
      medications: this.decode(row.medications),
      emergency_contact_name: this.decode(row.emergency_contact_name),
      emergency_contact_phone: this.decode(row.emergency_contact_phone),
      share_medical_with_host: row.share_medical_with_host,
      updated_at: row.updated_at.toISOString(),
    };
  }

  async getProfile(userId: string): Promise<MedicalProfileResponse> {
    const row = await this.deps.db.db
      .selectFrom("medical_profiles")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (!row) return MedicalService.emptyProfile();
    return this.rowToResponse(row);
  }

  /**
   * Owner update. Missing fields are not touched; `null` clears them.
   * We upsert because the row may not exist yet (lazy create — see
   * `getProfile`). `updated_at` is bumped on every write so the iOS
   * client can show a "Last updated" stamp.
   */
  async upsertProfile(
    userId: string,
    body: UpdateMedicalProfileRequest,
  ): Promise<MedicalProfileResponse> {
    // We can't use Kysely's onConflict().doUpdateSet() conveniently with
    // raw bytea + partial updates, so do an explicit SELECT-then-merge
    // within a transaction. The volume here is tiny — one row per user
    // edit, no hot path concerns.
    return await this.deps.db.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom("medical_profiles")
        .selectAll()
        .where("user_id", "=", userId)
        .forUpdate()
        .executeTakeFirst();

      const encField = (
        key:
          | "blood_type"
          | "allergies"
          | "conditions"
          | "medications"
          | "emergency_contact_name"
          | "emergency_contact_phone",
      ): Buffer | null => {
        if (!(key in body)) {
          return (existing as ProfileRow | undefined)?.[key] ?? null;
        }
        const v = body[key];
        if (v === null || v === undefined) return null;
        const trimmed = v.trim();
        if (trimmed.length === 0) return null;
        return this.deps.crypto.encrypt(trimmed);
      };

      const share =
        body.share_medical_with_host ??
        (existing as ProfileRow | undefined)?.share_medical_with_host ??
        false;

      const values = {
        user_id: userId,
        blood_type: encField("blood_type"),
        allergies: encField("allergies"),
        conditions: encField("conditions"),
        medications: encField("medications"),
        emergency_contact_name: encField("emergency_contact_name"),
        emergency_contact_phone: encField("emergency_contact_phone"),
        share_medical_with_host: share,
        updated_at: new Date(),
      };

      if (existing) {
        await trx
          .updateTable("medical_profiles")
          .set(values)
          .where("user_id", "=", userId)
          .execute();
      } else {
        await trx.insertInto("medical_profiles").values(values).execute();
      }

      // Re-read so we always return the canonical decoded view.
      const fresh = await trx
        .selectFrom("medical_profiles")
        .selectAll()
        .where("user_id", "=", userId)
        .executeTakeFirstOrThrow();
      return this.rowToResponse(fresh);
    });
  }

  /**
   * Host-only summary of confirmed participants' medical info for the
   * given game. Throws:
   *   - `NotFoundError` if the game does not exist
   *   - `ForbiddenError` if the caller is not the host
   *
   * Only participants with `share_medical_with_host = true` are returned;
   * the rest are silently omitted. We restrict the surface to
   * blood_type / allergies / emergency_contact_phone — the three items a
   * first-responder typically needs.
   */
  async hostSummary(
    gameId: string,
    actorUserId: string,
  ): Promise<GameMedicalSummaryResponse> {
    const game = await this.deps.db.db
      .selectFrom("games")
      .select(["id", "host_user_id"])
      .where("id", "=", gameId)
      .executeTakeFirst();
    if (!game) throw new NotFoundError("Game not found");
    if (game.host_user_id !== actorUserId) {
      throw new ForbiddenError("Only the host can view medical info for this game");
    }

    const rows = await sql<{
      user_id: string;
      display_name: string;
      blood_type: Buffer | null;
      allergies: Buffer | null;
      emergency_contact_phone: Buffer | null;
    }>`
      SELECT u.id AS user_id,
             u.display_name,
             m.blood_type,
             m.allergies,
             m.emergency_contact_phone
        FROM game_participants gp
        JOIN users u ON u.id = gp.user_id
        JOIN medical_profiles m ON m.user_id = gp.user_id
       WHERE gp.game_id = ${gameId}
         AND gp.status = 'confirmed'
         AND m.share_medical_with_host = true
         AND gp.user_id <> ${actorUserId}
       ORDER BY u.display_name ASC
    `.execute(this.deps.db.db);

    const items: GameMedicalParticipant[] = rows.rows.map((r) => ({
      user_id: r.user_id,
      display_name: r.display_name,
      blood_type: this.decode(r.blood_type),
      allergies: this.decode(r.allergies),
      emergency_contact_phone: this.decode(r.emergency_contact_phone),
    }));

    return { game_id: gameId, items };
  }

  /**
   * Record a tournament-waiver acknowledgment. Idempotent — calling
   * twice from the same user is a no-op, the existing row stands and
   * `already_signed` flips to true.
   *
   * Throws `NotFoundError` if the tournament does not exist.
   */
  async signWaiver(
    tournamentId: string,
    userId: string,
    ctx: { ip: string | null; userAgent: string | null },
  ): Promise<SignWaiverResponse> {
    const tournament = await this.deps.db.db
      .selectFrom("tournaments")
      .select(["id"])
      .where("id", "=", tournamentId)
      .executeTakeFirst();
    if (!tournament) throw new NotFoundError("Tournament not found");

    // ON CONFLICT DO NOTHING gives us the idempotent semantics for free.
    // RETURNING reports only the freshly-inserted row, so a NULL result
    // means "already existed" — we then re-read to pick up the prior row.
    const inserted = await sql<{
      tournament_id: string;
      user_id: string;
      signed_at: Date;
    }>`
      INSERT INTO tournament_waivers (tournament_id, user_id, ip, user_agent)
      VALUES (${tournamentId}, ${userId}, ${ctx.ip}, ${ctx.userAgent})
      ON CONFLICT (tournament_id, user_id) DO NOTHING
      RETURNING tournament_id, user_id, signed_at
    `.execute(this.deps.db.db);

    if (inserted.rows[0]) {
      const r = inserted.rows[0];
      return {
        tournament_id: r.tournament_id,
        user_id: r.user_id,
        signed_at: r.signed_at.toISOString(),
        already_signed: false,
      };
    }

    const prior = await sql<{ signed_at: Date }>`
      SELECT signed_at FROM tournament_waivers
       WHERE tournament_id = ${tournamentId}
         AND user_id = ${userId}
       LIMIT 1
    `.execute(this.deps.db.db);
    return {
      tournament_id: tournamentId,
      user_id: userId,
      signed_at: (prior.rows[0]?.signed_at ?? new Date()).toISOString(),
      already_signed: true,
    };
  }

  /**
   * Internal: has `userId` signed the waiver for `tournamentId`?
   *
   * Exposed for the Tournaments agent (or any future module) to gate
   * registration on a signed waiver. Returns a boolean rather than
   * throwing because callers typically want to surface a user-facing
   * "please sign waiver first" error with their own copy.
   */
  async hasSignedWaiver(tournamentId: string, userId: string): Promise<boolean> {
    const row = await this.deps.db.db
      .selectFrom("tournament_waivers")
      .select("user_id")
      .where("tournament_id", "=", tournamentId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return row !== undefined;
  }
}
