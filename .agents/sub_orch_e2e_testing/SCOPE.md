# Scope: E2E Testing Track

## Architecture
- Module/package boundaries, data flow, shared interfaces
- Rest API endpoints (from apps/api)
- Kysely database pool & migrations

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Define Scope & Plan | Create SCOPE.md and plan feature cases | None | DONE |
| 2 | Test Infra & Skeleton | Write TEST_INFRA.md and set up the test file skeleton | M1 | PLANNED |
| 3 | Tier 1 Happy-Path | Implement 30 Tier 1 tests (5 per feature) | M2 | PLANNED |
| 4 | Tier 2 Boundary Cases | Implement 30 Tier 2 tests (5 per feature) | M3 | PLANNED |
| 5 | Tier 3 Cross-Feature | Implement 6 Tier 3 combination tests | M4 | PLANNED |
| 6 | Tier 4 Real-World | Implement 5 Tier 4 workflow tests | M5 | PLANNED |
| 7 | Verification & Report | Run test suite, verify 100% success, publish TEST_READY.md | M6 | PLANNED |

## Interface Contracts
- All communications are REST APIs running on Fastify.
- All requests are authorized using standard Bearer JWT access tokens.
- All request/response schemas are validated via Zod.
