import { type DbHandle } from "../../shared/db/pool.js";
import { NotFoundError } from "../../shared/errors/AppError.js";
import { catalogRepository } from "./catalog.repository.js";
import { type Sport, type Venue, type VenueDetail } from "./catalog.types.js";
import { type VenuesListQuery } from "./catalog.schema.js";

export interface CatalogServiceDeps {
  db: DbHandle;
}

export class CatalogService {
  constructor(private readonly deps: CatalogServiceDeps) {}

  async listSports(): Promise<Sport[]> {
    return catalogRepository.listSports(this.deps.db.db);
  }

  async listVenues(query: VenuesListQuery): Promise<Venue[]> {
    const params: Parameters<typeof catalogRepository.searchVenues>[1] = {
      limit: query.limit ?? 50,
    };
    if (query.lat !== undefined) params.lat = query.lat;
    if (query.lng !== undefined) params.lng = query.lng;
    if (query.radius_km !== undefined) params.radiusKm = query.radius_km;
    if (query.sport !== undefined) params.sportSlug = query.sport;
    return catalogRepository.searchVenues(this.deps.db.db, params);
  }

  async getVenue(id: string): Promise<VenueDetail> {
    const venue = await catalogRepository.getVenueById(this.deps.db.db, id);
    if (!venue) throw new NotFoundError("Venue not found");
    return venue;
  }
}
