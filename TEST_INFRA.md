# Linkfit Premium E2E Testing Infrastructure

This document outlines the architecture, setup, and methodology for running the high-fidelity integration and E2E test suites on the Linkfit Node API backend (`apps/api`).

## Architecture & Framework

The E2E test suite leverages the existing backend testing architecture:
- **Test Runner**: [Vitest](https://vitest.dev/)
- **REST Client Mocking**: Fastify's native HTTP injection layer (`app.inject`) to hit API endpoints directly without spawning a TCP socket (keeping execution lightning fast and completely isolated).
- **Database Layer**: [Kysely](https://kysely.dev/) query builder connected to a PostgreSQL database pool.
- **Fixtures & Seeders**: Pre-baked helpers located in `tests/helpers/fixtures.ts` to manage transactions, seed central Baku venues/courts, and provision authenticated test users dynamically.

## Local PostgreSQL Fallback

To support environments where a container runtime (Docker/Podman) is not available, the global test coordinator (`globalSetup.ts`) is designed with an automatic fallback:
1. It attempts to provision a fresh, isolated PostgreSQL 16 container via `@testcontainers/postgresql`.
2. If the container runtime client cannot start, it catches the error and silently falls back to connecting to a locally running PostgreSQL instance:
   - **URI**: `postgres://localhost:5432/linkfit_test`
3. The coordinator then applies Kysely SQL migrations dynamically against the target database via `node-pg-migrate` prior to executing any test suites.

## The 4-Tier Test Methodology

The E2E test suite (`tests/e2e/linkfit.e2e.test.ts`) implements a strict **4-tier opaque-box approach**:

### Tier 1: Core Operations
Verifies the happy paths for every key feature, confirming basic CRUD and REST contracts.
- **Home Feed (F1)**: Feed retrieval, story views, following, reacting/liking, and commenting.
- **Matches Discovery (F2)**: Match creation, listing, details retrieval, and joining/leaving.
- **Tournaments (F3)**: Roster registration, lists, and entry withdrawal.
- **Squad Management (F4)**: Creation, invites, acceptances, and squad games aggregation.
- **Referrals (F5)**: Redemption, compact dashboard details, and invite text localization.
- **Chat & Followers (F6)**: Direct messaging, typing statuses, read markers, and mutual follows.

### Tier 2: Boundary Conditions & Validation Rules
Enforces all business logic invariants, rate limits, schema boundaries, and edge cases.
- Employs invalid payloads to verify schema failures (HTTP 400).
- Simulates authorization failures (HTTP 401).
- Asserts boundary rules like self-blocking prevention, self-following prevention, double-invitation blocks, and capacity limits.

### Tier 3: Cross-Feature Flows
Exercises critical inter-module workflows that reflect actual app behaviors.
- Block lists filtering social home feed stories and games search.
- Referral viral signups denormalizing counts on referrers.
- Chat message replies to ephemerally shared stories.
- Tournaments squad size checking against current squad size before allowing registration.

### Tier 4: Real-World Scenarios
Orchestrates complex, multi-user journeys simulating complete app sessions.
- **Organic Growth**: Viral signups, mutual follows, and home feed personalization.
- **Tournament & Squads**: Roster provisioning, entry fees, and captain-led registration.
- **Competitive Matchmaking**: Matching, ELO calculations, and rating distributions.
- **Private Matchmaking**: Squad-only games coordination via dedicated chat threads.
- **Social Boundaries**: Mutual block lists filtering chat, searches, invites, and feed comments.

---

## Test Execution

### Pre-requisites
Ensure that a local PostgreSQL service is running and the `linkfit_test` database is created:
```bash
createdb linkfit_test
```

### Running the E2E Test Suite
Execute the Vitest command specifically targeting the E2E test file:
```bash
# In apps/api
npx vitest run tests/e2e/linkfit.e2e.test.ts
```

### Cleaning Up Connection Locks
If Vitest hangs or errors out due to connection deadlocks, terminate all orphan node/vitest processes:
```bash
pkill -f vitest
```
