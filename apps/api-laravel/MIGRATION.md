# Linkfit Laravel backend

Laravel (`apps/api-laravel`) is now the only backend wired by local docs,
production compose, and CI. The old Node backend folder has been removed.

## Hard constraints (do not break)

1. **Same PostgreSQL database.** Laravel maps Eloquent models to the existing
   60 tables. No schema migrations, no data migration, no data loss.
2. **Identical wire contract.** snake_case JSON, error envelope
   `{ "error": { "code", "message", "request_id" } }`, codes
   `UNAUTHENTICATED|FORBIDDEN|NOT_FOUND|CONFLICT|VALIDATION_ERROR|RATE_LIMITED|INTERNAL`.
   The iOS app must work unchanged.
3. **Token compatibility.** HS256 access JWT `{sub,sid,iat,exp}` (15 min),
   opaque rotating refresh token (sha256 in `refresh_tokens.token_hash`,
   family reuse-detection). Keep `JWT_ACCESS_SECRET` stable so sessions survive
   backend deployments.
4. **Password compatibility.** argon2id via PHP `password_hash`/`password_verify`
   (m=65536,t=3,p=4) — existing hashes verify natively. Confirmed.

## Current status

- [x] Auth core and auth extras.
- [x] Users, social graph, profile, discovery, preferences.
- [x] Games, matchmaking, scoring, challenges, Americano, series.
- [x] Venues, courts, availability, bookings, reviews.
- [x] Tournaments, squads, invitations, referrals.
- [x] Feed, stories, leaderboards, rankings, achievements, streaks, insights.
- [x] Messaging, realtime health, push device registration, reports.
- [x] Data rights, medical, media, membership, local payments, OAuth, app-info, OG image.
- [x] Admin and partner operations.
- [x] Docker production compose and GitHub Actions point to Laravel.

## Local dev

- DB via SSH tunnel: `ssh -fNL 5433:localhost:5432 -i ~/.ssh/id_ed25519_linkfit root@142.93.100.82`
- `php artisan serve --host=127.0.0.1 --port=8788`
- `.env` points DB at 127.0.0.1:5433 and carries the prod JWT secret.

## Layout

- `app/Support/{ErrorEnvelope,ApiException}.php` — wire-format errors.
- `app/Http/Middleware/{RequestId,JwtAuthenticate}.php`.
- `app/Services/Auth/{TokenService,PasswordService}.php`.
- `app/Models/User.php` — maps existing `users` table.
- `routes/api.php` — full `/api/v1/...` paths (apiPrefix disabled).

## Production serving (142.93.100.82)

- Plain directory deploy at `/opt/linkfit-api-laravel` (no Docker — the
  Dockerfile is unused in prod). Run by **systemd** `linkfit-api.service`
  (`php artisan serve --host=127.0.0.1 --port=4000`) behind nginx + Cloudflare.
  Queue via `linkfit-horizon.service`. Sibling Next.js apps: `linkfit-admin`,
  `linkfit-owner`, `linkfit-web`.
- **Media storage gotcha (caused story/avatar images to 404):** uploads go to
  the local `public` disk (`storage/app/public/uploads/Y/m/<uuid>.<ext>`) and
  are served at `${APP_URL}/storage/...`. That path only works if the
  `public/storage` symlink exists — but `public/storage` is gitignored and
  `php artisan storage:link` was never part of the non-Docker deploy, so after
  a deploy every media URL fell through to Laravel and returned a JSON 404.
  Fixed by a systemd drop-in that recreates the link on every start:
  `/etc/systemd/system/linkfit-api.service.d/storage-link.conf` →
  `ExecStartPre=-/usr/bin/php /opt/linkfit-api-laravel/artisan storage:link`.
  Any new deploy mechanism must run `storage:link` (or keep that drop-in).
- **Recommended hardening:** `php artisan serve` is the single-threaded dev
  server, and local-disk media doesn't survive a host rebuild or scale to
  multiple replicas. Move media to object storage (the code already supports
  it: set `MEDIA_DISK=s3` + `AWS_*`, e.g. Cloudflare R2) and run the API under
  a real SAPI (php-fpm or Octane) when traffic warrants.
