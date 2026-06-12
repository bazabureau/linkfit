export interface Sport {
  id: string;
  slug: string;
  name: string;
  min_players: number;
  max_players: number;
}

export interface Court {
  id: string;
  venue_id: string;
  sport_id: string;
  sport_slug: string;
  name: string;
  hourly_price_minor: number;
  currency: string;
}

export interface Venue {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  is_partner: boolean;
  phone: string | null;
  description: string | null;
  /// Cover photo — kept in sync with `photo_urls[0]` server-side
  /// (DB trigger). Stays for backward-compat with consumers that
  /// haven't migrated to the array.
  photo_url: string | null;
  /// Full gallery of photos for the venue / its courts.
  photo_urls: string[];
  /// Aggregated review summary. `null` rating_avg when no reviews
  /// yet; `rating_count` is always present (defaults to 0).
  rating_avg: number | null;
  rating_count: number;
  distance_km: number | null;
}

export interface VenueDetail extends Venue {
  courts: Court[];
}
