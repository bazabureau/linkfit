# BRIEFING — 2026-06-01T02:29:17+02:00

## Mission
Implement high-priority pessimistic locking, deadlock prevention, and query optimization fixes in Linkfit's backend API codebase.

## 🔒 My Identity
- Archetype: Kysely DBA & Indexing Specialist
- Roles: Kysely DBA, Query Optimizer, Migration Integrity Auditor
- Working directory: /Users/kamrannamazov/Desktop/linkfit/.agents/kysely_dba_indexing_specialist
- Original parent: 5f6c0774-069c-415a-9b2e-5784688a2095
- Milestone: Kysely DBA & Indexing Audit

## 🔒 Key Constraints
- Enforce Consistent Lock Ordering in Token Refresh.
- Parent-Row Pessimistic Locking on Courts.
- Split Block Validation Subqueries.
- Run npm run typecheck and npm run lint on apps/api and ensure zero errors.

## Current Parent
- Conversation ID: 2315e8d8-3848-4e36-a4a8-3d7d282ff12c
- Updated: 2026-06-01T02:32:00+02:00

## Task Summary
- **What to build**: Concurrency & query optimizations:
  1. `apps/api/src/modules/users/users.service.ts`: parent user row locks.
  2. `apps/api/src/modules/bookings/bookings.service.ts`: parent court row locks.
  3. `apps/api/src/modules/partner/partner.service.ts`: parent court row locks.
  4. `apps/api/src/modules/matchmaking/matchmaking.service.ts`: split block validation queries.
- **Success criteria**: All fixes implemented without regressions. Zero typecheck and lint errors.
- **Interface contracts**: `/Users/kamrannamazov/Desktop/linkfit/.agents/kysely_dba_indexing_specialist/kysely_dba_report.md`
- **Code layout**: apps/api codebase

## Key Decisions Made
- Focus on minimal, targeted, and compliant edits to Kysely queries to satisfy the specifications precisely.

## Artifact Index
- `/Users/kamrannamazov/Desktop/linkfit/.agents/kysely_dba_indexing_specialist/kysely_dba_report.md` — Detailed Kysely DBA & Indexing Audit Report
- `/Users/kamrannamazov/Desktop/linkfit/.agents/kysely_dba_indexing_specialist/progress.md` — Active tracker for implementation steps.
- `/Users/kamrannamazov/Desktop/linkfit/.agents/kysely_dba_indexing_specialist/handoff.md` — Handoff report following Handoff Protocol
