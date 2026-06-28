# LinkFit — Monorepo Guide (source of truth)

Padel community + court-booking platform for **Azerbaijan** (pilot launch). UI languages: AZ / EN / RU.
This file is the authoritative quick-reference. Older root docs (`OVERNIGHT_*.md`, `STRATEGY.md`,
`ORIGINAL_REQUEST.md`, `MARKETING.md`) are historical/aspirational and may **overclaim** features —
do not treat them as current spec. When in doubt, trust the code + this file.

## Apps (this repo: `Desktop/Projects/linkfit`)
| Path | Stack | Role |
|------|-------|------|
| `apps/api-laravel` | Laravel 13 (PHP), Postgres | Core API — the single backend for everything. 74 feature tests. |
| `apps/web` | Next.js 16 (`src/app/[lang]`) | Public web app (AZ/EN/RU): booking, games, players, payments, legal. |
| `apps/admin` | Next.js 16 (`(auth)`/`(dashboard)`) | Internal admin dashboard. |
| `apps/partner` | Next.js 16 (`(auth)`/`(dashboard)`) | Venue-partner portal. |

The **Flutter mobile app** lives in a SEPARATE repo: `Desktop/LINKFITAPP` (Riverpod 3, GoRouter, Dio,
Reverb). It is the App Store / TestFlight client. See its own notes; bundle `az.linkfit.app`.

## API
- Base URL: **`https://api.linkfit.az/api/v1`**. Routes: `apps/api-laravel/routes/api.php`.
- Auth: email+password, Google, Sign in with Apple. Email verify = 6-digit code (`AuthExtrasController`)
  or set `email_verified_at`. JWT access + refresh tokens.
- App-key gate: prod `REQUIRE_API_KEY=false` (the `X-Linkfit-App-Key` guard early-returns).

## Production
- **Server: `142.93.166.170`** (root, key `~/.ssh/id_ed25519`). API at `/opt/linkfit-api-laravel`
  (php-fpm + nginx, **systemd**, not PM2). CF → api/linkfit/admin/owner.linkfit.az.
- **Postgres**: native, `127.0.0.1:5432`, db `linkfit`, user `linkfit` (creds in the app `.env`).
  `pg_dump`/`psql` available. Backups: `/opt/_deploy_backups/`.
- Broadcast: Reverb (`BROADCAST_CONNECTION=reverb`). Realtime confirmed live.

## Hard rules (do not violate)
- **NEVER** `DELETE`/`DROP`/`TRUNCATE` production data without an explicit per-request user instruction
  AND a fresh `pg_dump` backup first. Verify scope (counts + real-user impact) before deleting.
- **Deploy gate (API):** `php artisan test` must be green (74 feature suites) before deploying.
- **Timezone:** venue/business time is **Asia/Baku (UTC+4)**. Convert explicitly; never use naive local
  `DateTime()`/`now()` for stored UTC instants.
- **Money:** keep amounts consistent (minor units); verify rounding in splits/refunds/promos.
- **Mobile build number** must strictly increase every TestFlight upload (`pubspec.yaml` `+N`).

## App Store / TestFlight (mobile)
- App: **Linkfit / `az.linkfit.app` / id 6770729499**, version **1.0.1**, AZ-only availability.
- ASC API: issuer `b97a28a3-c370-431d-9a62-0b9abab79c66`, key `3XMPT79WM7`
  (`~/.appstoreconnect/private_keys/AuthKey_3XMPT79WM7.p8`). Build via
  `flutter build ipa --release --dart-define-from-file=dart_defines.json`, upload via
  `xcrun altool --upload-app`.
- Reviewer demo account (verified): `appstore.review@linkfit.az` / `ReviewLinkfit2026`.
- Latest build: **1.0.1+19** (TestFlight, attached to version). Screenshots (6.7") uploaded.
- Remaining for App Store *submission* (not TestFlight): **App Privacy** data-collection
  questionnaire — ASC API returns 404 for it; complete in the ASC **web UI**.

## Required-working features for pilot (must stay functional)
Auth (login/register/verify/reset/SIWA/Google) · Booking (quote/hold/create/**cancel**/**reschedule**
= `PATCH /bookings/{id}`/mark-paid) · Games & matchmaking (create/join/leave/live-score) ·
Tournaments/Americano · Squads · Chat/realtime · Follow/**block**/**report** (Apple UGC) ·
Notifications · **Account deletion** (`DELETE me` / `POST me/delete`, Apple 5.1.1v) · Profile · Venues/courts.

## Dev commands
- API: `cd apps/api-laravel && php artisan test` · `php artisan migrate`
- Web/admin/partner: `cd apps/<app> && npm run build` (Next 16) · `npx tsc --noEmit` for type-check
