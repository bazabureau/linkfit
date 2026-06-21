# Design: Data Model & Migration Strategy (zero-downtime, the dual-ledger risk)

Status: Draft · Owner: Backend platform · Last updated: 2026-06-21
Scope: the single LIVE PostgreSQL database behind `api.linkfit.az` (php-fpm on
`142.93.166.170`), the two migration ledgers that can both write to it, and the
schema-change process for `apps/api-laravel`. Excludes app-layer query design.

This doc is grounded in the repo as it stands today. Concrete anchors:
- Laravel schema/migration tracking: `apps/api-laravel/config/database.php:130-133`
  (`migrations` table), `apps/api-laravel/database/migrations/` (30 files).
- Legacy import shim: `apps/api-laravel/database/migrations/2026_06_12_000000_import_legacy_schema.php`.
- Frozen legacy SQL snapshot: `apps/api-laravel/database/legacy-migrations/` (60 `.sql`).
- Live legacy ledger that is **still drifting**: `apps/api/migrations/` (61 `.sql`,
  run by `node-pg-migrate` via `apps/api/entrypoint.sh:29-30`).
- Prod facts + constraints: `apps/api-laravel/MIGRATION.md` (esp. lines 6-19, 48-69).
- Stale prod compose still wired to the Node app: `docker-compose.prod.yml:34-47`.

---

## 1. Current state (what actually exists today)

### 1.1 One database, two migration ledgers

The product runs against **one** Postgres database (`linkfit`, ~60 tables). Two
independent migration systems are both capable of issuing DDL against it:

1. **Laravel** (`apps/api-laravel`) — the LIVE backend. Tracks applied migrations
   in the `migrations` table (`config/database.php:131`). Standard Laravel
   `migrator` semantics: each file runs once, recorded by filename + batch.
2. **Legacy Node / `node-pg-migrate`** (`apps/api`) — the *former* backend. Tracks
   applied migrations in its own table (`node-pg-migrate` default `pgmigrations`).
   `apps/api/package.json` exposes `migrate:up:prod`, and `entrypoint.sh:29-30`
   runs `npm run migrate:up:prod` **on every container boot**.

These two ledgers do not know about each other. They are two write authorities
pointed at the same schema. That is the core risk this doc exists to retire.

### 1.2 How Laravel adopted the existing schema (the shim)

`2026_06_12_000000_import_legacy_schema.php` is a one-time bootstrap, not a real
migration. Its `up()`:
- Returns immediately if the connection isn't `pgsql` **or if `users` already
  exists** (line 11). On the live DB `users` exists, so on prod this is a no-op.
- On an empty DB (CI, fresh local) it replays every file in
  `database/legacy-migrations/*.sql` to reconstruct the schema.
- `down()` is intentionally empty (line 32-34) — it never drops the legacy schema,
  to avoid data loss.

Consequence: **the legacy schema is "owned" by Laravel only through a flat SQL
snapshot frozen on 2026-06-12.** Everything after that date is expressed as
incremental Laravel migrations (the other 29 files).

### 1.3 The snapshot has already forked from the live legacy ledger

`apps/api-laravel/database/legacy-migrations/` is a *copy* of `apps/api/migrations/`
taken at migration time. They have since diverged — proof:

- `apps/api/migrations/1700000070000_payments-stripe.sql` creates a Stripe schema
  (`stripe_customers` table, Stripe-oriented columns). The Laravel snapshot
  renamed/rewrote the same timestamp as `1700000070000_payments.sql` — a
  *different* "local payment" schema (adds `status`, `entry_id`, extra indexes on
  `tournament_entry_payments`). **Same migration id, materially different DDL.**
- `1700000005000_bookings-payment-splits.sql` differs byte-for-byte between the two.
- The Node ledger has a newer file the snapshot never imported:
  `1700000630000_email-verification-code-attempts.sql`.

So the two ledgers are not just "two runners over the same files" — they are a
genuine **fork**. If anything ever runs `node-pg-migrate up` against prod again,
it will try to apply files Laravel already represents (under different ids),
likely failing on `already exists`, or worse, succeeding partially and leaving the
schema in a state neither ledger's history describes.

### 1.4 New-table migrations also do DDL on the shared DB

10 of the 30 Laravel migrations are `Schema::create` / `CREATE TABLE` (e.g.
`2026_06_13_000003_operations_foundation.php`, `..._promo_codes.php`,
`2026_06_17_000002_create_lessons_coaching.php`). These add brand-new tables to
the same DB the legacy app's schema lives in — fine in isolation, but it means
Laravel is now the source of truth for *new* objects while the *legacy* objects
are pinned to a frozen snapshot. Source-of-truth is split by table age.

### 1.5 What the existing Laravel migrations do well (keep this)

The post-snapshot migrations are written defensively for a live DB and should be
the template for all future ones:
- **Idempotent / re-runnable**: `Schema::hasTable` / `hasColumn` guards and
  `IF NOT EXISTS` everywhere — see `2026_06_18_000002_add_missing_foreign_keys_and_promo_unique.php`.
- **Online-safe FKs**: FKs added `NOT VALID` so they enforce new writes without a
  full-table validation scan or failing on pre-existing legacy rows (`:31-34`).
- **Non-destructive uniqueness**: the promo per-user unique index is only created
  *after* checking no duplicates exist (`:77-87`) — never forces a destructive
  cleanup.
- **Transaction-aware DDL**: `2026_06_21_000001_add_report_target_kinds.php:10`
  sets `$withinTransaction = false` for `ALTER TYPE ... ADD VALUE`, which cannot
  run in a transaction on some PG versions.
- **Reversible CHECK swaps**: `2026_06_20_000003_allow_video_message_attachments.php`
  drops + re-adds the `messages_attachment_type_check` constraint cleanly.

### 1.6 How migrations reach prod today

No automated migration step exists in the deploy path. CI
(`.github/workflows/ci.yml`) is build/test only — the `api-laravel` job runs
`php artisan test` against a fresh SQLite/ephemeral DB and never touches prod.
Migrations are run **by hand** on the host: `php artisan migrate --force` is the
documented command (`docs/production-launch-security.md:126`). There is no record
in CI of which migration batch prod is on, and no gate preventing a half-migrated
deploy (new code shipped before its migration is applied, or vice-versa).

### 1.7 Decommission debt that keeps the second ledger alive

The Node ledger is "dead" per `MIGRATION.md:3-4`, but it is not actually
decommissioned:
- `apps/api/` (incl. `migrations/`, `node_modules/`, `entrypoint.sh`) still exists.
- `docker-compose.prod.yml:34-47` still **builds `./apps/api`** and its usage
  comment (`:6-7`) still says to run `npm run migrate:up:prod`.
- CI's `api` job still installs/tests/builds the Node app on every push.

As long as that compose file or any operator runbook can `docker compose up` the
Node service, the boot-time `migrate:up:prod` is a live footgun against prod data.

---

## 2. Target state

1. **Exactly one migration ledger writes to the DB: Laravel's `migrations`
   table.** The Node ledger and its runner are physically removed from anything
   that can reach prod.
2. **One source of truth for schema**: the live schema is reproducible from
   `legacy-migrations` snapshot + Laravel incremental migrations, validated in CI
   by a schema-diff against a prod-shaped baseline.
3. **Zero-downtime by construction**: every schema change follows the
   expand → migrate → contract pattern and the online-DDL rules in §4, so no
   migration takes a blocking lock long enough to error php-fpm requests.
4. **Migrations are gated, ordered, and observable in the deploy pipeline** —
   `migrate --force` runs as an explicit, logged step before code that depends on
   it goes live (forward-compatible ordering), never by hand and never on app boot.
5. **No data is ever destroyed by a migration** (per the project-wide
   no-DB-delete rule) — drops are deferred to a separate, reviewed contract phase.

---

## 3. Decisions

- **D1 — Laravel is the sole schema authority.** Retire `node-pg-migrate` entirely.
  Do not "keep it for rollback." Two ledgers is the risk; halving it to one is the
  fix.
- **D2 — Freeze, don't re-import, the legacy snapshot.** Keep
  `database/legacy-migrations/` exactly as-is as the historical bootstrap for
  empty DBs (CI/local). Never edit it to "catch up" to the Node ledger — the gap
  (`email-verification-code-attempts`, payments fork) is reconciled by **new
  forward Laravel migrations**, not by mutating the snapshot.
- **D3 — Reconcile the fork explicitly.** Audit the live prod schema (see §5.1)
  and write idempotent, guarded Laravel migrations that bring the *frozen
  snapshot's* representation in line with what prod actually has (e.g. the
  email-verification-attempt table, the real payments columns). These migrations
  must be safe to apply whether or not the object already exists.
- **D4 — Expand/contract, contract is a separate PR.** Additive changes (new
  nullable columns, new tables, `NOT VALID` FKs, new indexes via
  `CREATE INDEX CONCURRENTLY`) ship freely. Destructive/locking changes (drop
  column, drop table, `NOT NULL` tightening, type narrowing) are a deliberate
  later phase, reviewed against active code references.
- **D5 — Migrations run in the deploy pipeline, never on app boot.** `migrate
  --force` becomes a pipeline step (see §4.4), removing both the Node boot-migrate
  and the hand-run risk. The Dockerfile already does **not** auto-migrate
  (`apps/api-laravel/Dockerfile` only `storage:link`s) — keep it that way.
- **D6 — CI proves the snapshot still builds and matches.** Add a CI job that
  builds the schema from snapshot + migrations on a Postgres service container
  (not just SQLite) and diffs it against a checked-in `schema.sql` baseline, so
  drift is caught at PR time, not on prod.
- **D7 — Object storage for media is a data-migration too.** Per `MIGRATION.md:67-69`,
  local-disk media doesn't survive host rebuild/replicas. The cutover to
  `MEDIA_DISK=s3` (R2) is in-scope for this strategy because it has the same
  "dual source of truth during cutover" shape (see §4.5).

---

## 4. Migration patterns (the rules every future change follows)

### 4.1 Always guarded, always idempotent
Mirror `2026_06_18_000002`. Every `up()` checks `Schema::hasTable/hasColumn`,
uses `IF NOT EXISTS` / `IF EXISTS`, and can be re-run without error. On a live DB
a migration that fails halfway must be safe to re-run after the fix.

### 4.2 Online-DDL rules (Postgres specifics that avoid blocking php-fpm)
- **New columns**: always nullable or with a constant default (PG 11+ makes
  constant-default adds metadata-only). Never add a `NOT NULL` column without a
  default in one step.
- **Indexes**: `CREATE INDEX CONCURRENTLY` (and therefore
  `$withinTransaction = false`) so writes aren't blocked. Caveat: CONCURRENTLY can
  leave an invalid index on failure — the migration must `DROP INDEX IF EXISTS`
  first and be re-runnable.
- **Foreign keys**: add `NOT VALID`, then `VALIDATE CONSTRAINT` in a *later*
  migration once legacy rows are confirmed clean (the codebase already does the
  first half).
- **Enums**: `ALTER TYPE ... ADD VALUE IF NOT EXISTS` with
  `$withinTransaction = false` (as in `2026_06_21_000001`). Enum value *removal* is
  impossible online — model removable sets as a `CHECK` constraint or lookup table
  instead.
- **CHECK constraints on big tables**: add `NOT VALID` then validate, same as FKs.
- **No `ALTER TABLE ... TYPE`** on a hot column in one shot — add a new column,
  backfill in batches, swap reads, drop later (expand/contract).

### 4.3 Expand → migrate → contract (forward-compatible by default)
For any change that old running code can't tolerate:
1. **Expand**: additive migration (new col/table), deployed first. Old code
   ignores it.
2. **Migrate**: deploy code that writes both old+new and reads new; backfill
   existing rows in batched jobs (Horizon) — never a single unbounded `UPDATE`.
3. **Contract**: after the old code is fully retired, a separate reviewed PR drops
   the old object. Because the live deploy is rsync + `php-fpm reload`
   (effectively atomic per worker), there is always a window where both shapes
   must coexist — the expand/contract ordering is what makes that window safe.

### 4.4 Deploy ordering (where `migrate --force` runs)
- **Additive (expand) migrations**: run **before** the code that uses them goes
  live. New code that reads a new column is safe only after the column exists.
- **Contract migrations**: run **after** the code that stopped using the object is
  live.
- Make migration its own pipeline step with explicit success/failure, run from a
  single host (no concurrent migrators), logged with the resulting batch number.
  Until a real pipeline exists, the interim runbook is: `php artisan migrate
  --force` on the host *before* reloading php-fpm for expand changes.

### 4.5 Media storage cutover (D7) as expand/contract
1. Set `MEDIA_DISk=s3` (R2) and dual-write new uploads to both local + R2.
2. Backfill existing `storage/app/public/uploads/**` to R2 via a batched job;
   media URLs become R2-served.
3. Flip reads to R2; keep local as fallback for one release.
4. Contract: stop writing local, decommission the `public/storage` symlink
   dependency (the symlink fragility is documented in `MIGRATION.md:57-66`).

---

## 5. Step-by-step plan

### Phase 0 — Stop the bleeding (the dual-ledger footgun) — do first
1. **Disarm the Node boot-migrate.** In `docker-compose.prod.yml`, remove the
   `api` (Node) service block (`:34-47`) and the `migrate:up:prod` usage comment
   (`:6-7`). Nothing in prod uses this compose file (prod is php-fpm), but it is a
   live `docker compose up` away from running `node-pg-migrate` against prod.
2. **Revoke DDL from the app DB role used at runtime** (defense in depth): ensure
   the role php-fpm/Horizon connect with cannot `CREATE`/`ALTER`/`DROP`; run
   migrations as a separate migrator role. This makes an accidental second-ledger
   write *impossible*, not just discouraged.
3. **Snapshot prod schema** before any further change:
   `pg_dump --schema-only` → checked into `docs/eng/` as the baseline (§5.4).

### Phase 1 — Reconcile the fork (D3)
4. Diff live prod schema against `legacy-migrations` snapshot + current Laravel
   migrations (using the §5.4 baseline). Identify objects that exist in prod but
   are absent/different in the Laravel-reconstructable schema — known suspects:
   `email-verification-code-attempts`, the payments fork (`stripe_customers` vs
   the snapshot's local-payment shape), `bookings-payment-splits` byte diff.
5. For each gap, write a **new** guarded, idempotent forward migration that makes
   the Laravel-built schema match prod. On prod these are effectively no-ops
   (object already exists → guarded skip); on fresh CI/local they fill the gap so
   snapshot+migrations == prod. **Do not** edit the frozen snapshot.
6. Confirm the live `migrations` table batch matches the migration files on disk
   (`php artisan migrate:status`), so prod history is fully accounted for.

### Phase 2 — Prove it in CI (D6)
7. Add a CI job (extend `.github/workflows/ci.yml`) that runs migrations against a
   **Postgres** service container (not SQLite — pgsql-only code paths like enums
   and `NOT VALID` FKs don't exercise on SQLite), then `pg_dump --schema-only` and
   `diff` against the checked-in baseline. Fail the build on drift.
8. Repurpose or delete the dead Node `api` CI job — it currently gates `main` on a
   backend that isn't deployed.

### Phase 3 — Pipeline the migration run (D5)
9. Add a deploy step that runs `php artisan migrate --force` from a single host as
   an explicit, logged stage, ordered per §4.4 (expand-before-code,
   contract-after-code). Record the batch number in the deploy log.
10. Add a pre-migrate `pg_dump` (logical backup) as the rollback artifact for any
    migration that can't be reversed by `down()` (per the no-DB-delete rule,
    rollback = restore-forward from backup, never destructive auto-down on prod).

### Phase 4 — Decommission the Node app (closes the risk permanently)
11. Delete `apps/api/` (source, `migrations/`, `entrypoint.sh`, `node_modules`),
    the now-orphaned Node service, and update `MIGRATION.md` so docs match reality
    (`:3-4` already claims this is done — make it true).
12. Remove stale `compose`/`nginx` artifacts that reference the Node app
    (`docker-compose.prod.yml`, `infra/nginx.conf` if it proxies to `api:3000`).
    This is the already-tracked "legacy Node `apps/api` + stale compose/nginx
    decommission" pending item.

### Phase 5 — Media + ongoing hygiene
13. Execute the media→R2 cutover (§4.5 / D7).
14. Adopt §4 as the written migration checklist for every future schema PR
    (guarded, online-DDL, expand/contract, ordered deploy).

---

## 6. Risks & mitigations

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|-----------|
| R1 | Node `entrypoint.sh` boot-migrate runs `node-pg-migrate up` against prod, corrupting a schema neither ledger describes | Low freq / **catastrophic** | Phase 0: delete Node service from compose, revoke DDL from runtime DB role, eventually delete `apps/api` |
| R2 | Frozen snapshot drifts further from prod; fresh CI/local DB no longer matches prod, masking bugs | Medium | Phase 1 reconcile + Phase 2 CI pg-dump diff gate |
| R3 | Migration takes a blocking lock (`ALTER TABLE` rewrite, non-concurrent index) → php-fpm 500s during deploy | Medium | §4.2 online-DDL rules; concurrent indexes; `NOT VALID` + validate split |
| R4 | New code deployed before its expand migration (or drop before code retires) → runtime "column does not exist" | Medium | §4.4 deploy ordering; expand/contract with contract as a separate PR |
| R5 | Irreversible migration (enum add, dropped data) needs rollback | Low | Pre-migrate `pg_dump`; design `down()` only where truly reversible; no destructive auto-down on prod (no-DB-delete rule) |
| R6 | Backfill `UPDATE` on a large table locks rows / bloats WAL | Medium | Batched Horizon jobs, never one unbounded `UPDATE`; throttle |
| R7 | Two operators run `migrate --force` concurrently | Low | Single-host pipeline stage; Laravel's migration table advisory locking; document "one migrator" |
| R8 | Media cutover loses files mid-flight | Low | Dual-write expand phase + verified backfill before flipping reads (§4.5) |

---

## 7. Out of scope / follow-ups
- Read-replica / connection-pooling topology (separate scaling doc).
- Per-table partitioning of hot tables (feed_events, messages) — revisit at scale.
- The runtime DB-role privilege split (R1 mitigation) overlaps with the security
  backlog; coordinate with `docs/production-launch-security.md`.
