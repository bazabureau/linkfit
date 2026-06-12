# BRIEFING — 2026-06-01T02:15:00+02:00

## Mission
Audit background jobs, APNs push notification queues, and Stripe split-payment webhooks in `/Users/kamrannamazov/Desktop/linkfit/apps/api` for reliability, idempotency, timing consistency, and recovery boundaries.

## 🔒 My Identity
- Archetype: Integration Webhook & Job Specialist
- Roles: Integration Audit, Webhook Security and Reliability Analysis, Job Queue Auditing
- Working directory: /Users/kamrannamazov/Desktop/linkfit/.agents/integration_webhook_job_specialist
- Original parent: 5f6c0774-069c-415a-9b2e-5784688a2095
- Milestone: Audit background jobs, APNs, Stripe webhooks

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- CODE_ONLY network mode (no external HTTP calls, no external web searches)

## Current Parent
- Conversation ID: 5f6c0774-069c-415a-9b2e-5784688a2095
- Updated: 2026-06-01T02:15:00+02:00

## Investigation State
- **Explored paths**:
  - `apps/api/src/modules/feed/feed.worker.ts`
  - `apps/api/src/modules/push/push.sender.ts`
  - `apps/api/src/modules/push/push.service.ts`
  - `apps/api/src/modules/push/daily-digest.sweeper.ts`
  - `apps/api/src/modules/games/games-completion.sweeper.ts`
  - `apps/api/src/modules/games/games-reminder.sweeper.ts`
  - `apps/api/src/modules/stories/stories-expire.sweeper.ts`
  - `apps/api/src/modules/digest/weekly-recap.sweeper.ts`
  - `apps/api/src/modules/data-rights/data-rights.sweeper.ts`
  - `apps/api/src/modules/payments/stripe-webhook.routes.ts`
  - `apps/api/src/modules/payments/payments.service.ts`
  - `apps/api/src/modules/bookings/bookings.service.ts`
- **Key findings**:
  - `GamesCompletionSweeper` infinite loop and query scaling bug (queries all completed games in system history every 15 min due to lack of a confirmed participant check).
  - `WeeklyRecapSweeper` & `StoriesExpireSweeper` mismatched directories causing expired weekly recap PNG storage leakage (`recap` vs `stories` directories).
  - Multi-pod concurrent sweep racing causing CPU waste and duplicate file creation.
  - Custom `ApnsSender` TCP session hanging risks on socket error or timeout.
  - Stripe webhook deduplication parallel-request race condition.
  - Mismatch between split-payment schema design and single-payer `BookingsService.markPaid` shortcut, throwing 403 ForbiddenError for split payments.
- **Unexplored areas**: None. The audit is complete.

## Key Decisions Made
- Organized findings into a detailed `webhooks_jobs_report.md` artifact.
- Created concrete, actionable recovery recommendations and refactoring sketches instead of writing direct code fixes, adhering to the read-only constraint.

## Artifact Index
- `/Users/kamrannamazov/Desktop/linkfit/.agents/integration_webhook_job_specialist/original_prompt.md` — Original agent instructions.
- `/Users/kamrannamazov/Desktop/linkfit/.agents/integration_webhook_job_specialist/progress.md` — Realtime progress tracker.
- `/Users/kamrannamazov/Desktop/linkfit/.agents/integration_webhook_job_specialist/webhooks_jobs_report.md` — Master Audit Report.
- `/Users/kamrannamazov/Desktop/linkfit/.agents/integration_webhook_job_specialist/handoff.md` — Handoff metadata report.
