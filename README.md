# Linkfit

Hyper-local sports matchmaking marketplace — native iOS + Node.js/Postgres backend. Padel and 5-a-side football first.

## Repo layout

```
linkfit/
├── apps/
│   ├── api/        # Node.js LTS · TypeScript strict · Fastify · Kysely · Postgres 16
│   └── ios/        # Swift / SwiftUI · MVVM · iOS 18+
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Phase 1 status — **complete**

- [x] **Module 0** — Foundation (config, logger, errors, DB, migrations, `/health`, design system + APIClient)
- [x] **Module 1** — Auth & profiles (Argon2id, rotating refresh + family revocation, /me, rate limited)
- [x] **Module 2** — Sports & venue catalog (earthdistance geo search, courts)
- [x] **Module 3** — Games & matchmaking (atomic-capacity join under concurrency, host actions, cursor pagination)
- [x] **Module 4** — Ratings, ELO & reliability (pure ELO + reliability engine, idempotent batch submission, public profile)
- [x] **Module 5** — Phase 2 schema (bookings + payment_splits) + feature-flagged endpoints

**120 backend integration tests** (real Postgres 16 via Testcontainers), **8 iOS tests**, lint + typecheck strict, OpenAPI auto-generated at `/docs`.

## iOS screens

Auth (Login + Register) · Home (map + games near me, sport filter) · Game detail (join / leave / cancel / rate) · Create game · Post-game rating flow · Profile (ELO + reliability + games) · Edit profile · Venues browse.

Single APIClient with single-flight token refresh on 401, Keychain-backed token storage, `ViewState` enum-driven UI for every list/detail/form (idle / loading / loaded / empty / error).

## Prerequisites

- Node.js 22 LTS or 24 (tested on 24)
- Docker Desktop (for local Postgres + Testcontainers)
- Xcode 26+ with iOS 18 SDK
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)

## Quick start

```bash
# 1. Postgres for local dev (host port 55432 — leaves your Homebrew Postgres on 5432 alone)
docker compose up -d postgres

# 2. API
cd apps/api
cp .env.example .env
npm install
npm run migrate:up
npm run dev                          # http://localhost:3000

# Live endpoints to try
curl -s localhost:3000/health | jq
open http://localhost:3000/docs       # Swagger UI

# 3. Tests (spins fresh Postgres 16 via Testcontainers, applies migrations)
npm test                              # 120 tests

# 4. iOS
cd ../ios
xcodegen generate
open Linkfit.xcodeproj                # Cmd-R
```

## Endpoints (Phase 1)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET    | `/health` | — | DB ping, uptime, version |
| POST   | `/api/v1/auth/register` | — | Argon2id, returns access + refresh |
| POST   | `/api/v1/auth/login` | — | Identical 401 for wrong-password and unknown-email |
| POST   | `/api/v1/auth/refresh` | — | Rotating; family-revoked on reuse |
| POST   | `/api/v1/auth/logout` | — | Idempotent on unknown tokens |
| GET    | `/api/v1/me` | Bearer | |
| PATCH  | `/api/v1/me` | Bearer | display_name, photo_url, home_lat/lng |
| GET    | `/api/v1/sports` | — | |
| GET    | `/api/v1/venues` | — | geo + sport filter |
| GET    | `/api/v1/venues/:id` | — | venue + courts |
| GET    | `/api/v1/games` | — | geo, sport, time-range, cursor pagination |
| POST   | `/api/v1/games` | Bearer | host auto-joined |
| GET    | `/api/v1/games/:id` | — | participants list |
| PATCH  | `/api/v1/games/:id` | Bearer | host only; `cancel: true` flips status |
| POST   | `/api/v1/games/:id/join` | Bearer | atomic capacity; 409 if full |
| POST   | `/api/v1/games/:id/leave` | Bearer | re-opens game if was full |
| POST   | `/api/v1/games/:id/participants/:uid/no-show` | Bearer | host only, post-start |
| POST   | `/api/v1/games/:id/ratings` | Bearer | batch; idempotent; triggers ELO + reliability recompute |
| GET    | `/api/v1/users/:id/profile` | — | public profile + per-sport stats |
| POST   | `/api/v1/bookings` | Bearer · `FEATURE_BOOKINGS=true` | requires `Idempotency-Key` header |
| GET    | `/api/v1/bookings/:id` | Bearer · `FEATURE_BOOKINGS=true` | |

## Engineering principles (non-negotiable)

1. **No placeholder logic.** Every function is implemented or explicitly out of scope.
2. **No files > ~300 lines.** Layered architecture: routes → service → repository.
3. **Strict type safety.** TS strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`; Swift no force-unwraps outside IBOutlets.
4. **Every endpoint:** schema validation, authz, error handling, structured logging, integration test.
5. **DB integrity in the DB** — FKs, NOT NULL, CHECK, UNIQUE, indexes.
6. **Money is integer minor units** (qəpik). Never floats.
7. **Idempotency keys** on anything that moves money or creates a booking.
8. **Migrations only.** No hand-edited schema.
9. **Secrets via env.** `.env.example` committed; `.env` ignored.
10. **TDD.** Tests written with or before code.
