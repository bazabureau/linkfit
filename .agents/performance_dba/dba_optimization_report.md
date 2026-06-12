# Performance & Database Optimization Report — Linkfit TypeScript Node API

This report provides a comprehensive architectural and performance analysis of the Linkfit TypeScript Node API database design, migrations, and query execution patterns. It identifies key bottlenecks across spatial queries, database design patterns, connection pooling, Fastify memory footprint, and horizontal scaling strategies. For each bottleneck, we present concrete, actionable optimization recommendations.

---

## 1. Executive Summary

Our read-only investigation of the Linkfit API codebase revealed several significant database design and performance bottlenecks that pose risks to scalability and data integrity.

*   **Critical Spatial Deficiencies**: A missing spatial index on `users.home_lat/lng` forces sequential scans during player searches. Furthermore, the matchmaking player suggestion engine suffers from a logical flaw where candidates are limited to the **200 newest sign-ups globally** before geo-proximity or ELO scoring is applied, completely bypassing active local players.
*   **Database Design Anti-Patterns**: The use of UUID arrays (`uuid[]`) for foreign keys (e.g., `tournament_entries.player_ids` and `match_scores.team_a/b_user_ids`) destroys referential integrity, risks orphaned records, and degrades join queries.
*   **High-Frequency Write Lock Contention**: A synchronous database trigger on message inserts updates `conversations.last_message_at`, causing severe row-level locking and blocking concurrent chats in the same room.
*   **Partial Index Invalidation**: The booking overlap query casts enum values (`status::text`), preventing the query planner from using the partial index `bookings_active_window_idx`.
*   **Fastify and Deployment Bottlenecks**: The database connection pool is not configurable via environment variables, rate-limiting is held in-memory (leaking memory and easily bypassed), the SSE bus is node-local, and the `FeedWorker` timer runs on every pod simultaneously in a clustered environment, creating duplicate worker execution and DB transaction races.

---

## 2. Kysely Schema & Database Migrations Bottlenecks

### 2.1. Inefficient Foreign Key Arrays (Anti-Pattern)
*   **Target Files**: `apps/api/migrations/1700000007000_notifications-messages-tournaments.sql`, `apps/api/migrations/1700000018000_match-scores.sql`
*   **Impact**: **High** (Data Integrity & Query Performance)
*   **Details**:
    *   `tournament_entries.player_ids` is stored as a `uuid[]` array.
    *   `match_scores.team_a_user_ids` and `team_b_user_ids` are stored as `uuid[]` arrays.
    *   **Referential Integrity Loss**: Postgres cannot enforce foreign key constraints on array elements. If a user is deleted from the `users` table, their ID remains in these arrays, resulting in orphaned references and application errors when querying user profiles.
    *   **Join Performance Degradation**: Queries that join users against array elements must use expensive operators like `ANY` or `@>`. Standard B-tree indexes cannot be used, requiring slow sequential scans or complex GIN indexes.
*   **Proposed Fix**:
    Replace array fields with standard, normalization-compliant join tables with composite primary keys and proper foreign key cascading:
    ```sql
    CREATE TABLE tournament_entry_players (
      entry_id uuid NOT NULL REFERENCES tournament_entries(id) ON DELETE CASCADE,
      user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (entry_id, user_id)
    );
    CREATE INDEX idx_entry_players_user ON tournament_entry_players (user_id);
    ```

### 2.2. High-Frequency Write Lock Contention on Chats
*   **Target File**: `apps/api/migrations/1700000007000_notifications-messages-tournaments.sql`
*   **Impact**: **High** (Concurrency & Locking)
*   **Details**:
    *   The trigger `messages_bump_conversation` fires `AFTER INSERT` on `messages` to run:
        ```sql
        UPDATE conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
        ```
    *   In high-frequency or group chat scenarios, every message insertion triggers a synchronous write lock on the corresponding row in the `conversations` table. Multiple participants sending messages in the same conversation will block each other, causing request serialization, transaction timeouts, and deadlocks.
*   **Proposed Fix**:
    Remove the trigger and compute `last_message_at` dynamically on the read path using a fast subquery, which naturally leverages the existing composite index `messages_conversation_idx (conversation_id, created_at DESC)`:
    ```typescript
    // In chat listing queries:
    const conversations = await db
      .selectFrom("conversations as c")
      .select([
        "c.id",
        "c.kind",
        "c.title",
        (eb) => eb
          .selectFrom("messages as m")
          .select("m.created_at")
          .whereRef("m.conversation_id", "=", "c.id")
          .orderBy("m.created_at", "desc")
          .limit(1)
          .as("last_message_at")
      ])
    ```
    Alternatively, update `last_message_at` asynchronously via a background queue (e.g., BullMQ or a debounced application-level update) rather than a synchronous DB trigger.

### 2.3. Cast-Induced Partial Index Invalidation on Overlap Checks
*   **Target File**: `apps/api/src/modules/bookings/bookings.service.ts`
*   **Impact**: **Medium** (Query Performance)
*   **Details**:
    *   The index `bookings_active_window_idx` is defined partially:
        ```sql
        CREATE INDEX bookings_active_window_idx ON bookings (court_id, starts_at)
          WHERE status IN ('pending_payment', 'partially_paid', 'paid');
        ```
    *   However, the overlap query in `bookings.service.ts` queries:
        ```sql
        SELECT id FROM bookings WHERE court_id = ${req.court_id}
          AND status::text = ANY(${ACTIVE_STATUSES})
          AND starts_at < ${endsAt}
          AND (starts_at + (duration_minutes * INTERVAL '1 minute')) > ${startsAt}
          FOR UPDATE
        ```
    *   **The Issue**: The expression `status::text` casts the column to text. Postgres' query planner cannot mathematically prove that a cast expression satisfies the index's `WHERE status IN (...)` predicate (which uses the implicit `booking_status` enum type). As a result, the partial index is **ignored**, forcing the database to fall back to a full scan or a less specific index, leading to high transaction lock times.
*   **Proposed Fix**:
    Remove the cast and pass the parameters as a typed enum array:
    ```typescript
    // TypeScript/Kysely adjustment
    const overlap = await sql<{ id: string }>`
      SELECT id
        FROM bookings
       WHERE court_id = ${req.court_id}
         AND status = ANY(${ACTIVE_STATUSES}::booking_status[])
         AND starts_at < ${endsAt}
         AND (starts_at + (duration_minutes * INTERVAL '1 minute')) > ${startsAt}
       FOR UPDATE
    `.execute(tx);
    ```

---

## 3. Geographical (Earthdistance) Query Optimizations

### 3.1. Missing Spatial Index on `users` Table
*   **Target File**: `apps/api/migrations/1700000001000_users-and-refresh-tokens.sql`, `apps/api/src/modules/social/social.service.ts`
*   **Impact**: **High** (Query Performance)
*   **Details**:
    *   `venues` and `games` have functional GiST indexes utilizing `ll_to_earth(lat::float8, lng::float8)`.
    *   The `users` table, which stores coordinates in `home_lat` and `home_lng`, has **no spatial index**.
    *   In the players directory directory search (`social.service.ts` line 204), a search queries:
        ```sql
        AND earth_box(ll_to_earth(${query.lat}::float8, ${query.lng}::float8), ${radius}) @> ll_to_earth(u.home_lat::float8, u.home_lng::float8)
        ```
    *   Without a spatial index, this query must execute a sequential scan of the entire `users` table to calculate the bounding box, completely bottlenecking player directory lookups as the user base grows.
*   **Proposed Fix**:
    Add an expression GiST index on the `users` table. Note that since `home_lat` and `home_lng` are nullable, the index will efficiently ignore NULL coordinates:
    ```sql
    CREATE INDEX IF NOT EXISTS users_earth_idx
      ON users USING gist (ll_to_earth(home_lat::float8, home_lng::float8))
      WHERE home_lat IS NOT NULL AND home_lng IS NOT NULL;
    ```

### 3.2. Critical Candidate Selection Flaw in Matchmaking Engine
*   **Target File**: `apps/api/src/modules/matchmaking/matchmaking.service.ts`
*   **Impact**: **Critical** (Algorithmic / Business Logic)
*   **Details**:
    *   In `recommendPlayers` and `recommendPlayersForMe`, the database query pulls candidates using:
        ```sql
        FROM users u
        ...
        ORDER BY u.created_at DESC
        LIMIT ${MAX_CANDIDATES} -- MAX_CANDIDATES = 200
        ```
    *   After pulling these 200 rows, the scoring engine calculates geofenced distance, ELO closeness, and mutual followers **in TypeScript** for only these 200 users.
    *   **The Issue**: If the system has 10,000 users, only the **200 most recently signed-up users** globally are ever scored. An active player in Baku will only be matched against the newest registrants, even if they live in London or New York! Sibling players who live nearby or share the exact same ELO but registered earlier are entirely ignored because they fell outside the `LIMIT 200` ordered by `created_at DESC`.
*   **Proposed Fix**:
    Rewrite candidate selection to retrieve users within a spatial boundary (e.g. 50km radius) and ELO proximity first, utilizing the database indexes to get the best 200 candidates, then perform fine-grained blended scoring in Node:
    ```sql
    -- Proposed Candidate Query
    SELECT u.id, u.display_name, u.home_lat, u.home_lng, ...
      FROM users u
      LEFT JOIN player_sport_stats pss ON pss.user_id = u.id AND pss.sport_id = ${primarySportId}
     WHERE u.deleted_at IS NULL
       AND u.id <> ${viewerId}
       -- Pre-filter spatially: only fetch candidates within 100km using the new spatial index
       AND (
         u.home_lat IS NULL OR u.home_lng IS NULL OR
         earth_box(ll_to_earth(${viewerLat}::float8, ${viewerLng}::float8), 100000) @> ll_to_earth(u.home_lat::float8, u.home_lng::float8)
       )
       -- Pre-filter skill-wise: within reasonable bounds (e.g. ±400 ELO)
       AND (pss.elo_rating IS NULL OR pss.elo_rating BETWEEN ${eloFloor} AND ${eloCeil})
     ORDER BY pss.games_played DESC, u.created_at DESC
     LIMIT ${MAX_CANDIDATES};
    ```

### 3.3. Non-Index-Friendly OR Condition in Games Search
*   **Target File**: `apps/api/src/modules/games/games.repository.ts` (line 165)
*   **Impact**: **Medium** (Index efficiency)
*   **Details**:
    *   In the games directory search, spatial filtering is coupled with an `OR` condition:
        ```sql
        AND (
          (earth_box(...) @> ll_to_earth(...) AND earth_distance(...) <= radius)
          OR g.host_user_id = ${viewerUserId}
        )
        ```
    *   Using `OR` prevents Postgres from utilizing the spatial GiST index on the game coordinates efficiently.
*   **Proposed Fix**:
    Structure the query with a `UNION ALL` or handle the host's own games separately in code, ensuring that the geofenced query uses a clean `AND` for spatial restrictions to maximize GiST index effectiveness.

---

## 4. Fastify Server & Database Connection Pooling

### 4.1. Unconfigurable Database Connection Pool
*   **Target Files**: `apps/api/src/shared/config/env.ts`, `apps/api/src/shared/db/pool.ts`, `apps/api/src/index.ts`
*   **Impact**: **Medium** (Operational / Scaling)
*   **Details**:
    *   The `pg.Pool` initializes using `deps.maxConnections ?? 10`.
    *   In `env.ts`, there is no `DB_MAX_CONNECTIONS` or similar variable.
    *   In `index.ts`, `createDb` is instantiated without passing `maxConnections`.
    *   **The Issue**: The pool is locked to a default of 10 connections. In a production cluster running multiple container replicas (e.g., Kubernetes pods), operators cannot adjust database connection sizes based on traffic volume or DB server limits without a code change and rebuild.
*   **Proposed Fix**:
    Add `DB_MAX_CONNECTIONS` to the Zod environment configuration in `env.ts` and pass it to the `createDb` caller in `index.ts`:
    ```typescript
    // env.ts
    DB_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10)

    // index.ts
    const db = createDb({
      databaseUrl: env.DATABASE_URL,
      maxConnections: env.DB_MAX_CONNECTIONS,
      logger,
    });
    ```

### 4.2. In-Memory Rate Limiting & SSE Bus
*   **Target Files**: `apps/api/src/shared/http/server.ts`, `apps/api/src/shared/http/server.ts`
*   **Impact**: **High** (Memory Footprint & Horizontal Scaling)
*   **Details**:
    *   **Rate Limiting**: `@fastify/rate-limit` is registered without an external store, defaulting to an in-memory Map cache. In production, this leaks memory over time as thousands of IPs are tracked, and it fails horizontally: a malicious bot can bypass the 300-request rate limit by cycling requests across multiple container replicas.
    *   **Realtime SSE Bus**: `RealtimeBus` (SSE) is instantiated as a local in-process class (`new RealtimeBus()`). An SSE subscription will fail if a user is connected to Pod A but the event (like a new chat message) is processed by Pod B, making real-time features completely unreliable in a multi-pod environment.
*   **Proposed Fix**:
    Configure `@fastify/rate-limit` and the SSE Bus to use Redis in production:
    ```typescript
    // In production, register rate-limit with ioredis
    await app.register(rateLimit, {
      max: deps.env.RATE_LIMIT_MAX,
      timeWindow: deps.env.RATE_LIMIT_WINDOW_SECONDS * 1000,
      store: new RedisStore({ redis: redisClient }), // Redis store
    });
    ```
    For the SSE Bus, utilize Redis Pub/Sub to broadcast events across all API nodes.

### 4.3. Concurrency Competition in the background `FeedWorker`
*   **Target File**: `apps/api/src/modules/feed/feed.worker.ts`
*   **Impact**: **High** (Operational / Race Conditions)
*   **Details**:
    *   The background worker `FeedWorker` is launched automatically on every HTTP server's `onReady` hook:
        ```typescript
        app.addHook("onReady", () => { feedWorker.start(); });
        ```
    *   **The Issue**: If the API is horizontally scaled to 4 replicas (pods) in production, all 4 replicas will execute `FeedWorker.tick()` concurrently every 60 seconds. This creates severe lock contention on `feed_cursor` updates, executes duplicate queries to fetch source tables, and potentially causes duplicate feed events to be emitted.
*   **Proposed Fix**:
    1.  **Distributed Lock**: Use a Redis distributed lock (e.g., Redlock) inside `FeedWorker.tick()` to ensure only one pod executes the processing loop at a time.
    2.  **Separate Replica**: Alternatively, disable the background worker hook on normal HTTP pods (via a feature flag `RUN_BACKGROUND_WORKER=false`) and run a single dedicated replica pod specifically configured to execute the background crons and worker sweeps.

---

## 5. Summary Action Plan

| ID | Issue Description | Target Area | Priority | Recommended Action |
|---|---|---|---|---|
| **1** | Missing user spatial index | Database / Schema | **High** | Add functional GiST index `users_earth_idx` to migrations. |
| **2** | Matchmaking candidates logical flaw | Application / SQL | **Critical** | Pre-filter candidates by spatial bounding box (`earth_box`) in Kysely/SQL. |
| **3** | UUID array foreign keys | Database / Schema | **High** | Normalize arrays (`player_ids`) into join tables with composite PKs. |
| **4** | Chat update trigger contention | Database / Triggers | **High** | Remove `messages_bump_conversation` and resolve `last_message_at` dynamically. |
| **5** | Overlap check index invalidation | Application / SQL | **Medium** | Remove `status::text` cast; query with typed enum array parameters. |
| **6** | Connection pool unconfigurable | Operational / Env | **Medium** | Add `DB_MAX_CONNECTIONS` to environment variables and pass it to pg.Pool. |
| **7** | In-memory rate limiting & SSE bus | Operational / Cache | **High** | Integrate Redis for rate-limiting store and SSE Pub/Sub. |
| **8** | Multi-pod background worker collision | Operational / Scaling | **High** | Implement Redis-based distributed locking or a dedicated worker pod. |

---

## 6. Verification and Testing Procedures

To verify these performance improvements independently:

1.  **Explain Analyzer (Index verification)**:
    Execute `EXPLAIN (ANALYZE, BUFFERS)` on the geofenced queries before and after the additions:
    *   Verify that `users_earth_idx` is scanned via `Index Scan` or `Bitmap Index Scan` instead of a `Seq Scan`.
    *   Verify that the overlap check `bookings_active_window_idx` is hit when creating a booking, proving that casting issues have been resolved.
2.  **Lock Contention Testing (pg_locks)**:
    Under load, query `pg_locks` and `pg_stat_activity` to ensure that message insertions no longer block concurrently executing chat transactions.
3.  **Horizontal Scale Simulation**:
    Spin up two instances of the API server locally:
    *   Verify that without a distributed lock, the console logs show both instances racing to update `feed_cursor` every minute.
    *   Verify that applying our Redis distributed locking solution restricts execution to exactly one node.
