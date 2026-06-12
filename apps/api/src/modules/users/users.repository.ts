import { sql } from "kysely";
import { type Executor } from "../../shared/db/withTransaction.js";
import { type PublicUser } from "./users.types.js";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  photo_url: string | null;
  home_lat: string | null;
  home_lng: string | null;
  email_verified_at: Date | null;
  admin_role: "admin" | "moderator" | "partner" | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface InsertUserParams {
  email: string;
  password_hash: string;
  display_name: string;
  birth_date?: string;  // YYYY-MM-DD
}

export interface UpdateUserParams {
  display_name?: string;
  photo_url?: string | null;
  home_lat?: number | null;
  home_lng?: number | null;
}

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    photo_url: row.photo_url,
    home_lat: row.home_lat === null ? null : Number(row.home_lat),
    home_lng: row.home_lng === null ? null : Number(row.home_lng),
    created_at: row.created_at.toISOString(),
    email_verified_at:
      row.email_verified_at === null ? null : row.email_verified_at.toISOString(),
    admin_role: row.admin_role ?? null,
  };
}

export const usersRepository = {
  async findActiveByEmail(db: Executor, email: string): Promise<UserRow | null> {
    const row = await db
      .selectFrom("users")
      .selectAll()
      .where("email", "=", email)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    return row ?? null;
  },

  async findActiveById(db: Executor, id: string): Promise<UserRow | null> {
    const row = await db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", id)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    return row ?? null;
  },

  async insert(db: Executor, params: InsertUserParams): Promise<UserRow> {
    const values: {
      email: string;
      password_hash: string;
      display_name: string;
      birth_date?: string;
    } = {
      email: params.email,
      password_hash: params.password_hash,
      display_name: params.display_name,
    };
    if (params.birth_date !== undefined) values.birth_date = params.birth_date;
    const row = await db
      .insertInto("users")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
    return row;
  },

  async update(db: Executor, id: string, params: UpdateUserParams): Promise<UserRow | null> {
    const patch: Record<string, unknown> = {};
    if (params.display_name !== undefined) patch.display_name = params.display_name;
    if (params.photo_url !== undefined) patch.photo_url = params.photo_url;
    if (params.home_lat !== undefined) patch.home_lat = params.home_lat;
    if (params.home_lng !== undefined) patch.home_lng = params.home_lng;
    if (Object.keys(patch).length === 0) return this.findActiveById(db, id);

    const row = await db
      .updateTable("users")
      .set(patch)
      .where("id", "=", id)
      .where("deleted_at", "is", null)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  },

  toPublic,
  // Re-export sql so tests can construct ad-hoc queries if needed without
  // importing kysely directly through repository boundaries.
  _sql: sql,
};

export type UsersRepository = typeof usersRepository;
