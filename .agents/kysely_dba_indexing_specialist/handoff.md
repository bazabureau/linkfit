# Handoff Report — Kysely DBA & Indexing Audit

## 1. Observation

Direct observations and file references compiled during the read-only audit:

1. **Bookings Service Overlap Checking**:
   - In `apps/api/src/modules/bookings/bookings.service.ts` (lines 200–208):
     ```typescript
     const overlap = await sql<{ id: string }>`
       SELECT id
         FROM bookings
        WHERE court_id = ${req.court_id}
          AND status::text = ANY(${ACTIVE_STATUSES})
          AND starts_at < ${endsAt}
          AND (starts_at + (duration_minutes * INTERVAL '1 minute')) > ${startsAt}
        FOR UPDATE
     `.execute(tx);
     ```
   - In `apps/api/src/modules/partner/partner.service.ts` (lines 562–570):
     ```typescript
     const overlap = await sql<{ id: string }>`
       SELECT id
         FROM bookings
        WHERE court_id = ${data.court_id}
          AND status::text = ANY(${["paid", "pending_payment", "partially_paid"]})
          AND starts_at < ${endsAt}
          AND (starts_at + (duration_minutes * INTERVAL '1 minute')) > ${startsAt}
        FOR UPDATE
     `.execute(tx);
     ```

2. **Matchmaking recommendGames Indexing**:
   - In `apps/api/migrations/1700000003000_games.sql` (lines 31–36), current indexes on games:
     ```sql
     CREATE INDEX games_starts_at_idx       ON games (starts_at);
     CREATE INDEX games_sport_status_idx    ON games (sport_id, status, starts_at);
     ```
   - The matchmaking discovery endpoint query in `MatchmakingService.recommendGames` filters on `starts_at > now()`, `status = 'open'`, and `visibility = 'public'` without filtering on `sport_id` for general recommendations.

3. **User Blocks subquery**:
   - In `apps/api/src/modules/matchmaking/matchmaking.service.ts` (lines 94–101):
     ```typescript
     AND NOT EXISTS (
       SELECT 1 FROM user_blocks b
        WHERE (b.blocker_user_id = (SELECT user_id FROM viewer) AND b.blocked_user_id = u.id)
           OR (b.blocker_user_id = u.id AND b.blocked_user_id = (SELECT user_id FROM viewer))
     )
     ```

4. **Database Transaction Helpers**:
   - In `apps/api/src/shared/db/withTransaction.ts` (lines 7–12):
     ```typescript
     export async function withTransaction<T>(
       db: Kysely<Database>,
       fn: (tx: Transaction<Database>) => Promise<T>,
     ): Promise<T> {
       return db.transaction().execute(async (tx) => fn(tx));
     }
     ```
     This executes transactions using PostgreSQL's default `READ COMMITTED` isolation level.

5. **Session/Deactivation Transaction Deadlock**:
   - In `apps/api/src/modules/admin/admin.moderation.service.ts` (lines 603-614) and `apps/api/src/modules/admin/admin.service.ts` (lines 425-439), soft delete/deactivate updates `users` then `refresh_tokens`:
     ```typescript
     await tx.updateTable("users").set({ deleted_at: new Date() }).where("id", "=", userId).execute();
     await tx.updateTable("refresh_tokens").set({ revoked_at: new Date() }).where("user_id", "=", userId)...execute();
     ```
   - In `apps/api/src/modules/users/users.service.ts` (lines 260–280), concurrent `refresh` does:
     ```typescript
     await refreshTokensRepository.insert(tx, { user_id: userId, ... }); // Triggers FK Check (SELECT ... FOR KEY SHARE on users)
     await refreshTokensRepository.revokeOne(tx, row.id, ...); // Triggers row-level lock on refresh_tokens
     ```

6. **Test suite running status**:
   - Running `npx vitest run` in `apps/api` executes all migrations and tests. It fell back to the local database `linkfit_test` and systematically failed due to `deadlock detected` on `admin moderation routes > deactivates a user with a reason and revokes refresh tokens` and `admin routes > soft-delete revokes all refresh tokens for the user`.

---

## 2. Logic Chain

The step-by-step reasoning linking observations to audit findings:

1. **Phantom Reads & Double Bookings**:
   - *Observation 4* shows transactions run under `READ COMMITTED` isolation level.
   - *Observation 1* shows that checking for overlapping bookings uses a `SELECT ... FOR UPDATE` query.
   - By PostgreSQL locking semantics, a `SELECT ... FOR UPDATE` statement only locks *existing* records that match the query predicates. If there is no existing reservation for that time slot, 0 records match the query, resulting in **no locks being acquired**.
   - Concurrent bookings for the same court and slot will therefore execute the overlap query simultaneously, both observe 0 overlaps, proceed to insert their booking, and both successfully commit, causing a **double booking**.
   - To serialize these checks, we must lock a parent row that *does* exist. The parent `court` row (referenced via `court_id` in the booking request) is the perfect anchor. Adding a `SELECT id FROM courts WHERE id = :courtId FOR UPDATE` locks that specific court globally for the transaction, preventing write skew and ensuring safe overlap checking.

2. **Matchmaking Indexing Inefficiency**:
   - *Observation 2* shows the only composite index on game status starts with `sport_id`.
   - General game discovery feeds filter on `starts_at > now()`, `status = 'open'`, and `visibility = 'public'` but omit `sport_id` filters to present cross-sport games.
   - Therefore, the composite index `games_sport_status_idx` cannot be prefixed, forcing Postgres to fall back to the simple `games_starts_at_idx` and execute extensive in-memory filtering.
   - Introducing a partial index: `CREATE INDEX idx_games_active_recommendations ON games (starts_at) WHERE status = 'open' AND visibility = 'public'` narrows the index scope to only active recommendations, enabling $O(\log N)$ seeks.

3. **Subquery Execution Plan Penalty**:
   - *Observation 3* exposes the logical `OR` condition inside `NOT EXISTS` checking blocking status.
   - In PostgreSQL execution planners, `OR` conditions inside correlated subqueries often prevent the planner from selecting multiple independent index scan paths.
   - Splitting this into two independent `NOT EXISTS` queries forces PostgreSQL to utilize `(blocker_user_id, blocked_user_id)` PK and `idx_user_blocks_blocked (blocked_user_id)` directly, producing highly optimized index seeks.

4. **Transaction Deadlock in Deactivation / Session Refresh**:
   - *Observation 5* shows that Deactivation (Transaction A) updates/locks `users` then attempts to update/lock `refresh_tokens`.
   - Simultaneously, Token Refresh (Transaction B) inserts into `refresh_tokens` (locking `refresh_tokens` rows) which triggers a PostgreSQL foreign key check that requests a `FOR KEY SHARE` lock on the parent `users` row.
   - Transaction A locks the `users` row and waits for Transaction B's `refresh_tokens` row lock.
   - Transaction B holds the `refresh_tokens` row lock and waits for Transaction A's `users` row lock, establishing a cyclic deadlock condition.
   - Enforcing consistent lock order by pessimistically locking the parent `users` row (`FOR SHARE` or `FOR UPDATE`) at the very start of Transaction B before touching `refresh_tokens` ensures that they serialize on the `users` row first, completely preventing the deadlock.

---

## 3. Caveats

- **No Live EXPLAIN ANALYZE**: Database analysis was conducted via static query tracing and logical schema audits. Real execution plans will vary depending on production statistics, table cardinality, and Postgres planner choices.
- **Retry Handling**: Raising isolation levels to `SERIALIZABLE` would solve the phantom read issue but introduces serialization failures (`40001`), which require complex application-level retry hooks to prevent throwing raw HTTP 500 errors to users. Thus, pessimistic application locking on parent rows is selected as the primary concurrency remedy.

---

## 4. Conclusion

The database layer is clean, highly structured, and adheres to strict referential integrity. However, it contains two critical transaction/concurrency issues and several major optimization opportunities:
1. **Critical Vulnerability**: High risk of overlapping double-bookings under concurrent loads due to lock-less phantom reads in default `READ COMMITTED` transactions.
2. **Systematic Concurrency Deadlock**: Cyclic deadlock between deactivation and token refresh transactions due to inconsistent lock ordering.
3. **Major Performance Gains**: Inefficient scans in game discovery feeds and blocking validations can be completely resolved with a targeted partial index and query re-structuring in Kysely.

Actionable solutions are detailed in the `kysely_dba_report.md` file.

---

## 5. Verification Method

To independently verify the audit report and recommendations:

1. **Inspect Code Files**:
   - View `/Users/kamrannamazov/Desktop/linkfit/.agents/kysely_dba_indexing_specialist/kysely_dba_report.md` to see detailed recommendations, transaction locking mechanisms, and Kysely diff structures.
2. **Review Concurrency Scenarios**:
   - Trace `apps/api/src/modules/bookings/bookings.service.ts` create method against the database lock semantics described in the logic chain to verify the double-booking write skew vulnerability.
   - Trace the lock cycle between user deactivation (`admin.moderation.service.ts` / `admin.service.ts`) and refresh token rotation (`users.service.ts`) to verify the deadlock mechanism.
3. **Execute Test Suite**:
   - Run `npx vitest run` in `/Users/kamrannamazov/Desktop/linkfit/apps/api` to observe the current deadlock failures, and verify that adding pessimistic locking on the `users` parent row resolves the systematic `deadlock detected` errors.
