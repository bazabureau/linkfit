# Webhook, Jobs & Recovery Audit Report

**Executive Summary**: This comprehensive audit of the `/apps/api` service reveals critical architectural bottlenecks in background worker scaling, a silent disk-leak bug in expired weekly recap stories, socket-level session hanging risks in the custom APNs sender, a parallel-webhook race condition in Stripe processing, and a fundamental mismatch between the database schema and service logic regarding Stripe split-payments.

---

## 1. Background Workers & Sweepers Audit

The application currently runs eight background jobs and sweepers directly inside the HTTP server process using standard Node.js `setInterval` or `setTimeout` timers (triggered via Fastify's `onReady` hooks):
1. **`FeedWorker`** (`feed.worker.ts`): Fan-out feed events, runs every 60 seconds.
2. **`StoriesExpireSweeper`** (`stories-expire.sweeper.ts`): Deletes expired stories, runs every 30 minutes.
3. **`DigestScheduler`** (`digest.scheduler.ts`): Weekly digest email scheduler.
4. **`WeeklyRecapSweeper`** (`weekly-recap.sweeper.ts`): Generates and posts Sunday 19:00 local recaps, runs every 30 minutes.
5. **`DataRightsSweeper`** (`data-rights.sweeper.ts`): GDPR data export purger and user hard-deleter, runs every 5 minutes.
6. **`GamesCompletionSweeper`** (`games-completion.sweeper.ts`): Completes ended games and flags no-shows, runs every 15 minutes.
7. **`GamesReminderSweeper`** (`games-reminder.sweeper.ts`): Pre-game reminder nudges, runs every 5 minutes.
8. **`DailyDigestSweeper`** (`daily-digest.sweeper.ts`): Curved local daily retention push, runs hourly.

### ⚠️ Critical Findings

#### A. In-Process Multi-Pod Redundant Executions & Lock Contention
Because these sweepers are registered as in-process `setInterval` hooks on the Fastify instance, **every horizontal pod/instance in a clustered deployment runs its own independent timers concurrently**.
* **Implication**: If three API pods run in parallel, all three will query the database at the same time for due games, daily digests, and weekly recaps. While unique constraints (such as those in `daily_digest_sent`, `game_reminders_sent`, and `stripe_webhook_events`) prevent duplicate side-effects (e.g., duplicate pushes or database double-writes), this architecture causes **wasted CPU cycles, redundant filesystem writes, and high database lock contention** during overlapping sweeps.

#### B. Scaling & Performance Bug in `GamesCompletionSweeper`
In `games-completion.sweeper.ts`, the sweeper pulls completed games to check for no-shows using the following query:
```typescript
const due = await this.deps.db.db
  .selectFrom("games")
  .select(["id", "sport_id"])
  .where("status", "=", "completed")
  .where(sql<boolean>`(starts_at + (duration_minutes || ' minutes')::interval) < ${cutoff}`)
  .limit(200)
  .execute();
```
* **The Bug**: Once a game is completed, it stays completed forever. Thus, `starts_at + duration_minutes` will *always* be older than the grace window cutoff. Since there is no sorting (`orderBy`) and no cursor/bookmarking, **this query fetches the exact same 200 historically completed games every 15 minutes**.
* **Implication**: The sweeper will run no-op transactions for the same 200 games forever. If the system has more than 200 completed games, newer completed games will *never* have their absentees flagged as no-shows, and players' reliability scores will fail to decay. This completely halts no-show enforcement at scale while flooding the database with useless lock scans.

#### C. Expired Story PNG Storage Leak in `WeeklyRecapSweeper` & `StoriesExpireSweeper`
In `weekly-recap.sweeper.ts`, the sweeper aggregates the weekly recap stats, renders a PNG, and writes it to disk:
```typescript
const recapDir = join(this.deps.uploadDir, "recap");
await mkdir(recapDir, { recursive: true });
const filename = `${randomUUID()}.png`;
const filepath = join(recapDir, filename);
await writeFile(filepath, png);
```
It then posts a system story with a `media_url` pointing to `/uploads/recap/<uuid>.png`.
However, in `stories-expire.sweeper.ts`, the expiry job attempts to delete expired media using a hard-coded subdirectory path:
```typescript
const filename = row.media_url.split("/").pop();
if (filename !== undefined && filename.length > 0) {
  const filepath = join(this.deps.uploadDir, "stories", filename);
  try {
    unlinkSync(filepath);
  } catch {
    // Swallowed...
  }
}
```
* **The Bug**: The expiry sweeper looks for recap PNGs under `uploadDir/stories/` instead of `uploadDir/recap/`. The file deletion fails silently, and the expired recap PNGs **remain stranded on the server's disk forever**.
* **Implication**: This causes a silent, infinite storage leak. Over time, as more users receive weekly recaps, the disk will fill up.
* **Secondary Racing Bug**: When multiple pods run `WeeklyRecapSweeper` concurrently, they all generate and write separate PNGs (with distinct random UUIDs) to `uploadDir/recap/`. Only one pod succeeds in inserting the story row due to caption-level deduplication. The other pods abort, leaving their rendered PNG files **abandoned and untracked on disk** instantly.

---

## 2. APNs Push Notification Queues Audit

The push notification service is implemented in `push.sender.ts` using Node's native `node:http2` and a custom JWT signer using ES256, bypassing heavy external dependencies.

### ⚠️ Reliability and Timing Consistency Findings

#### A. Session Hanging Risks on Socket Failure
In `push.sender.ts`, the `ApnsSender` manages a single persistent HTTP/2 connection:
```typescript
private ensureSession(): ClientHttp2Session {
  if (this.session && !this.session.destroyed && !this.session.closed) {
    return this.session;
  }
  const session = connect(this.host);
  session.on("error", (err: Error) => {
    this.logger.warn({ err: err.message }, "apns.session.error");
  });
  // ...
  this.session = session;
  return session;
}
```
* **The Issue**: If the underlying socket encounters a TCP write error or is terminated by APNs (e.g., due to idle timeout), the session is marked in an error state but **is not explicitly destroyed** by the error handler. The socket may enter a half-open state where Fastify/Node believes the socket is active, but subsequent requests will hang or time out.
* **Request Timeout Limit**: The request has a `req.setTimeout(10_000, ...)` which calls `req.close()` but **does not destroy the parent session**. Once a session becomes dead or enters a half-open state, every single subsequent push request will fail with a 10-second timeout, completely breaking push notifications until the server process is restarted.

#### B. Correct Handling of Device Token Revocation
On the positive side, the push service correctly soft-deletes/revokes expired tokens when the APNs gateway returns a `410 Gone` status, or specific bad token reason codes (`BadDeviceToken`, `Unregistered`, `DeviceTokenNotForTopic`). The registry sets `revoked_at = NOW()` immediately, preventing redundant retry traffic on future broadcasts.

---

## 3. Stripe Payments & Webhooks Audit

The system handles court bookings and tournament entry fees via Stripe PaymentSheets, managed through `payments.service.ts` and the webhook router in `stripe-webhook.routes.ts`.

### ⚠️ Idempotency & Split-Payment Architectural Findings

#### A. Stripe Webhook Process-Before-Deduplicate Race Condition
In `payments.service.ts`, the webhook event handler deduplicates incoming Stripe calls by looking up the event ID in `stripe_webhook_events`:
```typescript
async handleWebhookEvent(event: Stripe.Event): Promise<{ handled: boolean }> {
  const replay = await this.deps.db.db
    .selectFrom("stripe_webhook_events")
    .select("id")
    .where("id", "=", event.id)
    .executeTakeFirst();
  if (replay) {
    this.deps.logger.debug({ event_id: event.id }, "stripe: duplicate webhook event ignored");
    return { handled: false };
  }

  // ... side effects (onPaymentSucceeded / onPaymentFailed) executed here ...

  try {
    await this.deps.db.db
      .insertInto("stripe_webhook_events")
      .values({ id: event.id, type: event.type })
      .execute();
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== "23505") throw err;
  }
}
```
* **The Bug**: The database record of the processed webhook is written **at the very end of the function, outside of any transaction**. If Stripe retries a webhook concurrently (e.g., due to a network delay or timeout) or if the webhook triggers in parallel, both requests will run the `selectFrom` check, find nothing, and execute the side-effects concurrently (e.g., double-charging or dual-finalizing). Only one will successfully insert the row at the end (the other will swallow the `23505` unique violation).
* **Implication**: High risk of duplicate fulfillment, race conditions in tournament entry creation, and database record corruption.

#### B. The Split-Payment Security and Functional Mismatch
The database schema (`payment_splits` table, `BookingStatus` of `"partially_paid"`, `BookingTable` columns) is designed for a robust multi-user split-payment model. However, the service logic in `BookingsService.markPaid` contains a single-payer shortcut that completely breaks this model:
```typescript
async markPaid(id: string, userId: string): Promise<BookingDetail> {
  return withTransaction(this.deps.db.db, async (tx) => {
    const lock = await sql<{ id: string; user_id: string; status: BookingStatus }>`
      SELECT id, user_id, status FROM bookings WHERE id = ${id} FOR UPDATE
    `.execute(tx);
    const row = lock.rows[0];
    // ...
    if (row.user_id !== userId) {
      throw new ForbiddenError("You do not have access to this booking");
    }
    // ...
    await tx
      .updateTable("bookings")
      .set({ status: "paid", paid_at: new Date() })
      .where("id", "=", id)
      .execute();
    await tx
      .updateTable("payment_splits")
      .set({ status: "captured", paid_at: new Date() })
      .where("booking_id", "=", id)
      .execute();
    // ...
  });
}
```
1. **ForbiddenError Block**: The method explicitly throws a `ForbiddenError` if the paying user ID does not match `booking.user_id` (the owner/booker).
   * **Implication**: If any participant of a split payment tries to pay their split via Stripe, the Stripe webhook will extract their `user_id` from the PaymentIntent metadata, invoke `markPaid()`, and immediately fail with a `403 ForbiddenError`!
2. **Instant Full Capturing**: When the booking owner pays their share, the method flips the booking status directly to `"paid"` and marks *all* splits in the table as `"captured"`, even if other splits are unpaid.
   * **Implication**: This completely bypasses split-payment tracking, allowing a court to be marked fully paid and booked even if only 25% of the split has been collected.

---

## 4. Resilient Actionable Recovery Recommendations

### 🔧 Recommendation 1: Repair the `GamesCompletionSweeper` SQL Query
To prevent the sweeper from scanning the entire historical database of completed games every 15 minutes, filter the query using an `EXISTS` check on `game_participants` that still have a status of `'confirmed'`.
```typescript
const due = await this.deps.db.db
  .selectFrom("games as g")
  .select(["g.id", "g.sport_id"])
  .where("g.status", "=", "completed")
  .where(sql<boolean>`(g.starts_at + (g.duration_minutes || ' minutes')::interval) < ${cutoff}`)
  .where(({ exists, selectFrom }) =>
    exists(
      selectFrom("game_participants as gp")
        .select("gp.user_id")
        .whereRef("gp.game_id", "=", "g.id")
        .where("gp.status", "=", "confirmed")
    )
  )
  .limit(200)
  .execute();
```
* **Impact**: Once all participants are correctly marked `no_show` (or updated to `played`/`cancelled`), the game automatically drops out of the candidate set, keeping sweep operations extremely fast and highly scalable.

### 🔧 Recommendation 2: Align Expiry Sweeper Directories
Modify the directory logic in `StoriesExpireSweeper` to check both the `stories` and `recap` directories during the unlink phase based on the folder path parsed from `media_url`.
```typescript
const urlParts = row.media_url.split("/");
const filename = urlParts.pop();
const folder = urlParts.pop(); // Either 'stories' or 'recap'
if (filename && folder && (folder === "stories" || folder === "recap")) {
  const filepath = join(this.deps.uploadDir, folder, filename);
  try {
    unlinkSync(filepath);
  } catch {
    // Swallowed...
  }
}
```
* **Impact**: Durably unlinks and deletes expired weekly recap PNGs, resolving the silent storage leakage bug.

### 🔧 Recommendation 3: Implement Distributed Locks for Sweepers
To support clustering and multi-pod scaling, we should implement distributed locking. In a Redis-backed setup, a tool like Redlock is ideal. In the current postgres-only architecture, we can leverage **Postgres Advisory Locks** (`pg_try_advisory_xact_lock`) at the start of each sweeper tick.
```typescript
// Example: Acquire session-level lock for games completion sweeper (arbitrary key ID)
const lockAcquired = await sql<{ locked: boolean }>`
  SELECT pg_try_advisory_lock(170001) as locked
`.execute(this.deps.db.db);

if (!lockAcquired.rows[0]?.locked) {
  // Another pod is already executing this sweep; skip this tick.
  return;
}
```
* **Impact**: Guarantees that at most one pod is executing a specific sweeper tick at any time, eliminating dual-pod races, CPU/DB waste, and redundant PNG file writes.

### 🔧 Recommendation 4: Harden the APNs Session Recovery Boundary
Improve session resilience in `ApnsSender` by explicitly destroying the HTTP/2 session and setting it to `null` if any session error or request timeout is encountered.
```typescript
// Inside session request callbacks:
req.setTimeout(10_000, () => {
  req.close();
  if (this.session) {
    this.session.destroy();
    this.session = null;
  }
  resolve({ kind: "failed", token: target.token, reason: "timeout" });
});

// Inside ensuresession:
session.on("error", (err: Error) => {
  this.logger.warn({ err: err.message }, "apns.session.error");
  session.destroy();
  if (this.session === session) this.session = null;
});
```
* **Impact**: Ensures that dead or half-open APNs connections are instantly torn down, and the very next notification attempt automatically spawns a fresh, clean HTTP/2 connection rather than hanging indefinitely.

### 🔧 Recommendation 5: Fix Stripe Webhook Deduplication Race Condition
Wrap the webhook event process in a transaction and write the event ID to `stripe_webhook_events` as the **very first step** inside the transaction. If the insert throws a unique constraint violation, abort the transaction immediately.
```typescript
async handleWebhookEvent(event: Stripe.Event): Promise<{ handled: boolean }> {
  try {
    return await withTransaction(this.deps.db.db, async (tx) => {
      // 1. Insert first to block concurrent races
      await tx
        .insertInto("stripe_webhook_events")
        .values({ id: event.id, type: event.type })
        .execute();

      // 2. Perform side effects
      switch (event.type) {
        case "payment_intent.succeeded":
          await this.onPaymentSucceeded(event.data.object, tx); // Plumb transaction context
          break;
        // ...
      }
      return { handled: true };
    });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      this.deps.logger.debug({ event_id: event.id }, "stripe: duplicate event ignored");
      return { handled: false };
    }
    throw err;
  }
}
```
* **Impact**: Complete mitigation of duplicate processing. Concurrency races are handled safely at the database layer before any application side-effects execute.

### 🔧 Recommendation 6: Refactor `BookingsService.markPaid` to Support Splits
To bridge the gap between split-payment schema design and single-payer code logic:
1. **Remove the Owner Security Check in Webhook Context**: System-level webhooks should bypass the `row.user_id !== userId` counterparty block.
2. **Implement Split Status Tracking**:
   * Instead of marking all splits captured, lookup the specific `payment_splits` row for the user who paid and update *only that row* to `"captured"`.
   * Sum the captured splits.
   * If `sum(amount_minor) == total_minor`, update the booking status to `"paid"`.
   * If `sum(amount_minor) < total_minor`, update the booking status to `"partially_paid"`.
```typescript
// Proposed refactoring sketch for markPaid inside a transaction context:
const split = await tx
  .selectFrom("payment_splits")
  .selectAll()
  .where("booking_id", "=", bookingId)
  .where("user_id", "=", payingUserId)
  .executeTakeFirst();

if (split) {
  await tx
    .updateTable("payment_splits")
    .set({ status: "captured", paid_at: new Date() })
    .where("id", "=", split.id)
    .execute();
}

const allSplits = await tx
  .selectFrom("payment_splits")
  .select(["amount_minor", "status"])
  .where("booking_id", "=", bookingId)
  .execute();

const totalCaptured = allSplits
  .filter((s) => s.status === "captured")
  .reduce((sum, s) => sum + s.amount_minor, 0);

const booking = await tx
  .selectFrom("bookings")
  .select("total_minor")
  .where("id", "=", bookingId)
  .executeTakeFirstOrThrow();

if (totalCaptured >= booking.total_minor) {
  await tx
    .updateTable("bookings")
    .set({ status: "paid", paid_at: new Date() })
    .where("id", "=", bookingId)
    .execute();
} else {
  await tx
    .updateTable("bookings")
    .set({ status: "partially_paid" })
    .where("id", "=", bookingId)
    .execute();
}
```
* **Impact**: Fully implements the split payment feature, allowing multiple participants to pay their shares asynchronously without throwing 403 authorization errors or falsely marking bookings fully paid.
