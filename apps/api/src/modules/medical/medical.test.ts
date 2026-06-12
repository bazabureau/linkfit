import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import {
  createTestUser,
  truncateAll,
  type TestUser,
} from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  AesGcmMedicalCrypto,
  PlaintextMedicalCrypto,
  loadMedicalCrypto,
} from "./medical.crypto.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

interface ProfileBody {
  blood_type: string | null;
  allergies: string | null;
  conditions: string | null;
  medications: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  share_medical_with_host: boolean;
  updated_at: string | null;
}

interface SummaryBody {
  game_id: string;
  items: {
    user_id: string;
    display_name: string;
    blood_type: string | null;
    allergies: string | null;
    emergency_contact_phone: string | null;
  }[];
}

interface WaiverBody {
  tournament_id: string;
  user_id: string;
  signed_at: string;
  already_signed: boolean;
}

async function getPadelSportId(db: DbHandle): Promise<string> {
  const row = await sql<{ id: string }>`SELECT id FROM sports WHERE slug = 'padel'`.execute(
    db.db,
  );
  return row.rows[0]!.id;
}

async function createGame(
  app: LinkfitServer,
  host: TestUser,
  padelId: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/games",
    headers: { authorization: `Bearer ${host.access_token}` },
    payload: {
      sport_id: padelId,
      lat: 40.4093,
      lng: 49.8671,
      starts_at: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
      duration_minutes: 90,
      capacity: 4,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createGame failed: ${String(res.statusCode)} ${res.body}`);
  }
  return res.json<{ id: string }>().id;
}

async function joinGame(
  app: LinkfitServer,
  gameId: string,
  user: TestUser,
): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/games/${gameId}/join`,
    headers: { authorization: `Bearer ${user.access_token}` },
  });
  if (res.statusCode !== 200) {
    throw new Error(`joinGame failed: ${String(res.statusCode)} ${res.body}`);
  }
}

async function createTournament(db: DbHandle, padelId: string): Promise<string> {
  const starts = new Date(Date.now() + 7 * ONE_DAY_MS);
  const row = await sql<{ id: string }>`
    INSERT INTO tournaments
      (name, sport_id, starts_at, ends_at, registration_deadline,
       max_squads, squad_size, entry_fee_minor, currency, status)
    VALUES
      ('Waiver Cup', ${padelId},
       ${starts.toISOString()},
       ${new Date(starts.getTime() + 6 * ONE_HOUR_MS).toISOString()},
       ${new Date(starts.getTime() - ONE_HOUR_MS).toISOString()},
       8, 4, 0, 'AZN', 'registration_open')
    RETURNING id
  `.execute(db.db);
  return row.rows[0]!.id;
}

describe("medical agent — pure crypto unit tests", () => {
  it("AES-256-GCM round-trips arbitrary UTF-8", () => {
    const key = randomBytes(32);
    const crypto = new AesGcmMedicalCrypto(key);
    const plaintext = "Penicillin allergy; O+ blood; needs EpiPen — кириллица — 中文";
    const enc = crypto.encrypt(plaintext);
    expect(enc).not.toEqual(Buffer.from(plaintext, "utf8"));
    // IV (12) + tag (16) + ciphertext == plaintext length (no padding).
    expect(enc.length).toBe(12 + 16 + Buffer.byteLength(plaintext, "utf8"));
    expect(crypto.decrypt(enc)).toBe(plaintext);
  });

  it("plaintext crypto passes UTF-8 through unchanged", () => {
    const crypto = new PlaintextMedicalCrypto();
    const buf = crypto.encrypt("hi");
    expect(buf.toString("utf8")).toBe("hi");
    expect(crypto.decrypt(buf)).toBe("hi");
  });

  it("loadMedicalCrypto falls back to plaintext when no key is set", () => {
    const r = loadMedicalCrypto(undefined);
    expect(r.unencrypted).toBe(true);
    expect(r.crypto.encrypted).toBe(false);
  });

  it("loadMedicalCrypto accepts a base64 32-byte key", () => {
    const key = randomBytes(32).toString("base64");
    const r = loadMedicalCrypto(key);
    expect(r.unencrypted).toBe(false);
    expect(r.crypto.encrypted).toBe(true);
  });

  it("loadMedicalCrypto rejects keys of the wrong length", () => {
    expect(() => loadMedicalCrypto("short")).toThrow();
  });
});

describe("medical routes", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let padelId: string;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    await app.ready();
    padelId = await getPadelSportId(db);
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
    padelId = await getPadelSportId(db);
  });

  // ─── GET / PUT /me/medical-profile ─────────────────────────────────

  describe("GET /api/v1/me/medical-profile", () => {
    it("requires auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me/medical-profile",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns an empty profile when the user has never set anything", async () => {
      const u = await createTestUser(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me/medical-profile",
        headers: { authorization: `Bearer ${u.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<ProfileBody>();
      expect(body.blood_type).toBeNull();
      expect(body.allergies).toBeNull();
      expect(body.share_medical_with_host).toBe(false);
      expect(body.updated_at).toBeNull();
    });
  });

  describe("PUT /api/v1/me/medical-profile", () => {
    it("requires auth", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/me/medical-profile",
        payload: { blood_type: "O+" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("creates and updates the profile, including the share opt-in", async () => {
      const u = await createTestUser(app);
      const put1 = await app.inject({
        method: "PUT",
        url: "/api/v1/me/medical-profile",
        headers: { authorization: `Bearer ${u.access_token}` },
        payload: {
          blood_type: "O+",
          allergies: "Penicillin",
          emergency_contact_name: "Ali",
          emergency_contact_phone: "+994501234567",
          share_medical_with_host: true,
        },
      });
      expect(put1.statusCode).toBe(200);
      const body1 = put1.json<ProfileBody>();
      expect(body1.blood_type).toBe("O+");
      expect(body1.allergies).toBe("Penicillin");
      expect(body1.share_medical_with_host).toBe(true);
      expect(body1.updated_at).not.toBeNull();

      // Partial update — leaves untouched fields alone, can null a field.
      const put2 = await app.inject({
        method: "PUT",
        url: "/api/v1/me/medical-profile",
        headers: { authorization: `Bearer ${u.access_token}` },
        payload: { allergies: null, conditions: "Asthma" },
      });
      expect(put2.statusCode).toBe(200);
      const body2 = put2.json<ProfileBody>();
      expect(body2.allergies).toBeNull();
      expect(body2.conditions).toBe("Asthma");
      expect(body2.blood_type).toBe("O+"); // untouched
      expect(body2.share_medical_with_host).toBe(true); // untouched
    });

    it("encryption round-trips when MEDICAL_ENCRYPTION_KEY is set (raw column is not plaintext)", async () => {
      // Spin up a SECOND server bound to the same DB, with an encryption
      // key wired into the env. This is the only test that requires its
      // own app instance — the rest share the suite-wide `app` configured
      // with the plaintext fallback (mirroring CI default).
      const key = randomBytes(32).toString("base64");
      process.env.MEDICAL_ENCRYPTION_KEY = key;
      const encApp = await buildServer({ env, logger: pino({ level: "silent" }), db });
      await encApp.ready();
      try {
        const u = await createTestUser(encApp);
        const allergies = "Penicillin & sesame seeds";
        const put = await encApp.inject({
          method: "PUT",
          url: "/api/v1/me/medical-profile",
          headers: { authorization: `Bearer ${u.access_token}` },
          payload: { allergies, blood_type: "AB-" },
        });
        expect(put.statusCode).toBe(200);

        // Inspect the raw bytea — must NOT equal the utf8 plaintext bytes,
        // and must be at least IV(12)+TAG(16) bytes longer than plaintext.
        const row = await sql<{ allergies: Buffer | null }>`
          SELECT allergies FROM medical_profiles WHERE user_id = ${u.id}
        `.execute(db.db);
        const raw = row.rows[0]?.allergies;
        expect(raw).toBeTruthy();
        const utf8 = Buffer.from(allergies, "utf8");
        expect(Buffer.compare(raw!, utf8)).not.toBe(0);
        expect((raw!).length).toBeGreaterThanOrEqual(
          12 + 16 + utf8.length,
        );

        // Round-trip through the API — decrypted view matches.
        const get = await encApp.inject({
          method: "GET",
          url: "/api/v1/me/medical-profile",
          headers: { authorization: `Bearer ${u.access_token}` },
        });
        expect(get.json<ProfileBody>().allergies).toBe(allergies);
      } finally {
        await encApp.close();
        delete process.env.MEDICAL_ENCRYPTION_KEY;
      }
    });
  });

  // ─── Host summary ──────────────────────────────────────────────────

  describe("GET /api/v1/games/:id/medical-summary", () => {
    it("403 when caller is not the host", async () => {
      const host = await createTestUser(app);
      const other = await createTestUser(app);
      const gameId = await createGame(app, host, padelId);

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/games/${gameId}/medical-summary`,
        headers: { authorization: `Bearer ${other.access_token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("404 for unknown game id", async () => {
      const u = await createTestUser(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/games/00000000-0000-0000-0000-000000000000/medical-summary",
        headers: { authorization: `Bearer ${u.access_token}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("only includes participants who opted in to sharing", async () => {
      const host = await createTestUser(app);
      const opted = await createTestUser(app, { display_name: "Opted In" });
      const notOpted = await createTestUser(app, { display_name: "Opt Out" });
      const gameId = await createGame(app, host, padelId);
      await joinGame(app, gameId, opted);
      await joinGame(app, gameId, notOpted);

      // `opted` opts in with full payload; `notOpted` saves a profile
      // but leaves `share_medical_with_host` false.
      await app.inject({
        method: "PUT",
        url: "/api/v1/me/medical-profile",
        headers: { authorization: `Bearer ${opted.access_token}` },
        payload: {
          blood_type: "B+",
          allergies: "Latex",
          emergency_contact_phone: "+994551112233",
          share_medical_with_host: true,
        },
      });
      await app.inject({
        method: "PUT",
        url: "/api/v1/me/medical-profile",
        headers: { authorization: `Bearer ${notOpted.access_token}` },
        payload: {
          blood_type: "A-",
          allergies: "None",
          share_medical_with_host: false,
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/games/${gameId}/medical-summary`,
        headers: { authorization: `Bearer ${host.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<SummaryBody>();
      expect(body.game_id).toBe(gameId);
      expect(body.items.map((i) => i.user_id)).toEqual([opted.id]);
      expect(body.items[0]!.blood_type).toBe("B+");
      expect(body.items[0]!.allergies).toBe("Latex");
      expect(body.items[0]!.emergency_contact_phone).toBe("+994551112233");
    });
  });

  // ─── Tournament waiver ─────────────────────────────────────────────

  describe("POST /api/v1/tournaments/:id/sign-waiver", () => {
    it("requires auth", async () => {
      const tid = await createTournament(db, padelId);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/sign-waiver`,
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    });

    it("404 for unknown tournament", async () => {
      const u = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/tournaments/00000000-0000-0000-0000-000000000000/sign-waiver",
        headers: { authorization: `Bearer ${u.access_token}` },
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });

    it("double-sign is idempotent — second call reports already_signed", async () => {
      const u = await createTestUser(app);
      const tid = await createTournament(db, padelId);

      const r1 = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/sign-waiver`,
        headers: { authorization: `Bearer ${u.access_token}` },
        payload: {},
      });
      expect(r1.statusCode).toBe(200);
      const b1 = r1.json<WaiverBody>();
      expect(b1.already_signed).toBe(false);
      expect(b1.user_id).toBe(u.id);
      expect(b1.tournament_id).toBe(tid);
      const firstSignedAt = b1.signed_at;

      const r2 = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/sign-waiver`,
        headers: { authorization: `Bearer ${u.access_token}` },
        payload: {},
      });
      expect(r2.statusCode).toBe(200);
      const b2 = r2.json<WaiverBody>();
      expect(b2.already_signed).toBe(true);
      // Signed_at must NOT change on a re-sign.
      expect(b2.signed_at).toBe(firstSignedAt);

      // Exactly one waiver row exists, end to end.
      const count = await sql<{ c: string }>`
        SELECT count(*)::text AS c FROM tournament_waivers
         WHERE tournament_id = ${tid} AND user_id = ${u.id}
      `.execute(db.db);
      expect(Number(count.rows[0]!.c)).toBe(1);
    });
  });
});
