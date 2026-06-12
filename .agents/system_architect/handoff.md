# Handoff Report — System Architect (Sistem Arxitektoru)

## 1. Observation
- I explored `PROJECT.md` showing modular fastify routing architecture under `apps/api/src/modules/` and database types under `apps/api/src/shared/db/types.ts`.
- In `apps/api/src/shared/db/types.ts`, I verified multiple critical entity models including:
  - `UserTable`: `home_lat`, `home_lng`, `time_zone`, `daily_digest_enabled`, `last_seen_at`.
  - `VenueTable`: `lat`, `lng`, `is_partner`, `photo_urls`, `rating_avg`, `rating_count`.
  - `BookingTable`: `starts_at`, `duration_minutes`, `status` (`pending_payment`, `partially_paid`, `paid`, `cancelled`), `idempotency_key`.
  - `PlayerSportStatsTable`: `elo_rating`, `games_played`, `games_won`.
- In `apps/api/src/modules/catalog/catalog.repository.ts` lines 57-71, I observed the `earthdistance` SQL query pattern used for geographic discovery:
  ```sql
  earth_distance(
    ll_to_earth(${lat}::float8, ${lng}::float8),
    ll_to_earth(v.lat::float8, v.lng::float8)
  )::text AS distance_m
  ...
  WHERE earth_box(ll_to_earth(${lat}::float8, ${lng}::float8), ${radiusKm * 1000})
        @> ll_to_earth(v.lat::float8, v.lng::float8)
  ```
- In `apps/api/src/modules/leaderboards/leaderboards.service.ts` lines 147-165, I observed the query used to list the leaderboards:
  ```sql
  FROM player_sport_stats pss
  JOIN users u ON u.id = pss.user_id
  WHERE pss.sport_id = ${sport.id}
    AND pss.games_played >= ${MIN_GAMES_PLAYED}
    AND u.deleted_at IS NULL
  ...
  ORDER BY pss.elo_rating DESC, pss.games_played DESC, pss.user_id ASC
  ```
- In `apps/api/src/modules/bookings/bookings.service.ts` lines 205-219, I observed the booking overlap prevention check:
  ```sql
  SELECT id
    FROM bookings
   WHERE court_id = ${req.court_id}
     AND status::text = ANY(${ACTIVE_STATUSES})
     AND starts_at < ${endsAt}
     AND (starts_at + (duration_minutes * INTERVAL '1 minute')) > ${startsAt}
   FOR UPDATE
  ```

---

## 2. Logic Chain
1. **Monorepo Scalability**: The current Fastify codebase is structured under `apps/api/src/modules` with uniform folder logic (routes, services, schemas). Transitioning to pnpm workspaces and Turborepo will isolate these modules into dedicated internal npm packages (e.g. `@linkfit/db`, `@linkfit/schema`, `@linkfit/auth`) and standalone microservices (`matchmaking-service`, `booking-service`, `messaging-service`) to facilitate scaling and vertical ownership.
2. **API Gateway Edge**: A high-performance gateway (Kong/Nginx) terminating SSL/TLS (supporting TLS 1.3, OCSP, HTTP/2 & HTTP/3) can transparently route requests (`/api/v1/games` -> matchmaking, `/api/v1/bookings` -> bookings, `/api/v1/chat` -> web socket messaging servers) and validate/parse JWT access credentials, injecting user attributes as downstream headers (`X-User-Id`, `X-User-Roles`).
3. **Redis Caching Optimization**: Sports booking systems face high-concurrency read peaks. By caching active match discoveries cell-by-cell (Geo Hash), venue detail profiles, and pre-computing 30-min court availability slot states, database resource usage drops dramatically. Event-driven cache invalidation clears keys immediately upon booking state transitions, maintaining slot accuracy.
4. **PostgreSQL Spatial Indexes**: The earthdistance queries in `searchVenues` perform vector bounding-box calculations (`earth_box @> ll_to_earth()`). To bypass sequential table scans, a functional GiST index on `ll_to_earth(lat::float8, lng::float8)` must be deployed on both the `venues` and `games` tables.
5. **PostgreSQL ELO Rankings Index**: Leaderboard fetching filters inactive players (`games_played >= 3`), sorts by `elo_rating DESC`, and pages the output. Creating a partial composite index `ON player_sport_stats (sport_id, elo_rating DESC, games_played DESC, user_id) WHERE (games_played >= 3)` enables the PG planner to perform direct Index Only scans in $O(\text{limit})$ time.
6. **PostgreSQL Double Booking Prevention**: To replace slow `FOR UPDATE` transaction locks, a native PG GiST exclusion constraint utilizing `tstzrange` (`starts_at` and `duration_minutes`) combined with the `btree_gist` extension prevents concurrent overlapping inserts on the same `court_id` directly at the database layer.

---

## 3. Caveats
- No active Vitest or Playwright QA/E2E test runs were executed locally, adhering strictly to the **ABSOLUTE Local CPU Test Ban** constraint.
- The actual microservice splitting of the monorepo is left as a future transition path (as per the mission's architectural blueprint requirements); no existing application files were split in this turn, enforcing the minimal change principle.
- Nginx upstream hostnames used in config (`matchmaking-service.local`, etc.) are illustrative template upstreams and will need real DNS routing/service-mesh names in staging/production environments.

---

## 4. Conclusion
I successfully created the comprehensive enterprise system architecture blueprint document in `/Users/kamrannamazov/Desktop/linkfit/.agents/orchestrator/SYSTEM_ARCHITECTURE.md`. It outlines detailed specifications for monorepo workspaces, edge API gateways, Redis Sentinel/Cluster HA topologies, cache stampede mitigation code, functional GiST spatial search indexes, partial ELO indexes, and GiST temporal double-booking exclusion constraints matching the exact codebase patterns.

---

## 5. Verification Method
1. **File Existence & Integrity**: Verify the existence of the file `/Users/kamrannamazov/Desktop/linkfit/.agents/orchestrator/SYSTEM_ARCHITECTURE.md`.
2. **Markdown Integrity Check**: The blueprint document is clean markdown using structured tables, ASCII-art diagrams, code snippets, and sequential roadmaps conforming to Baku-level premium standards.
3. **Index Definition Validation**: Developers can run the PostgreSQL index creation syntax in their database console to confirm they compile and index execution scans without errors:
   - `CREATE EXTENSION IF NOT EXISTS btree_gist;`
   - `ALTER TABLE bookings ADD CONSTRAINT exclude_overlapping_court_bookings EXCLUDE USING gist (court_id WITH =, tstzrange(starts_at, starts_at + (duration_minutes * INTERVAL '1 minute'), '[)') WITH &&) WHERE (status IN ('pending_payment', 'partially_paid', 'paid'));`
