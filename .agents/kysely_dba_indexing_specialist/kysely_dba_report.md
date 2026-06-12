# Kysely DBA & Indexing Audit Report

## 1. Executive Summary

This report presents a comprehensive database administration, query optimization, and migration integrity audit for the Linkfit TypeScript API database backend. The database layer utilizes PostgreSQL accessed via the type-safe **Kysely** query builder. 

### Core Findings
1. **Critical Concurrency Vulnerability (Double Bookings)**: Both `BookingsService.create` and `PartnerService.createVenueBooking` perform slot overlap checks using a `SELECT ... FOR UPDATE` query. Under PostgreSQL's default `READ COMMITTED` isolation level, `FOR UPDATE` only locks *existing* rows. If no reservation exists, no lock is acquired, exposing the system to write skew / phantom read race conditions. Concurrent requests for the same slot will both succeed, creating double bookings.
2. **Inefficient Matchmaking Discovery Indexes**: The high-frequency `recommendGames` query filters on open public games in the future. The current composite index starting with `sport_id` is ineffective when `sport_id` is omitted in general recommendations. This leads to broad scans of the `starts_at` index, filtering out non-open/non-public games in memory.
3. **User Block Check Execution Penalty**: Player recommendation logic checks blocking status using a single `NOT EXISTS` query containing a logical `OR`. PostgreSQL often struggles to optimize logical `OR` operators in joins, resulting in execution plan degradation.
4. **Exemplary Migration & Schema Health**: The migration history (58 migration files) demonstrates exceptional discipline. Every file is split into safe `Up` and `Down` migrations, utilizes proper cleanup guards (`DROP TABLE/TYPE IF EXISTS`), and enforces strong domain constraints (e.g., custom ENUMs, ELO boundaries, non-self-referral/non-self-blocking checks).

---

## 2. Detailed Query Performance Analysis

### 2.1. Geolocation & Discovery (`MatchmakingService.recommendGames`)
The query searches for active games near the user using Postgres `earthdistance` (`ll_to_earth` and `earth_box` / `<@`):
```sql
SELECT g.id, g.starts_at, ...
FROM games g
JOIN sports s ON s.id = g.sport_id
JOIN users u ON u.id = g.host_user_id
LEFT JOIN courts c ON c.id = g.court_id
WHERE g.status = 'open'
  AND g.visibility = 'public'
  AND u.deleted_at IS NULL
  AND g.starts_at > now()
  AND g.host_user_id <> :viewerId
  AND NOT EXISTS (
    SELECT 1 FROM game_participants gp 
    WHERE gp.game_id = g.id AND gp.user_id = :viewerId AND gp.status = 'confirmed'
  )
ORDER BY g.starts_at ASC
LIMIT 200;
```
#### Performance Analysis:
- **Current Indexes**:
  - `games_starts_at_idx` ON `games (starts_at)`
  - `games_sport_status_idx` ON `games (sport_id, status, starts_at)`
- **Bottleneck**: Because the query does not filter on `sport_id`, Postgres cannot utilize the composite `games_sport_status_idx` prefix. It falls back to `games_starts_at_idx`, scanning future games and filtering out `status <> 'open'` and `visibility <> 'public'` in-memory. As the game volume scales, this scan becomes increasingly expensive.
- **Optimization Strategy**: Implement a highly targeted partial index on `games` specifically covering active, public game recommendations.
```sql
CREATE INDEX idx_games_active_recommendations 
ON games (starts_at) 
WHERE status = 'open' AND visibility = 'public';
```
This index is incredibly compact (only indexing future/active games that are open and public) and allows an instant range scan on `starts_at > now()`.

---

### 2.2. Player Matchmaking (`MatchmakingService.recommendPlayersForMe`)
This query recommends players in the user's ELO skill bracket:
```sql
SELECT u.id, u.display_name, pss.elo_rating, ...
FROM users u
INNER JOIN player_sport_stats pss ON pss.user_id = u.id AND pss.sport_id = :sportId
WHERE u.deleted_at IS NULL
  AND u.id <> :viewerId
  AND pss.elo_rating BETWEEN :eloFloor AND :eloCeil
  AND NOT EXISTS (
    SELECT 1 FROM user_blocks b
     WHERE (b.blocker_user_id = :viewerId AND b.blocked_user_id = u.id)
        OR (b.blocker_user_id = u.id AND b.blocked_user_id = :viewerId)
  )
ORDER BY u.created_at DESC
LIMIT 50;
```
#### Performance Analysis:
- **Join Path & Indexing**: The join from `users` to `player_sport_stats` is backed by `player_sport_stats_sport_elo_idx` on `(sport_id, elo_rating DESC)`. This is highly efficient as it restricts scans to the selected sport and ELO range, performing a primary-key lookup on `users`.
- **The Block Penalty**: The blocking validation utilizes `OR` inside `NOT EXISTS`:
  `WHERE (blocker = viewer AND blocked = player) OR (blocker = player AND blocked = viewer)`
  Logical `OR` prevents Postgres from utilizing simple index scans on the primary key `(blocker_user_id, blocked_user_id)` and reverse index `idx_user_blocks_blocked (blocked_user_id)` concurrently. It typically forces a bitmap index scan union or a filter scan.
- **Optimization Strategy**: Split this block check into two distinct, highly optimized `NOT EXISTS` statements. Kysely can write this elegantly:
```typescript
.whereNotExists((qb) =>
  qb.selectFrom("user_blocks")
    .select(sql`1`)
    .where("blocker_user_id", "=", viewerId)
    .whereRef("blocked_user_id", "=", "users.id")
)
.whereNotExists((qb) =>
  qb.selectFrom("user_blocks")
    .select(sql`1`)
    .whereRef("blocker_user_id", "=", "users.id")
    .where("blocked_user_id", "=", viewerId)
)
```
This forces Postgres to perform two immediate index seeks (one on the primary key, one on the `blocked_user_id` index), bypassing any expensive execution plan merges.

---

### 2.3. Conversation Listings (`MessagesService.listConversations`)
Queries active conversations, resolving the unread status and the last message:
```sql
SELECT c.id, other.user_id AS other_user_id, ou.display_name AS other_display_name,
       (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_body,
       c.last_message_at, me.last_read_at
FROM conversations c
JOIN conversation_participants me ON me.conversation_id = c.id AND me.user_id = :viewerId
JOIN conversation_participants other ON other.conversation_id = c.id AND other.user_id <> :viewerId
JOIN users ou ON ou.id = other.user_id
WHERE ou.deleted_at IS NULL AND me.left_at IS NULL
ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
LIMIT 100;
```
#### Performance Analysis:
- **Indices Utilized**:
  - `conversation_participants_active_idx` on `(user_id, conversation_id) WHERE left_at IS NULL`. This perfectly filters the viewer's active inboxes.
  - Primary Key `(conversation_id, user_id)` on `conversation_participants` facilitates rapid lookup of the counterpart (`other`).
  - `messages_conversation_idx` on `(conversation_id, created_at DESC)` ensures the subquery resolving the last message executes in $O(1)$ time via a single index seek, without any sorting penalty.
- **Verdict**: The query is exceptionally well-tuned and has no visible performance bottlenecks.

---

## 3. Transaction Integrity & Concurrency Race Conditions

### 3.1. The Phantom Overlap Vulnerability
In `bookings.service.ts`, the overlap check occurs inside a transaction:
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
#### Why it Fails:
Under default `READ COMMITTED` and `REPEATABLE READ` transaction isolation levels, PostgreSQL locks matching **existing** rows during a `SELECT ... FOR UPDATE`. If a court has no booking scheduled for that window yet, the select returns `0` rows.
Therefore, **no locks are acquired**.
If Transaction A and Transaction B concurrently attempt to book the *same* court for the *same* time window:
1. Transaction A selects overlaps `FOR UPDATE` $\rightarrow$ 0 rows found.
2. Transaction B selects overlaps `FOR UPDATE` $\rightarrow$ 0 rows found.
3. Transaction A inserts booking $\rightarrow$ Succeeded.
4. Transaction B inserts booking $\rightarrow$ Succeeded.
5. Both transactions commit. The court is now **double-booked**.

### 3.2. Remediation: Pessimistic Parent-Row Locking
To resolve this without altering global transaction isolation levels or introducing expensive exclusion constraints, lock the parent `courts` row. Every booking must target a specific court. By locking the court row itself, we serialize booking requests for that specific court:
```typescript
// Lock the parent court row to serialize all bookings for this court
await tx
  .selectFrom("courts")
  .select("id")
  .where("id", "=", req.court_id)
  .forUpdate()
  .executeTakeFirstOrThrow();
```
Any concurrent transaction trying to book the same `court_id` will block on this `SELECT FOR UPDATE` until the active booking transaction commits or rolls back, completely eliminating the race condition.

### 3.3. Isolation Level Comparison

| Isolation Level | Overlap Race Condition Prevention | Performance Impact | Operational Complexity |
|---|---|---|---|
| **Read Committed** (Default) | No (Vulnerable to write skew/phantoms) | Low (Default locking) | Low |
| **Read Committed + Court lock** | **Yes** (Pessimistic serialization) | Negligible (Locks only active court) | **Low (Highly Recommended)** |
| **Repeatable Read** | No (Does not prevent insert phantoms) | Medium | Medium (Requires serialization retry handlers) |
| **Serializable** | **Yes** (Optimistic serialization) | High (Increases abort rate) | High (Requires robust query retries on `40001` aborts) |

### 3.4. Session / Deactivation Transaction Deadlock

#### The Problem:
A systematic database deadlock was detected in the test suite under the following concurrent workloads:
- **Transaction A (User Deactivation/Soft Delete)**: Triggered by `AdminModerationService.deactivateUser` or `AdminService.softDeleteUser` within a `withTransaction` block.
- **Transaction B (Concurrent Token Refresh)**: Triggered by a client calling `UsersService.refresh` concurrently within a `withTransaction` block.

#### How the Deadlock occurs:
1. **Transaction A (Deactivation) locks the User**:
   Updates the user's row in the `users` table:
   `UPDATE users SET deleted_at = NOW() WHERE id = :userId`
   This acquires an exclusive write lock on the target `users` row.
2. **Transaction B (Refresh) inserts a new Refresh Token**:
   Invokes `refreshTokensRepository.insert()`. The insertion into `refresh_tokens` triggers a Foreign Key constraint validation.
   To guarantee referential integrity, PostgreSQL implicitly executes a `SELECT ... FOR KEY SHARE` on the referenced row in the `users` table (`user_id`).
   Because the `users` row is already exclusively locked by Transaction A, Transaction B blocks, waiting for Transaction A to release its lock.
3. **Transaction A (Deactivation) revokes active Sessions**:
   Attempts to revoke all active tokens for that user:
   `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = :userId AND revoked_at IS NULL`
   But Transaction B has already locked the active refresh token row (or has pending updates on it). Transaction A blocks, waiting for Transaction B to release its lock.
4. **Deadlock Cycle**:
   - Transaction A holds `users` row write lock, waiting for Transaction B's `refresh_tokens` row lock.
   - Transaction B holds `refresh_tokens` row write lock, waiting for Transaction A's `users` row key share lock.
   - PostgreSQL detects this cycle and aborts one of the transactions with `deadlock detected`.

#### The Remedy:
Enforce a strict, consistent lock ordering across both workflows. Since Transaction A must lock the `users` row first, Transaction B must also acquire a lock on the parent `users` row *before* touching or inserting any rows in `refresh_tokens`. This serializes both transactions on the user lock, preventing the deadlock cycle completely.

---

## 4. Migration Rules & Database Schema Integrity Audit

### 4.1. Constraints and Schema Safety
The Linkfit schema demonstrates strong database-level constraints:
- **Pervasive Check Constraints**:
  - `games`: Lat/Lng boundaries (`lat BETWEEN -90 AND 90`), duration (`BETWEEN 15 AND 480`), capacity (`> 0`), ELO skill ranges (`skill_min_elo <= skill_max_elo`).
  - `referrals`: Preventing self-referral (`referee_user_id <> referrer_user_id`).
  - `user_blocks`: Unilateral block integrity (`blocker_user_id <> blocked_user_id`).
- **Referential Integrity**:
  - Clear cascade rules (`ON DELETE CASCADE` on non-critical metadata, `ON DELETE RESTRICT` on core business data like `sports` or `courts` to prevent accidental deletion of billing trails).

### 4.2. Reversibility and Idempotency
- **Structure**: All 58 migration files have exact `-- Up Migration --` and `-- Down Migration --` segments.
- **ENUM Handling**: Safe enum rollbacks (e.g., dropping custom types in down migrations, dropping tables before types).
- **Idempotency**: Up-migration DDL blocks utilize `IF NOT EXISTS` constructs for extensions and tables where applicable.

---

## 5. Actionable DBA Recommendations

The following concrete proposals can be integrated directly into the next migration or code iteration.

### Recommendation 1: Parent-Row Pessimistic Locking
**File**: `apps/api/src/modules/bookings/bookings.service.ts`  
**Before (Lines 186-211)**:
```typescript
    return withTransaction(this.deps.db.db, async (tx) => {
      // 1. Idempotency replay — return the existing row without touching state.
      const replay = await tx
        .selectFrom("bookings")
        .select("id")
        .where("idempotency_key", "=", req.idempotency_key)
        .executeTakeFirst();
      if (replay) {
        return this.hydrate(tx, replay.id);
      }

      // 2. Overlap check under FOR UPDATE.
      const overlap = await sql<{ id: string }>`
        SELECT id
          FROM bookings
         WHERE court_id = ${req.court_id}
...
```
**Proposed Fix**:
```typescript
    return withTransaction(this.deps.db.db, async (tx) => {
      // 1. Idempotency replay — return the existing row without touching state.
      const replay = await tx
        .selectFrom("bookings")
        .select("id")
        .where("idempotency_key", "=", req.idempotency_key)
        .executeTakeFirst();
      if (replay) {
        return this.hydrate(tx, replay.id);
      }

      // 1b. LOCK the parent court row to serialize overlap checks on this court
      await tx
        .selectFrom("courts")
        .select("id")
        .where("id", "=", req.court_id)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // 2. Overlap check now safely serialized per-court
      const overlap = await sql<{ id: string }>`
        SELECT id
          FROM bookings
         WHERE court_id = ${req.court_id}
...
```
*(Apply the exact same court-locking logic in `PartnerService.createVenueBooking` in `apps/api/src/modules/partner/partner.service.ts` at line 522)*.

---

### Recommendation 2: Split Block Validation subqueries
**File**: `apps/api/src/modules/matchmaking/matchmaking.service.ts`  
**Before (Lines 94-101)**:
```typescript
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
            WHERE (b.blocker_user_id = (SELECT user_id FROM viewer) AND b.blocked_user_id = u.id)
               OR (b.blocker_user_id = u.id AND b.blocked_user_id = (SELECT user_id FROM viewer))
         )
```
**Proposed Fix**:
```typescript
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
            WHERE b.blocker_user_id = (SELECT user_id FROM viewer) 
              AND b.blocked_user_id = u.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
            WHERE b.blocker_user_id = u.id 
              AND b.blocked_user_id = (SELECT user_id FROM viewer)
         )
```
This allows Postgres to resolve each subquery independently, performing rapid index scans on `(blocker_user_id, blocked_user_id)` and `idx_user_blocks_blocked` respectively.

---

### Recommendation 3: Targeted Discovery Partial Index
Create a dedicated migration file to deploy a partial index for the high-frequency public games recommendation feed:
```sql
-- Up Migration --
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_active_recommendations 
ON games (starts_at) 
WHERE status = 'open' AND visibility = 'public';

-- Down Migration --
DROP INDEX CONCURRENTLY IF EXISTS idx_games_active_recommendations;
```
*(Note: `CONCURRENTLY` is highly recommended for production environments to avoid table locking during index creation).*

---

### Recommendation 4: Enforce Consistent Lock Ordering in Token Refresh
**File**: `apps/api/src/modules/users/users.service.ts`  
**Before (Lines 260-264)**:
```typescript
    return withTransaction(this.deps.db.db, async (tx) => {
      // The new row inherits the consumed row's UA when the client didn't
      // resend one (background refresh on iOS won't always carry it).
      const effectiveUa = ctx.user_agent ?? row.user_agent ?? null;
      const session = await this.issueSession(tx, user.id, row.family_id, {
```
**Proposed Fix**:
```typescript
    return withTransaction(this.deps.db.db, async (tx) => {
      // 1. Lock the parent user row first to serialize any concurrent user deactivations
      await tx
        .selectFrom("users")
        .select("id")
        .where("id", "=", user.id)
        .forShare() // Ensures exclusive deactivations block here before holding refresh_token locks
        .executeTakeFirstOrThrow();

      // 2. Proceed with token rotation
      const effectiveUa = ctx.user_agent ?? row.user_agent ?? null;
      const session = await this.issueSession(tx, user.id, row.family_id, {
```
This guarantees consistent lock order: locking the parent row in `users` first, then inserting/updating `refresh_tokens`.
