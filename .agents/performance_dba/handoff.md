# Handoff Report — Database & Performance Analysis

This report is self-contained and summarizes our read-only investigation, evidence chain, conclusions, and recommended verification steps for optimization of the Linkfit TypeScript Node API database and query layers.

---

## 1. Observation

During our systematic code review, we examined the codebase, configuration, and migrations using `view_file` and `grep_search`. We directly observed the following:

1.  **Missing Spatial Index**:
    *   **Source**: `/Users/kamrannamazov/Desktop/linkfit/apps/api/src/modules/social/social.service.ts` line 204:
        ```sql
        ${
          hasGeo
            ? sql`AND u.home_lat IS NOT NULL AND u.home_lng IS NOT NULL
                  AND earth_box(
                        ll_to_earth(${query.lat}::float8, ${query.lng}::float8),
                        ${(query.radius_km ?? 0) * 1000}
                      ) @> ll_to_earth(u.home_lat::float8, u.home_lng::float8)`
            : sql``
        }
        ```
    *   No GiST index exists on the `users` table coordinates in any migration file.

2.  **Matchmaking Algorithmic Flaw**:
    *   **Source**: `/Users/kamrannamazov/Desktop/linkfit/apps/api/src/modules/matchmaking/matchmaking.service.ts` line 292 (and line 419):
        ```sql
        FROM users u
       WHERE u.deleted_at IS NULL
         AND u.id <> (SELECT user_id FROM viewer)
         ...
       ORDER BY u.created_at DESC
       LIMIT ${MAX_CANDIDATES} -- (MAX_CANDIDATES is 200)
        ```
    *   Scoring is performed in TypeScript on only this sliced result subset, locking recommendations to the 200 newest sign-ups globally.

3.  **UUID Array Foreign Key Anti-Pattern**:
    *   **Source**: `/Users/kamrannamazov/Desktop/linkfit/apps/api/migrations/1700000007000_notifications-messages-tournaments.sql` line 134:
        ```sql
        player_ids      uuid[]      NOT NULL DEFAULT '{}',
        ```
    *   **Source**: `/Users/kamrannamazov/Desktop/linkfit/apps/api/migrations/1700000018000_match-scores.sql` lines 20-21:
        ```sql
        team_a_user_ids   uuid[]             NOT NULL,
        team_b_user_ids   uuid[]             NOT NULL,
        ```

4.  **High-Frequency Write Lock Contention on Chats**:
    *   **Source**: `/Users/kamrannamazov/Desktop/linkfit/apps/api/migrations/1700000007000_notifications-messages-tournaments.sql` line 80:
        ```sql
        CREATE TRIGGER messages_bump_conversation
          AFTER INSERT ON messages
          FOR EACH ROW EXECUTE FUNCTION bump_conversation_last_message_at();
        ```

5.  **Cast-Induced Overlap Partial Index Invalidation**:
    *   **Source**: `/Users/kamrannamazov/Desktop/linkfit/apps/api/src/modules/bookings/bookings.service.ts` line 200:
        ```sql
        const overlap = await sql<{ id: string }>`
          SELECT id
            FROM bookings
           WHERE court_id = ${req.court_id}
             AND status::text = ANY(${ACTIVE_STATUSES})
             AND starts_at < ${endsAt}
             AND (starts_at + (duration_minutes * INTERVAL '1 minute')) > ${startsAt}
           FOR UPDATE
        ```

6.  **Fastify & Connection Pooling Constraints**:
    *   **Source**: `apps/api/src/shared/db/pool.ts` uses `max: deps.maxConnections ?? 10` but `index.ts` never passes `maxConnections` from `env`.
    *   **Source**: `@fastify/rate-limit` is registered in `server.ts` without a custom Redis store, leading to in-memory accumulation.
    *   **Source**: `RealtimeBus` uses local Node SSE pub/sub mapping, which does not synchronize across clustered server nodes.
    *   **Source**: `FeedWorker` timer is started unconditionally on Fastify's `onReady` hook, causing competing background loops on every scaling instance in horizontal deployments.

---

## 2. Logic Chain

1.  **Spatial Scanning**: The players directory (`SocialService.players()`) filters users using `earth_box(...) @> ll_to_earth(u.home_lat, u.home_lng)`. In the absence of a GiST functional index on `ll_to_earth(...)` for the `users` table, Postgres must scan the entire `users` table sequentially. Therefore, search speeds will degrade linearly with user growth.
2.  **Matchmaking Failure**: `MatchmakingService.recommendPlayers()` fetches `LIMIT 200` ordered by `created_at DESC` first, and then calculates spatial distance/proximity score in TypeScript. As the user base expands beyond 200, users will only be matched against the most recently signed-up users globally, completely excluding older local active players. Thus, spatial recommendations fail logically at scale.
3.  **Integrity and Join Losses**: Storing relational IDs in arrays (`uuid[]`) prevents Postgres from validating foreign keys (referential integrity) and standard B-tree index queries. Any deletion in the `users` table will orphan elements in the array. Join queries using `ANY` or `@>` will fail to utilize index scans.
4.  **Synchronous Write Locking**: The `messages_bump_conversation` trigger locks and updates the parent conversation row in `conversations` synchronously for every message inserted in `messages`. When multiple users chat in the same room simultaneously, their database transactions compete for the same row-level write lock, resulting in serialized execution, performance lag, and deadlock potential.
5.  **Partial Index Bypass**: The overlap query casts the `status` enum to text (`status::text`). Postgres ignores the partial index `bookings_active_window_idx` because the index is defined on `status IN ('pending_payment', 'partially_paid', 'paid')` (enum types), and a text-casted query parameter does not explicitly match the index predicate. This leads to sequential table filtering on overlapping checks during booking.
6.  **Operational scaling failure**: Fastify's in-memory rate-limiter, single-instance SSE bus, locked database connection pools, and racing multi-pod `FeedWorker` instances create high memory footprint profiles and prevent the API backend from scaling horizontally.

---

## 3. Caveats

*   **Network Constraint**: We performed a read-only investigation under `CODE_ONLY` network mode. We could not run live explain-analyses or benchmark query loads against a populated Postgres instance.
*   **Application-Layer Limitations**: We assumed the primary database is standard PostgreSQL with `earthdistance` extension activated. If the database engine changes or standard extensions are restricted by the hosting provider, spatial expressions may need to be mapped to PostGIS coordinates.

---

## 4. Conclusion

The Linkfit Node API backend has critical database design defects that will cause matchmaking failures, slow search directories, write lock timeouts, and scale bottlenecks under load.
*   **Actionable Fixes**:
    1.  Add `users_earth_idx` functional GiST index and rewrite `MatchmakingService` queries to pre-filter users spatially via `earth_box` inside Postgres rather than slicing on `created_at DESC LIMIT 200` in TypeScript.
    2.  Normalize array columns into join tables (`tournament_entry_players`).
    3.  Compute `last_message_at` dynamically from `messages` or update asynchronously instead of triggering on every insert.
    4.  Correct Kysely cast expressions (`status::text`) to enable partial index scans.
    5.  Externalize state (rate-limiting, SSE real-time bus, distributed lock for background worker) into Redis.

---

## 5. Verification Method

1.  **Unit & Integration Tests**:
    *   Navigate to the API folder and run `npm run test` or `vitest` to verify that existing test suites pass.
    *   Execute `npm run lint` and `npm run typecheck` to verify code type compliance.
2.  **Explain Plan Verification**:
    *   Run `EXPLAIN (ANALYZE)` in Postgres on the user coordinate search to confirm it uses a `Gist Scan` on `users_earth_idx` rather than `Seq Scan`.
    *   Run `EXPLAIN` on the booking overlap query to confirm it leverages the partial index `bookings_active_window_idx` once the cast `status::text` is removed.
3.  **Load Test Locking Verification**:
    *   Simulate concurrent chat writes in a single conversation and query `SELECT * FROM pg_locks WHERE NOT granted;` to verify lock contention has been eliminated.
