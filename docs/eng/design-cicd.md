# Design: CI/CD Pipeline & Safe-Deploy (Laravel/php-fpm)

Status: Draft · Owner: Backend platform · Last updated: 2026-06-21
Scope: `apps/api-laravel` (LIVE backend), `apps/web|admin|partner` (Next.js), and the
prod host `142.93.166.170`. Excludes iOS/Flutter store pipelines.

This doc is grounded in the repo as it stands today. Concrete anchors:
- CI: `.github/workflows/ci.yml`
- Prod facts: `apps/api-laravel/MIGRATION.md` (esp. lines 48–69) and the team
  deploy reference for host `142.93.166.170`.
- Compose/Docker (currently unused in prod): `docker-compose.prod.yml`,
  `apps/api-laravel/Dockerfile`.

---

## 1. Current state (what actually happens today)

### 1.1 CI (`.github/workflows/ci.yml`)
Runs on push/PR to `main`. Jobs:
- `api` (lines 19–83): installs/typechecks/lints/tests/**builds the legacy Node
  Fastify app** in `apps/api`, with a Postgres 16 service container. **This app
  is dead in prod** — `MIGRATION.md:3` says "The old Node backend folder has
  been removed" yet `apps/api/package.json` + `apps/api/src` still exist locally
  and CI still gates on them.
- `api-laravel` (lines 85–113): `setup-php@v2` PHP 8.4, `composer validate
  --strict`, `composer install`, copies `.env.example`, `key:generate`, `php
  artisan test`. This is the only job that reflects production.
- `admin` / `partner` / `web`: Next.js typecheck/lint/build with a placeholder
  `NEXT_PUBLIC_API_URL=http://localhost:4000`. `web` checks out submodules
  (`submodules: recursive`, line 287) because `apps/web` is a git submodule
  (`.gitmodules` → `bazabureau/linkfit-web`).
- `ios`: macOS build/test, guarded by `apps/ios/project.yml` existence.

**CI is build/test only. There is no deploy job, no environment, no artifact
promotion, no smoke check against prod.** Concurrency cancels superseded runs
(lines 14–16); permissions are `contents: read` (line 10).

### 1.2 Deploy (manual, undocumented-in-repo)
Per the team deploy reference, every backend deploy today is a hand-run rsync:

```
rsync -vz -b --suffix=.predeploy -e "ssh -i ~/.ssh/id_ed25519" \
  <changed files> root@142.93.166.170:/opt/linkfit-api-laravel/app/Http/Controllers/Api/
# remote:
chown 501:50 <files>; chmod 644 <files>      # code files are 501:50, NOT www-data
php -l <files>                                # lint
systemctl reload php8.4-fpm                   # REQUIRED: opcache validate_timestamps=0
systemctl restart linkfit-horizon            # queue picks up new code
# verify:
curl https://api.linkfit.az/health
```

Hard prod facts that constrain any pipeline:
- **php-fpm, not `php artisan serve`.** `linkfit-api.service` (old Fastify /
  artisan-serve) is stopped+disabled. Public traffic: Cloudflare → nginx →
  `unix:/run/php/php8.4-fpm.sock` → `/opt/linkfit-api-laravel/public`.
- **Opcache `validate_timestamps=0`** → file changes are invisible until
  `systemctl reload php8.4-fpm`. Forgetting this = silent no-op deploy.
- **Ownership split**: app code is `501:50`; only `storage/` and
  `bootstrap/cache/` are `www-data:www-data`. Wrong ownership on `storage/`
  → API 500s (can't write logs/cache/uploads), and CLI artisan as root masks
  it — so **verify over HTTP, never just CLI**.
- **`storage:link` footgun** (`MIGRATION.md:57–66`): `public/storage` is
  gitignored and not part of the non-Docker deploy, so after a code sync every
  media URL 404s as JSON. Any deploy must run
  `php /opt/linkfit-api-laravel/artisan storage:link`.
- **Rollback today** = the rsync `.predeploy`/`.bak-predeploy` backups +
  (until recently) the old `.82` host as a warm standby. The old host is now
  retired, so the standby safety net is gone.
- **Queue/realtime**: `linkfit-horizon.service` (queue) and
  `linkfit-reverb.service` (WebSocket) run from the same dir and must be
  restarted/considered on deploy.
- Email is Gmail API (`MAIL_MAILER=gmail`, custom transport), not SMTP — health
  checks must not assume SMTP.

### 1.3 Drift / rot that will bite us
- `docker-compose.prod.yml:36` still `build`s `./apps/api` (the dead Node app)
  and wires Node-era env (`JWT_ACCESS_SECRET`, `npm run migrate:up:prod`,
  `PORT: 3000`). It does **not** describe prod.
- `apps/api-laravel/Dockerfile:47` `CMD ["php","artisan","serve",...]` — the
  one thing prod explicitly forbids. The image is unused but is a loaded
  footgun if anyone `docker compose up`s it.
- `.env.production.example` is the Node template (JWT secrets, CORS shape), not
  Laravel's. New operators will fill in the wrong file.
- Next.js apps deploy by rsync + remote `next build` + `systemctl restart
  linkfit-<app>` — building **on** the prod box, competing for its 2 vCPU.

---

## 2. Target state

A **single GitHub Actions pipeline** that gates merges with the existing test
matrix, then performs a **gated, scripted, reversible deploy** of the Laravel
API and the three Next.js apps to `142.93.166.170` — encoding today's tribal
rsync/php-fpm knowledge into a reviewed script with a one-command rollback.

Principles:
1. **CI green is necessary, not sufficient** — deploy is a separate, manually
   approved job (GitHub Environment with required reviewers), not auto-on-merge.
2. **One canonical deploy script per app**, committed to the repo, that the
   pipeline and a human run identically (`scripts/deploy/api.sh`,
   `web.sh`, etc.). No more ad-hoc one-liners.
3. **Atomic, symlinked releases** so rollback is an instant symlink flip +
   php-fpm reload, not a reverse-rsync.
4. **Post-deploy smoke check over HTTPS** that fails the job (and auto-rolls-back)
   if `https://api.linkfit.az/health` or a tiny authed probe regresses.
5. **No build on the prod host** for Next apps — build in CI, ship the artifact.

---

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Keep **rsync + php-fpm**, do NOT switch prod to Docker/Octane now | Prod is proven on php-fpm with opcache tuning; the Dockerfile/compose are stale and switching mid-flight is a separate, riskier project. Containerize later as its own RFC. |
| D2 | Adopt **atomic releases**: `/opt/linkfit-api-laravel/releases/<ts>` + a `current` symlink the nginx root points at | Turns rollback into a symlink flip + `reload php8.4-fpm` (seconds), removing the brittle `.predeploy` reverse-rsync. `storage/` and `.env` live in a shared dir symlinked into each release. |
| D3 | Deploy is **manual-approval** via a GitHub `production` Environment, triggered by `workflow_dispatch` (or tag `api-vX`), gated on CI success | Avoids surprise auto-deploys to a live, money-handling backend; keeps a human in the loop for the security-sensitive controllers shipped this session. |
| D4 | **Commit the deploy scripts** (`scripts/deploy/*.sh`) and have CI call them over SSH | Single source of truth; the script always runs `storage:link`, fixes ownership, reloads fpm, restarts horizon, and smoke-tests — closing today's footguns by construction. |
| D5 | **Build Next apps in CI**, rsync the built `.next`/standalone output, restart service | Stops burning the 2-vCPU prod box on `next build`; build failures stay in CI. |
| D6 | **Decommission the legacy Node `apps/api`**: delete the `api` CI job + the dir, fix `docker-compose.prod.yml`/`Dockerfile`/`.env.production.example` to Laravel | Removes a whole class of "which backend?" confusion and a green-but-irrelevant CI gate. (Listed as PENDING in the session brief.) |
| D7 | SSH via a **dedicated deploy key stored as a GitHub Actions secret**, restricted (forced-command + `from=` Cloudflare-less GH IP range is impractical, so use a least-priv deploy user instead of `root`) | `root` over CI SSH is the current practice and is the single largest blast-radius risk. |
| D8 | Secrets stay in the host `.env` (shared dir), never in the image or repo; CI never reads them | Matches current model; rotation stays a host op. |

---

## 4. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Opcache not reloaded → "deployed" code never runs | High (easy to forget) | Silent regression / silent non-fix | `reload php8.4-fpm` is the **last mandatory step** in `api.sh`; smoke check asserts a build/version header changed |
| `storage:link` missing → media 404 (the `MIGRATION.md` incident) | High after any fresh release dir | All avatars/stories break | Script always runs `storage:link`; symlink lives in the shared dir so it persists across releases |
| Wrong ownership on `storage/`/`bootstrap/cache` → 500s, masked by root CLI | Medium | Hard-down API | Script `chown` rules are explicit (code `501:50`, writable dirs `www-data`); smoke check hits an **authed** endpoint over HTTP, not CLI |
| CI green on dead Node `apps/api` gives false confidence | Certain (today) | Merges that "pass CI" but never touch prod path | D6: delete the job/dir |
| No standby host anymore (old `.82` retired) | — | Rollback is the only recourse | D2 atomic releases keep N previous releases on-disk for instant flip; nightly `pg_dump` retained off-box |
| DB migration on deploy is destructive/long | Low but catastrophic | Data loss / lock | Migrations are **opt-in** (`DEPLOY_MIGRATE=1`), run `--force` with a pre-deploy `pg_dump`; default deploy is code-only. Honors the no-DB-delete rule. |
| Reverb/Horizon left on old code | Medium | Stale queue workers, broken realtime | Script restarts `linkfit-horizon`; reloads reverb only if its code/config changed |
| CI deploy key = `root` | Present today | Total host compromise on key leak | D7: dedicated non-root deploy user with sudo scoped to the three `systemctl`/`reload` commands |
| `apps/web` submodule not checked out → stale web deploy | Medium | Old web shipped | Web deploy job uses `submodules: recursive` (already set for the `web` CI job) and pins the submodule SHA |
| Concurrent deploys race the symlink | Low | Corrupt `current` | GitHub Environment concurrency group `deploy-prod`, `cancel-in-progress: false` |

---

## 5. Step-by-step plan

### Phase 0 — De-risk & document (no infra change)
1. Land this doc; add a `scripts/deploy/README.md` capturing the current manual
   flow verbatim so it survives if the author is unavailable.
2. **D6 cleanup (PENDING item):** delete the `api` job from `ci.yml`, delete
   `apps/api`, and rewrite `docker-compose.prod.yml` + `Dockerfile` +
   `.env.production.example` to either describe Laravel/php-fpm honestly or be
   removed. (Until done, anyone reading the repo sees a Node backend that isn't
   there.)

### Phase 1 — Codify the deploy script (still hand-run)
3. Write `scripts/deploy/api.sh` (idempotent, `set -euo pipefail`) that takes a
   git ref and does, on the host:
   - `rsync` checkout into `releases/<utc-ts>` (exclude `.env`, `storage`,
     `node_modules` — **pass `--exclude=` literally**, the zsh word-split bug
     noted in the deploy reference silently ships secrets otherwise);
   - `composer install --no-dev --optimize-autoloader`;
   - symlink shared `.env` + `storage` into the release;
   - `php artisan storage:link`; `config:cache`/`route:cache`/`event:cache`;
   - `chown` code `501:50`, writable dirs `www-data`;
   - flip `current` symlink → new release;
   - `systemctl reload php8.4-fpm`; `systemctl restart linkfit-horizon`;
   - `curl -fsS https://api.linkfit.az/health` + one authed probe; **on failure,
     flip `current` back + reload + exit non-zero.**
4. Write `scripts/deploy/rollback.sh <release-ts|previous>` → symlink flip +
   reload + smoke. Keep last 5 releases on disk.
5. Mirror for Next apps: `scripts/deploy/web.sh|admin.sh|partner.sh` that ship a
   **CI-built** artifact (no build on host) and `systemctl restart
   linkfit-<app>`.
6. Dry-run each script by hand against prod for several real deploys; only
   automate once they match current outcomes.

### Phase 2 — Wire into CI/CD
7. Add a `deploy` workflow (`workflow_dispatch` + tag trigger) with a
   `production` Environment (required reviewer = a backend lead). Job:
   `needs: [api-laravel, web, admin, partner]`, checks out at the dispatched
   ref/tag, loads `DEPLOY_SSH_KEY` + `DEPLOY_HOST` + `DEPLOY_USER` secrets,
   `ssh` runs the committed `scripts/deploy/<app>.sh`.
8. Add the **smoke check as a required gate**; a non-zero script exit (already
   auto-rolled-back) fails the run and notifies (PushNotification/Telegram).
9. Provision the **non-root deploy user** on the host (D7) with `sudoers` scoped
   to exactly: `systemctl reload php8.4-fpm`, `systemctl restart
   linkfit-horizon`, `systemctl restart linkfit-{web,admin,owner}`.

### Phase 3 — Migrations & observability (follow-up)
10. Add opt-in DB migration step (`DEPLOY_MIGRATE=1`) that takes a `pg_dump`
    first, runs `migrate --force`, and is reviewed separately from code deploys.
11. Add a `/health` deep-check (DB, Redis, queue, Gmail token, `storage/`
    writability) so the smoke gate catches the exact failure modes above.
12. Revisit containerization (Octane/FrankenPHP or fpm-in-Docker) as its own RFC
    once atomic-release rsync is stable — not before.

---

## 6. Out of scope / explicitly deferred
- Switching prod off php-fpm (Docker/Octane) — separate RFC (D1).
- Multi-host / blue-green — single box today; atomic releases give most of the
  benefit at a fraction of the cost.
- iOS/Flutter store release automation.
- The PENDING security items (promo race lock, attachment_url allowlist,
  sid/session revocation, password-reset lockout, admin `.env` https) — they
  ride the normal deploy path once merged; this doc just makes that path safe.
