# LinkFit — CTO Technical Strategy

**Author:** CTO
**Date:** 2026-06-21
**Scope:** Session `03e5415a` ("Harden API + fix domain bugs") backend deploy to prod (`api.linkfit.az` @ `142.93.166.170`), mobile commit `8a1161f` (pushed to `main`), in-flight web work on `apps/{web,admin,partner}`.
**Inputs:** 40+ adversarial senior-reviewer findings, 8 tech-lead design docs (`docs/eng/design-*.md`), 6 team-lead sign-offs.
**Status:** AUTHORITATIVE. Supersedes individual sign-offs where they conflict.

---

## 1. GO / NO-GO ON THIS SESSION'S DEPLOYED CHANGES

### Verdict: **GO — keep prod running. DO NOT ROLL BACK. Change-set is NOT "done."**

The runtime behavior shipped this session is **correct and net-positive for security**. Five authorization/correctness fixes were verified adversarially against the live schema with zero new IDOR introduced across a full sweep of all 50 API controllers:

| Fix | File:line | Verdict |
|---|---|---|
| Booking idempotency replay now user-scoped (cross-user PII leak closed) | `BookingsController.php:314-317` | Correct, non-breaking, verified vs live `text NOT NULL UNIQUE` schema |
| Group-chat self-join IDOR closed (game/tournament membership authorized) | `MessagingController.php:300-318` | Correct; captain + listed-player allow path verified |
| Americano standings recompute (atomic, derived-not-incremented) | `AmericanoController.php:173-228` | Idempotent, transactional, net-new improvement |
| Squad re-invite no longer demotes active member/owner | `SquadsController.php:129-150` | Real severe bug fixed, no over-fill regression |
| changeEmail re-issues verify code; best-effort mail isolated | `MeController.php:155-196` | Sound; mail failure cannot 500 the committed change |

**Deploy is operationally safe:** commit `03e5415a` is **6 controller files, +260/-27, ZERO migrations/schema** (independently confirmed — `git show` lists no `database/migrations` entry). A code-only php-fpm reload was sufficient; no `php artisan migrate` was required. Working tree is clean — deployed == committed.

### BLOCKER COUNT: **2 must-fix before the change-set is "complete" / before next merge to `main`.**

These do **not** trigger rollback (runtime is correct) but they block sign-off and the next deploy:

- **BLOCKER 1 — CI is RED on `main` with prod code.** The `MembershipController` change (`:214-225`) surfaces root-level `tier`/`is_premium`/`on_trial`/`benefits`/`price_minor`; the existing test `MembershipAccessTest::test_membership_show_returns_launch_access_without_subscription_details` asserts those keys are **absent** (`tests/Feature/MembershipAccessTest.php:529-530` — **independently verified**: `assertArrayNotHasKey('tier'/'is_premium')`). CI runs `php artisan test` (`ci.yml:113`) on push/PR → backend suite is **18/19, 1 FAILED**. The "188 tests pass" claim referred to the **Flutter** suite, not Laravel. **Fix: update the stale test to the new intended contract (assert keys present with `tier='free'`, `is_premium=true` under launch trial; keep `billing`/`plans`/`payments` hidden). No app-code change — the controller is correct.**

- **BLOCKER 2 — New authorization-asymmetry regression in messaging.** The game-membership guard at `MessagingController.php:301-305` omits a status filter: a user who **left** a game (status set to `cancelled`, row not deleted — `GamesController.php:338`) retains a stale `game_participants` row and can **re-join the group chat** roster, regaining read of history + live fan-out. The tournament branch correctly excludes `withdrawn`; the game branch must mirror it. **Fix: add `->whereIn('status', ['confirmed','played'])` (or at minimum `<> 'cancelled' AND <> 'no_show'`) to the membership check.** Severity low (legitimate prior member, shared context) but it is a *new* gap authored this session — fix in the same follow-up PR as Blocker 1.

### IMMEDIATE ROLLBACK TRIGGERS (operational, post-deploy)

Roll back commit `03e5415a` (revert the 6 controllers, reload php-fpm) **only** if any of these are observed in prod:

1. **5xx rate** on `/api/v1/bookings` (store/index/mine) or `/api/v1/conversations/group` rises >2× baseline sustained 5 min — the idempotency catch path or the new membership guards are misfiring.
2. **Legitimate-user 403 spike** on `/conversations/group` — indicates the IDOR guard is locking out real captains/players/organizers (watch for a tournament *organizer who is neither captain nor listed player* — known intended-403, confirm no real flow depends on it).
3. **Booking duplicate-create or double-charge** signal from partners — idempotency replay returning wrong row (should be impossible post-fix, but it is the highest-blast-radius path).
4. **Americano standings visibly wrong/oscillating** after scoring — the unlocked recompute race materialized beyond the self-healing window.
5. **changeEmail** lockout reports — users unable to re-verify after email change.

Rollback is cheap (code-only, no schema). Bias to **fix-forward** for Blockers 1 & 2; reserve revert for triggers 1–5.

---

## 2. RISK REGISTER — TOP 8 (Severity × Likelihood)

Ordered by risk score. S/L scale: H/M/L. **Score = S×L.**

| # | Risk | Sev | Like | Score | Evidence | Owner | Action |
|---|------|-----|------|-------|----------|-------|--------|
| **R1** | **JWT/session not revocable** — access token survives logout / password-reset / "log out other devices" for full 15-min TTL; `sid` (refresh family) never checked | **H** | **M** | **HIGH** | `JwtAuthenticate.php:33-49` validates sig+exp only, stashes `sid` at :46 but never verifies family liveness; all revocation acts only on `refresh_tokens` | BE lead | **P1 before next release.** Add `EXISTS` family-liveness check after user-load (schema + index `refresh_tokens_family_idx` already present); cache ≤30s. Make `logout` revoke whole family. Contract test: logout → same access token → 401. |
| **R2** | **Promo over-redemption race** — global `max_redemptions` check-then-insert with no lock and no DB backstop → N concurrent bookings on a `max=1` code all pass → direct revenue loss | **H** | **M** | **HIGH** | `BookingsController.php:1145-1149` (count) called at :261 *outside* the txn at :268; insert at :293 has no unique on `promo_code_id`; no `lockForUpdate` anywhere in promo/booking flow | BE lead | **P1.** Move count inside txn + `SELECT … FOR UPDATE` on the `promo_codes` row, OR atomic guarded `UPDATE … WHERE redemptions_used < max_redemptions` counter. Pessimistic lock is the smaller change. |
| **R3** | **Dual-backend infra footgun** — dead legacy Node `apps/api` still builds (`docker-compose.prod.yml:36`), runs `node-pg-migrate up` on boot (`entrypoint.sh:29-30`) against the **same Postgres** as Laravel; legacy migration ledger has already **forked** (`1700000070000` is Stripe schema in Node vs local-payment schema in Laravel for the same id) | **H** | **M** | **HIGH** | `design-data-migrations.md`; `design-cicd.md`; CI `api` job (`ci.yml:19-83`) still tests the dead app; Laravel Dockerfile CMD is the forbidden `php artisan serve` | Infra lead | **P0 decommission.** Phase 0: delete Node service from compose, revoke DDL from runtime DB role, remove the `api` CI job + stale compose/nginx. One `docker compose up` against prod is a data-loss event today. |
| **R4** | **CI red on `main`** — backend suite fails on deployed code; "tests pass" was Flutter-only | **M** | **H** | **HIGH** | `MembershipAccessTest.php:529-530` vs `MembershipController.php:214-225`; CI runs `php artisan test` (`ci.yml:113`) | BE lead | Blocker 1. Fix test this week. Until green, **no merges to `main`** (see §4). |
| **R5** | **Chat `attachment_url` unvalidated** — accepts any 2048-char host → tracking-pixel / IP-harvest / open-redirect vector in DMs | **M** | **M** | **MED** | `MessagingController.php:534/550`; `design-security-roadmap.md` | BE lead | **P1.** Allowlist `attachment_url` host to our own media/CDN origin(s); reject external. |
| **R6** | **Mobile store-release blockers** — Android signed with **debug keystore** (rejected by Play, un-upgradable); **no crash reporting** (`sentry_flutter`/Crashlytics absent from `pubspec.lock`, no `runZonedGuarded`); bundle-ID mismatch (iOS `az.linkfit.app` vs Android `az.linkfit.linkfit`); Android FCM non-functional (no `google-services.json`) | **H** | **M** | **MED-HIGH** | `design-mobile-release.md`; `android/app/build.gradle.kts:38-42,21,25` | Mobile lead | **P0 for launch.** Generate prod keystore now, standardize both IDs on `az.linkfit.app` (still pre-launch, safe), wire crash reporting before any staged rollout (no crash-free metric = no rollout halt signal). |
| **R7** | **bookings list N+1** — `bookingPayload()` runs 2-3 queries **per row**; `index`/`mine` at limit=100 → ~250 queries/page; `suggestedSlots` per-slot 3-query scan now reachable with no anchor after this session's validation widening (up to ~1440 queries on a booked court) | **M** | **M** | **MED** | `BookingsController.php:884-888` (called from :531/:503); `:186-196` slot scan | BE | **P2.** JOIN court/venue into `bookingsQuery`, batch `payment_splits`/promo with `whereIn`. Pre-load day window for slot scan. Pattern exists (Feed/Conversations/Games are correctly batched). |
| **R8** | **No route-level admin/partner gate** — all `/admin/*` `/partner/*` routes sit in the same `jwt` group as player routes; authz is purely in-body per method. One forgotten in-body check = instant exposure to any authed user | **M** | **L-M** | **MED** | `routes/api.php:173,295`; current code verified consistent | BE lead | **P2 defense-in-depth.** Add `admin`/`partner` route-middleware group so a forgotten gate can't expose an action. Track with R1. |

**Also tracked (below top-8, do not lose):** password-reset attempt lockout (no rate-limit on reset attempts); `me/change-email` now sends email per call with no throttle (`routes/api.php:138` — add `throttle:5,1`); per-user promo unique index created **conditionally** and may be silently absent on prod DBs with legacy dupes (`2026_06_18_000002:84`); admin/partner prod `.env` HTTPS hygiene (only `partner` has an https fail-fast guard; `admin`/`web` rely on env hygiene alone); Americano score path has **no row lock** (divergent from every other concurrency path — self-heals, low); orphaned suggested-times Flutter dead code + game_card RenderFlex overflow risk + chat-video misclassification (3 mobile must-fixes, see §4).

---

## 3. ENGINEERING ROADMAP — 30 / 60 / 90 DAY

Five tracks: **Security close-out, Payments, Observability, Release, Scaling.** Sequenced so launch-blocking security and infra-footgun work lands first.

### 30 DAYS — "Stop the bleeding; make `main` green and safe to deploy"

**Security (P0/P1):**
- [ ] **R1 — `sid` revocation** (family-liveness `EXISTS` in `JwtAuthenticate`; logout revokes family; contract tests for logout/reset/log-out-others incl. the "current device still works" regression guard).
- [ ] **R2 — promo race lock** (pessimistic lock + count inside txn; recreate the per-user unique index unconditionally after dedupe; branch the `23505` catch on constraint name so a promo collision doesn't masquerade as "Duplicate booking request").
- [ ] **R5 — chat `attachment_url` allowlist.**
- [ ] **change-email throttle** (`throttle:5,1`), **password-reset attempt lockout.**

**Infra (P0):**
- [ ] **R3 Phase 0 — decommission legacy Node:** remove `apps/api` service from `docker-compose.prod.yml`, revoke DDL from the runtime DB role, delete the dead `api` CI job, remove stale compose/nginx. This closes the single largest data-loss footgun.

**CI/Release (Blockers):**
- [ ] **R4 — fix `MembershipAccessTest`** → backend CI green.
- [ ] **Blocker 2 — game-membership status filter** in `MessagingController`.
- [ ] Mobile must-fixes: game_card overflow (`Flexible`+ellipsis + golden test at 320-360dp), resolve orphaned suggested-times (delete dead code OR re-wire; amend commit intent), chat-video purpose branch in `MediaUploadKind.infer`.

**Exit criteria (30d):** backend + Flutter CI both green on `main`; legacy Node gone from prod compose; R1/R2/R5 merged; no debug-signed artifacts.

### 60 DAYS — "Observability live; release pipeline real; mobile launch-ready"

**Observability:**
- [ ] Turn on **Sentry** (set `SENTRY_LARAVEL_DSN` + `SENTRY_DSN` Flutter) — env/release/`request_id`/`user.id`, PII off. Activates plumbing already in tree.
- [ ] **Dead-man alerting** on the 4 scheduled jobs (`routes/console.php`); enable `HEALTH_CHECK_HORIZON`; wire `HEALTH_NOTIFICATIONS_ENABLED=true` + a real `HEALTH_TO_ADDRESS` (today a failing health check pages nobody).
- [ ] Structured JSON logging + rotation (move off unrotated `single`/`debug` file).

**CI/CD:**
- [ ] **Atomic symlinked releases** (`releases/<ts>` + `current` flip) over the same rsync/php-fpm transport; encode the deploy footguns in the pipeline: mandatory `php8.4-fpm` reload (opcache `validate_timestamps=0`), `storage:link`, ownership split, **HTTPS smoke check** (root-CLI masks 500s).
- [ ] **Backend deploy job** in CI (currently none — deploys are hand-run one-liners) with one-command rollback (symlink flip back).

**Mobile Release (R6):**
- [ ] Prod keystore + `key.properties`; standardize bundle IDs on `az.linkfit.app`; `google-services.json` + FCM; **crash reporting wired** with crash-free as the staged-rollout halt metric.
- [ ] First **internal/closed track** submission (TestFlight + Play internal).

**Exit criteria (60d):** Sentry receiving prod events; one-command deploy + rollback; a signed mobile build in an internal store track with crash-free telemetry.

### 90 DAYS — "Payments path; scaling headroom; contract governance"

**Payments:**
- [ ] Implement the AZ-local PSP adapter (Payriff/Epoint — **not** Stripe; Stripe can't do live AZN card) behind the swappable `PaymentGateway` interface. The single seam is `PaymentsController::paymentSheet()` (today throws structured 501s). Add the append-only `payments` ledger table (do **not** overload `bookings`), signature-verified webhooks, and keep the **server-recompute invariant** (never trust client amounts — `bookings.total_minor` is authoritative).

**Scaling:**
- [ ] **R7 — bookings N+1 + slot-scan** remediation (JOIN/batch; copy the Feed/Games batched pattern).
- [ ] **Realtime:** keep the strong failure-isolation (polling fallback + `broadcastingEnabled()` guards). Plan horizontal Reverb (currently ONE `reverb:start` sharing a 2-vCPU/8GB box with php-fpm). Add a scaling runbook before concurrent-realtime load grows.

**Governance:**
- [ ] **API contract tests / versioning** — keep `v1` as sole URL version with an **additive-only** rule; add `*contract*` test suites so JSON-shape drift (this session's NotificationPrefs/suggested-slots/CSV/`access.full_access` fixes were caught only by humans) fails CI, not users.
- [ ] **R8** route-level admin/partner middleware group.

**Exit criteria (90d):** payments adapter behind a feature flag in staging with a real ledger; bookings list <5 queries/page; contract tests gating client-facing JSON shapes.

---

## 4. ORG / PROCESS RECOMMENDATIONS

The two blockers this session are **process failures, not coding failures** — the code was correct; the *release discipline* wasn't. Fix the process so they can't recur.

### Review gates (mandatory)
1. **"Tests pass" must name the suite.** This session's "188 tests pass" was Flutter-only while Laravel was red. **Rule: a change is not mergeable until the CI matrix is green for *every* suite touching the changed surface** (backend test, Flutter test, web build). No verbal "tests pass."
2. **Code + test land together.** Blocker 1 exists because a controller contract changed without updating its test in the same change-set. **Rule: a PR that changes a response shape MUST update the contract/assertion in the same PR.** Reviewers reject otherwise.
3. **Authz checklist for messaging/booking/squad/admin PRs.** Blocker 2 (missing status filter) and the structural R8 risk both stem from in-body-only authz with no safety net. **Rule: any new participant/membership check must state which statuses it admits and mirror the sibling branch** (tournament `withdrawn` exclusion is the reference).
4. **No deploy on red CI.** Prod is currently correct *despite* red CI. That is luck, not process. **Rule: deploy is gated on green `main`.**

### CI
5. **Make CI represent prod.** Delete the legacy `api` CI job that tests the dead Node app (it gives false confidence and tests code that isn't running anywhere). Add a **backend deploy job** so deploys stop being hand-typed rsync one-liners.
6. **Add contract-test layer** (Postgres-backed — note the messaging IDOR fix uses Postgres-only `ANY(player_ids)` that can't run on the sqlite in-memory test DB; some new fixes are effectively untested until a Postgres test DB exists in CI).
7. **HTTPS smoke check post-deploy**, not root-CLI checks (which mask 500s).

### Env hygiene
8. **One prod truth for backend URLs.** Admin was on cleartext/legacy Node (`api.linkfit.app`) until this session's fix; only `partner` has an https fail-fast guard. **Rule: every client (`web`/`admin`/`partner`/Flutter) gets a production https fail-fast guard** so a missing/wrong env var fails loud, not silent-cleartext.
9. **Secrets discipline:** the security pass already rotated leaked-placeholder JWT secrets; keep secrets out of repo, enforce via the deploy pipeline, and add a pre-commit secret scan.
10. **Decommission discipline:** dead code that still *builds and migrates* (legacy Node) is worse than deleted code. **Rule: when an app is declared dead, remove it from compose/CI/nginx in the same sprint** — a half-removed backend is the dual-DB risk (R3).

### Ownership
- **R1, R2, R3 are CTO-tracked weekly** until closed — they are the three that can cause user-visible security failure or data loss.
- Each `design-*.md` doc has a named tech-lead owner; the 30/60/90 checkboxes above are the execution contract against those designs.

---

## TL;DR

**GO on the deploy — runtime is correct and net-positive for security; do not roll back.** Two blockers (red backend CI from a stale membership test; a missing game-membership status filter) must be fixed-forward before the change-set is "done" or anything else merges to `main`. The top three standing risks are **session revocation (R1)**, **promo over-redemption race (R2)**, and the **dual-backend infra footgun (R3)** — all P0/P1 in the 30-day window. The deeper lesson is process: deploys went out on red CI with a Flutter-only "tests pass," so the gates in §4 (green-for-every-suite, code+test together, no-deploy-on-red, kill the dead Node app) matter as much as the code fixes.
