# Progress Tracker

Last visited: 2026-06-01T02:46:00+02:00

## 1. Concurrency & Query Optimization Fixes
- [x] 1. Enforce Consistent Lock Ordering in Token Refresh (`apps/api/src/modules/users/users.service.ts`)
- [x] 2. Parent-Row Pessimistic Locking on Courts in Bookings (`apps/api/src/modules/bookings/bookings.service.ts`)
- [x] 3. Parent-Row Pessimistic Locking on Courts in Partner Booking (`apps/api/src/modules/partner/partner.service.ts`)
- [x] 4. Split Block Validation Subqueries (`apps/api/src/modules/matchmaking/matchmaking.service.ts`)

## 2. Verification
- [x] Run `npm run typecheck` in `apps/api`
- [x] Run `npm run lint` in `apps/api`
- [x] Run isolated Vitest tests to ensure implementation behaves correctly.

## 3. Reporting
- [x] Finalize `progress.md`
- [x] Finalize `handoff.md`
- [x] Send handoff message to the parent orchestrator
