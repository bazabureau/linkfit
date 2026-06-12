## 2026-06-01T00:29:17Z
You are the Kysely DBA Implementer. Your working directory is `/Users/kamrannamazov/Desktop/linkfit/.agents/kysely_dba_indexing_specialist`.

Your mission is to implement the pessimistic locking, deadlock prevention, and query optimization fixes identified in `/Users/kamrannamazov/Desktop/linkfit/.agents/kysely_dba_indexing_specialist/kysely_dba_report.md`.

Specifically, you must:
1. Enforce Consistent Lock Ordering in Token Refresh:
   - In `apps/api/src/modules/users/users.service.ts`, inside the `withTransaction` block of `UsersService.refresh`, lock the parent user row using `tx.selectFrom("users").select("id").where("id", "=", user.id).forShare().executeTakeFirstOrThrow()` before issuing a session or rotating refresh tokens.
2. Parent-Row Pessimistic Locking on Courts:
   - In `apps/api/src/modules/bookings/bookings.service.ts`, inside the `withTransaction` block of `BookingsService.create`, select the parent court row using `.forUpdate()` to serialize booking requests for that specific court and prevent write skew / double bookings.
   - In `apps/api/src/modules/partner/partner.service.ts`, inside `PartnerService.createVenueBooking`, apply the identical parent court `.forUpdate()` row lock.
3. Split Block Validation Subqueries:
   - In `apps/api/src/modules/matchmaking/matchmaking.service.ts` (inside `recommendPlayers` and `recommendPlayersForMe`), split the block checking `NOT EXISTS` query containing a logical `OR` into two distinct, highly optimized `NOT EXISTS` statements (one checking blocker_user_id = viewer, one checking blocker_user_id = candidate).
4. Verify the changes:
   - Navigate to `apps/api`.
   - Run `npm run typecheck` to verify zero strict TypeScript errors.
   - Run `npm run lint` to verify zero ESLint errors/warnings.
5. Save your progress inside your working directory `.agents/kysely_dba_indexing_specialist/progress.md`, write your final handoff at `.agents/kysely_dba_indexing_specialist/handoff.md`, and notify the Project Orchestrator via send_message.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
