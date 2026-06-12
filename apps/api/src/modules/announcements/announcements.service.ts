import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import { normalizeLocale, type SupportedLocale } from "../../shared/i18n/locale.js";
import {
  type Announcement,
  type AnnouncementForUser,
  type CreateAnnouncementInput,
} from "./announcements.schema.js";

export interface AnnouncementsServiceDeps {
  db: DbHandle;
}

/**
 * Row shape returned by the active-announcement-for-user query. Mirrors a
 * subset of the announcements columns plus the per-locale trio so the
 * caller can collapse to one (title/body/cta_label) without re-querying.
 */
interface ActiveAnnouncementRow {
  id: string;
  title_az: string;
  title_en: string;
  title_ru: string;
  body_az: string | null;
  body_en: string | null;
  body_ru: string | null;
  cta_label_az: string | null;
  cta_label_en: string | null;
  cta_label_ru: string | null;
  cta_url: string | null;
}

/**
 * The wire-shape `Announcement` returned by admin POST. Includes the full
 * multi-locale trio + the audit-friendly `created_by_user_id`.
 */
type AdminAnnouncementRow = Omit<Announcement, "starts_at" | "ends_at" | "created_at"> & {
  starts_at: Date;
  ends_at: Date | null;
  created_at: Date;
};

/**
 * Announcements agent — admin-curated, time-windowed broadcasts the iOS
 * client renders as a slim dismissible top banner.
 *
 * Two pure responsibilities:
 *
 *   1. `fetchForUser(userId, localeHint)` — return the highest-priority
 *       active announcement matching the caller's locale (or `audience='all'`)
 *       that the caller has NOT dismissed. The service collapses the
 *       multi-locale trio to one string set before returning.
 *
 *   2. `dismiss(userId, announcementId)` — upsert a `(user_id, ann_id)` row
 *       into the dismissal ledger. Idempotent: a second POST is a no-op.
 *
 * Plus one admin write — `create()` — that mints a new broadcast.
 */
export class AnnouncementsService {
  constructor(private readonly deps: AnnouncementsServiceDeps) {}

  /** Direct DB handle for tests / scripts that need to seed rows. */
  get db(): DbHandle {
    return this.deps.db;
  }

  /**
   * Highest-priority active announcement for the given user, in their
   * locale. Returns `null` when no row qualifies.
   *
   * Active = `starts_at <= NOW()` AND (`ends_at` IS NULL OR `ends_at > NOW()`).
   * Audience = `'all'` OR matches the caller's normalised locale.
   * Not dismissed = NOT EXISTS in `user_dismissed_announcements`.
   *
   * Ordering: priority ASC (smaller = higher), starts_at DESC (newer first
   * within the same priority), id ASC (deterministic tiebreaker).
   */
  async fetchForUser(
    userId: string,
    localeHint: string | null | undefined,
  ): Promise<AnnouncementForUser | null> {
    const locale = normalizeLocale(localeHint);

    // Audience matches `'all'` OR the caller's specific locale.
    const row = await sql<ActiveAnnouncementRow>`
      SELECT a.id,
             a.title_az, a.title_en, a.title_ru,
             a.body_az,  a.body_en,  a.body_ru,
             a.cta_label_az, a.cta_label_en, a.cta_label_ru,
             a.cta_url
        FROM announcements a
       WHERE a.starts_at <= NOW()
         AND (a.ends_at IS NULL OR a.ends_at > NOW())
         AND (a.audience = 'all' OR a.audience = ${locale})
         AND NOT EXISTS (
               SELECT 1
                 FROM user_dismissed_announcements d
                WHERE d.user_id = ${userId}
                  AND d.announcement_id = a.id
             )
       ORDER BY a.priority ASC, a.starts_at DESC, a.id ASC
       LIMIT 1
    `.execute(this.deps.db.db);

    const first = row.rows[0];
    if (!first) return null;

    return collapseForLocale(first, locale);
  }

  /**
   * Record that the caller dismissed the announcement. Idempotent —
   * repeated POSTs from a misbehaving client are absorbed by the composite
   * PK's ON CONFLICT DO NOTHING.
   *
   * We do NOT 404 when the announcement id is unknown: the dismissal is a
   * cheap user signal, and a stale id from a client that cached an old
   * payload shouldn't surface as an error. The ON CONFLICT path also
   * tolerates an FK violation by simply doing nothing (the FK fires only
   * when the announcement_id is valid).
   */
  async dismiss(userId: string, announcementId: string): Promise<void> {
    await sql`
      INSERT INTO user_dismissed_announcements (user_id, announcement_id)
      VALUES (${userId}, ${announcementId})
      ON CONFLICT (user_id, announcement_id) DO NOTHING
    `.execute(this.deps.db.db);
  }

  /**
   * Admin write — create a new broadcast.
   *
   * Defaults applied here so the admin client can omit optional fields:
   *  - `starts_at` defaults to NOW() (server clock).
   *  - `audience` defaults to `'all'`.
   *  - `priority` defaults to 100.
   *  - All `body_*` / `cta_label_*` default to `null` when omitted.
   *
   * Returns the freshly-minted row in admin wire shape.
   */
  async create(adminUserId: string, input: CreateAnnouncementInput): Promise<Announcement> {
    return await withTransaction(this.deps.db.db, async (tx) => {
      const inserted = await tx
        .insertInto("announcements")
        .values({
          title_az: input.title_az,
          title_en: input.title_en,
          title_ru: input.title_ru,
          body_az: input.body_az ?? null,
          body_en: input.body_en ?? null,
          body_ru: input.body_ru ?? null,
          cta_label_az: input.cta_label_az ?? null,
          cta_label_en: input.cta_label_en ?? null,
          cta_label_ru: input.cta_label_ru ?? null,
          cta_url: input.cta_url ?? null,
          // When `starts_at` is unset, Postgres applies the column DEFAULT
          // (NOW()). When set, we coerce the wire ISO string to a Date so
          // Kysely sends a timestamptz the planner understands.
          ...(input.starts_at !== undefined
            ? { starts_at: new Date(input.starts_at) }
            : {}),
          ends_at: input.ends_at !== undefined && input.ends_at !== null
            ? new Date(input.ends_at)
            : null,
          audience: input.audience ?? "all",
          priority: input.priority ?? 100,
          created_by_user_id: adminUserId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Audit trail — admin writes are stamped into `audit_log` so the
      // panel's audit view can render "X created announcement Y at Z".
      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminUserId,
          action: "admin.announcements.create",
          entity: "announcement",
          entity_id: inserted.id,
          metadata: {
            audience: inserted.audience,
            priority: inserted.priority,
            starts_at: (inserted.starts_at instanceof Date
              ? inserted.starts_at.toISOString()
              : String(inserted.starts_at)),
          },
        })
        .execute();

      return toAdminWire(inserted);
    });
  }
}

/**
 * Collapse a multi-locale row + a normalised locale into the single string
 * trio the client renders. AZ is the source of truth — when the per-locale
 * title would be empty (shouldn't happen because the schema requires all
 * three) we fall back to AZ. Body + CTA label are optional; we leave them
 * null when the chosen locale's column is null.
 */
function collapseForLocale(
  row: ActiveAnnouncementRow,
  locale: SupportedLocale,
): AnnouncementForUser {
  const titleByLocale = {
    az: row.title_az,
    en: row.title_en,
    ru: row.title_ru,
  } as const;
  const bodyByLocale = {
    az: row.body_az,
    en: row.body_en,
    ru: row.body_ru,
  } as const;
  const ctaLabelByLocale = {
    az: row.cta_label_az,
    en: row.cta_label_en,
    ru: row.cta_label_ru,
  } as const;

  const title = titleByLocale[locale] || row.title_az;
  const body = bodyByLocale[locale] ?? null;
  const ctaLabel = ctaLabelByLocale[locale] ?? null;

  return {
    id: row.id,
    title,
    body: body ?? null,
    cta_label: ctaLabel ?? null,
    cta_url: row.cta_url ?? null,
  };
}

/**
 * Format a DB row into the admin-facing wire shape. Dates are emitted as
 * ISO strings so the JSON response is stable across pg driver versions.
 */
function toAdminWire(row: AdminAnnouncementRow): Announcement {
  return {
    id: row.id,
    title_az: row.title_az,
    title_en: row.title_en,
    title_ru: row.title_ru,
    body_az: row.body_az,
    body_en: row.body_en,
    body_ru: row.body_ru,
    cta_label_az: row.cta_label_az,
    cta_label_en: row.cta_label_en,
    cta_label_ru: row.cta_label_ru,
    cta_url: row.cta_url,
    starts_at: row.starts_at instanceof Date
      ? row.starts_at.toISOString()
      : String(row.starts_at),
    ends_at: row.ends_at instanceof Date
      ? row.ends_at.toISOString()
      : (row.ends_at),
    audience: row.audience,
    priority: row.priority,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
    created_by_user_id: row.created_by_user_id,
  };
}
