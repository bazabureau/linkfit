import { sql } from "kysely";
import { type Executor } from "../../shared/db/withTransaction.js";
import { type Court, type Sport, type Venue, type VenueDetail } from "./catalog.types.js";

export interface VenueSearchParams {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  sportSlug?: string;
  limit: number;
}

export const catalogRepository = {
  async listSports(db: Executor): Promise<Sport[]> {
    // Padel is the flagship sport for the Azerbaijan market, so it always
    // renders first; everything else falls back to slug-asc for a stable
    // ordering. iOS uses the leading entry as the default-selected chip,
    // so any reshuffle here has UX consequences — keep padel pinned.
    const rows = await db
      .selectFrom("sports")
      .selectAll()
      .orderBy(sql`CASE WHEN slug = 'padel' THEN 0 ELSE 1 END`)
      .orderBy("slug")
      .execute();
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      min_players: r.min_players,
      max_players: r.max_players,
    }));
  },

  async searchVenues(db: Executor, params: VenueSearchParams): Promise<Venue[]> {
    const { lat, lng, radiusKm, sportSlug, limit } = params;
    const hasGeo = lat !== undefined && lng !== undefined && radiusKm !== undefined;

    // We assemble a single SQL string so the optional earthdistance filter
    // composes cleanly without the Kysely builder ergonomics fighting numeric
    // casts and gist operators.
    if (hasGeo) {
      const result = await sql<{
        id: string;
        name: string;
        address: string;
        lat: string;
        lng: string;
        is_partner: boolean;
        phone: string | null;
        description: string | null;
        photo_url: string | null;
        photo_urls: string[];
        rating_avg: string | null;
        rating_count: number;
        distance_m: string;
      }>`
        SELECT v.id, v.name, v.address, v.lat, v.lng, v.is_partner,
               v.phone, v.description, v.photo_url, v.photo_urls,
               v.rating_avg, v.rating_count,
               earth_distance(
                 ll_to_earth(${lat}::float8, ${lng}::float8),
                 ll_to_earth(v.lat::float8, v.lng::float8)
               )::text AS distance_m
          FROM venues v
         WHERE earth_box(ll_to_earth(${lat}::float8, ${lng}::float8), ${radiusKm * 1000})
               @> ll_to_earth(v.lat::float8, v.lng::float8)
           AND earth_distance(
                 ll_to_earth(${lat}::float8, ${lng}::float8),
                 ll_to_earth(v.lat::float8, v.lng::float8)
               ) <= ${radiusKm * 1000}
           ${
             sportSlug !== undefined
               ? sql`AND EXISTS (
                       SELECT 1 FROM courts c JOIN sports s ON s.id = c.sport_id
                        WHERE c.venue_id = v.id AND s.slug = ${sportSlug}
                     )`
               : sql``
           }
         ORDER BY distance_m ASC
         LIMIT ${limit}
      `.execute(db);

      return result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        lat: Number(r.lat),
        lng: Number(r.lng),
        is_partner: r.is_partner,
        phone: r.phone,
        description: r.description,
        photo_url: r.photo_url,
        photo_urls: r.photo_urls,
        rating_avg: r.rating_avg !== null ? Number(r.rating_avg) : null,
        rating_count: r.rating_count,
        distance_km: Math.round(Number(r.distance_m) / 10) / 100, // 2dp km
      }));
    }

    const result = await sql<{
      id: string;
      name: string;
      address: string;
      lat: string;
      lng: string;
      is_partner: boolean;
      phone: string | null;
      description: string | null;
      photo_url: string | null;
      photo_urls: string[];
      rating_avg: string | null;
      rating_count: number;
    }>`
      SELECT v.id, v.name, v.address, v.lat, v.lng, v.is_partner,
             v.phone, v.description, v.photo_url, v.photo_urls,
             v.rating_avg, v.rating_count
        FROM venues v
       ${
         sportSlug !== undefined
           ? sql`WHERE EXISTS (
                   SELECT 1 FROM courts c JOIN sports s ON s.id = c.sport_id
                    WHERE c.venue_id = v.id AND s.slug = ${sportSlug}
                 )`
           : sql``
       }
       ORDER BY v.name ASC
       LIMIT ${limit}
    `.execute(db);

    return result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      lat: Number(r.lat),
      lng: Number(r.lng),
      is_partner: r.is_partner,
      phone: r.phone,
      description: r.description,
      photo_url: r.photo_url,
      photo_urls: r.photo_urls,
      rating_avg: r.rating_avg !== null ? Number(r.rating_avg) : null,
      rating_count: r.rating_count,
      distance_km: null,
    }));
  },

  async getVenueById(db: Executor, id: string): Promise<VenueDetail | null> {
    const venueRow = await db
      .selectFrom("venues")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!venueRow) return null;

    const courtRows = await db
      .selectFrom("courts")
      .innerJoin("sports", "sports.id", "courts.sport_id")
      .select([
        "courts.id as id",
        "courts.venue_id as venue_id",
        "courts.sport_id as sport_id",
        "sports.slug as sport_slug",
        "courts.name as name",
        "courts.hourly_price_minor as hourly_price_minor",
        "courts.currency as currency",
      ])
      .where("courts.venue_id", "=", id)
      .orderBy("courts.name")
      .execute();

    const courts: Court[] = courtRows.map((r) => ({
      id: r.id,
      venue_id: r.venue_id,
      sport_id: r.sport_id,
      sport_slug: r.sport_slug,
      name: r.name,
      hourly_price_minor: r.hourly_price_minor,
      currency: r.currency,
    }));

    return {
      id: venueRow.id,
      name: venueRow.name,
      address: venueRow.address,
      lat: Number(venueRow.lat),
      lng: Number(venueRow.lng),
      is_partner: venueRow.is_partner,
      phone: venueRow.phone,
      description: venueRow.description,
      photo_url: venueRow.photo_url,
      photo_urls: (venueRow as { photo_urls?: string[] }).photo_urls ?? [],
      rating_avg: (venueRow as { rating_avg?: string | null }).rating_avg !== null
        && (venueRow as { rating_avg?: string | null }).rating_avg !== undefined
        ? Number((venueRow as { rating_avg?: string }).rating_avg)
        : null,
      rating_count: (venueRow as { rating_count?: number }).rating_count ?? 0,
      distance_km: null,
      courts,
    };
  },
};
