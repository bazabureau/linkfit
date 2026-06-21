# Design Doc — Security Roadmap: Close Pending Items + Hardening Program

- **Status:** Draft for review
- **Owner:** Backend tech lead
- **Date:** 2026-06-21
- **Scope:** `apps/api-laravel` (LIVE — php-fpm on `142.93.166.170`, `api.linkfit.az`), `apps/{web,admin,partner}`, repo infra (`docker-compose*.yml`, `infra/nginx.conf`), legacy `apps/api` (Node/Fastify).
- **Non-goals:** payments provider integration, new product features. This doc is hardening + closing known gaps only.

---

## 1. Context & current state

This session shipped a batch of authz/PII fixes to prod (idempotency replay now user-scoped, group-conversation self-join IDOR closed, re-invite no longer demotes members, etc.). The auth/token core is already in good shape:

- **Tokens** (`app/Services/Auth/TokenService.php`): HS256 access JWT (15 min) carrying `{ sub, sid }`; opaque 32-byte refresh, only the sha256 stored as `bytea`; rotation with reuse-detection that revokes the whole family (`TokenService.php:75-81`); concurrent-refresh handled with `lockForUpdate` (`:63-67`).
- **Edge/app middleware** (`bootstrap/app.php`): `RequestId → throttle:api → BrowserOriginGuard → ApiKeyGuard → SecurityHeaders`. `SecurityHeaders.php` sets HSTS/CSP/`X-Frame-Options`/`noindex`. `ApiKeyGuard.php` gates the public `X-Linkfit-App-Key`.
- **Rate limiting** (`app/Providers/AppServiceProvider.php:70-135`): per-IP + per-email + per-app-key buckets already exist for `login`, `password-reset-request`, `password-reset`, plus `public-discovery`/`write-action`. Auth routes are individually throttled (`routes/api.php:67-80`).
- **Password reset** (`AuthExtrasController.php:88-119`) already revokes all live refresh tokens after a reset (`:114-117`), and reset codes are HMAC-scoped per `userId:kind:code` (`EmailTokenService.php:103-106`).

Given that baseline, the five PENDING items are real but mostly *targeted* gaps, not greenfield work. This doc grounds each in the offending line(s) and gives a concrete, low-risk plan against a LIVE prod surface.

The five PENDING items:

1. Promo over-redemption race lock
2. Chat `attachment_url` host allowlist
3. JWT/session revocation (`sid`) check on access tokens
4. Password-reset attempt lockout (per-account code-guess counter)
5. Legacy Node `apps/api` + stale compose/nginx decommission; admin `.env` https

---

## 2. Target end-state

- A promo code's `max_redemptions` / `per_user_limit` cannot be exceeded under concurrency. The DB is the source of truth, not a TOCTOU read.
- `attachment_url` on a message can only point at hosts we control (our media disk URL / CDN), eliminating SSRF-by-proxy, malicious-redirect, and tracking-pixel vectors.
- A logged-out / password-changed / admin-revoked session's still-unexpired access JWT (≤15 min window) stops working immediately, not after TTL.
- Per-account reset-code guessing is bounded by an attempt counter that survives IP rotation (the current limiter is per-IP/per-email-per-minute, not a hard cap on total guesses per issued code).
- Exactly one API codebase (Laravel) exists in the repo as the deployable; the Node app and the compose/nginx that wire `→ http://api:3000` are removed or clearly archived. Admin builds only ever talk https.

---

## 3. Decisions (with rationale)

### 3.1 Promo over-redemption → DB-enforced, not app-enforced

**Decision:** Add a unique partial index for per-user uniqueness, and `lockForUpdate` the `promo_codes` row inside the existing booking transaction before re-counting.

**Why:** Today `promoDiscount()` reads counts (`BookingsController.php:1146,1152`) *before* the `DB::transaction` at `:268`, then inserts the redemption at `:293`. Two concurrent bookings both pass the count check and both insert → over-redemption. The booking transaction already exists and already commits the redemption atomically with the booking (`:292-301`) — we only need to make the *limit check* part of that locked, serialized critical section.

- **Per-user limit** is best expressed declaratively: `UNIQUE (promo_code_id, user_id)` as a partial/normal index on `booking_promo_redemptions`. With `per_user_limit = 1` (the default, `PromoCodesController.php:210`) this is a pure DB guarantee, no lock needed; the insert at `:293` will throw `23505` and we map it to the existing conflict handler at `:303-309`.
- **Global `max_redemptions`** is a counter, not a uniqueness rule, so it needs serialization: inside the transaction, `SELECT ... FOR UPDATE` the `promo_codes` row, then `COUNT(*)` redemptions, then decide. Lock contention is per-code only (fine — one hot code at a time), and the lock is held for microseconds.

**Rejected:** an advisory lock keyed on the code (extra moving part, no schema record); optimistic `redeemed_count` column with `WHERE redeemed_count < max` UPDATE (works, but duplicates state already derivable from the redemptions table and risks drift).

### 3.2 Chat `attachment_url` → host allowlist derived from our own media config

**Decision:** Validate `attachment_url` (`MessagingController.php:534`) against an allowlist of hosts built from `Storage::disk(MEDIA_DISK)->url('')` and an optional `MEDIA_CDN_HOST`. Reject anything else with `VALIDATION_ERROR`.

**Why:** Clients upload via `MediaController@store`, which returns `Storage::disk($disk)->url($path)` (`MediaController.php:97`) — that is either `APP_URL/storage` (public disk, `config/filesystems.php:44`) or `AWS_URL` (S3/Spaces, `:56`). The set of legal attachment hosts is therefore *already known to the server*. Accepting an arbitrary 2048-char string (`MessagingController.php:534,550`) lets a sender store `https://attacker/track.gif?u=<victim>` that every recipient's client will fetch — tracking + IP harvest + potential malicious-redirect.

- Centralize in a small `MediaUrl::isAllowed(string $url): bool` helper (also reusable by Stories `:` and any future attachment surface) so the allowlist has one definition.
- Allow relative paths that begin with the storage prefix too, in case a client ever sends a path rather than absolute URL — but normalize and re-prefix server-side rather than trusting it.

**Rejected:** stripping query strings only (doesn't stop arbitrary-host fetch); a regex on `linkfit.az` (brittle, misses the S3/Spaces bucket host).

### 3.3 Access-token `sid` revocation check

**Decision:** On each authenticated request, after decoding the JWT, verify the token's `sid` (family id) still maps to a **non-revoked** refresh-token family. Cache the lookup briefly (≤30 s) to keep it cheap.

**Why:** `JwtAuthenticate.php:34-46` validates the signature/exp and loads the user, but **never checks `sid`** — `$claims->sid` is only stashed onto the request (`:46`), never validated. So a logged-out user's access token keeps working until its ≤15-min exp (`TokenService.php:38`); password reset revokes refresh tokens (`AuthExtrasController.php:114`) but the *access* token in hand still passes auth. This is the single highest-impact pending item: it converts "logout"/"reset"/"admin kill session" from eventually-consistent (15 min) to effectively immediate.

- Cheapest correct check: `EXISTS (SELECT 1 FROM refresh_tokens WHERE family_id = :sid AND revoked_at IS NULL)`. On logout we already `revoke()` the presented token (`AuthController.php:181`); to make logout kill the access token too, logout should revoke the **whole family** (one extra `whereNull('revoked_at')->update` scoped by `family_id`), consistent with how reset already behaves.
- Wrap the lookup in `Cache::remember("sid_live:$sid", 30, ...)`; bust the key on any revoke. 30 s bounds the worst-case stale window far below the 15-min TTL while keeping the common path a cache hit.
- Tolerate legacy access tokens minted before the change (those still have a valid `sid` because `issueSession` always set one — `TokenService.php:45-46` — so no migration gap).

**Rejected:** a per-user `token_version` integer bumped on logout/reset (works for "log out everywhere" but can't revoke a *single* device/family, which `sid` gives us for free); a denylist of revoked JWTs (unbounded, and we already have the family table).

### 3.4 Password-reset attempt lockout (per issued code)

**Decision:** Add a bounded attempt counter on the reset-code consume path keyed by `(user_id, kind)`, locking the account's reset for a cooldown after N failed `consumeCodeForUser` / `verifyCodeForUser` attempts.

**Why:** The per-minute limiter (`AppServiceProvider.php:126-135`: 5/min per email, 10/min per IP) slows guessing but does **not** cap *total* guesses against a single 6-digit code over its 10-min life. 6-digit space is 10^6; at 5 valid attempts/min/email an attacker gets ~50 tries before the code expires — still negligible, but a distributed IP pool sidesteps the per-IP limit and the per-email limit is the only real wall. A hard per-code attempt budget (e.g. 5 wrong guesses → invalidate the code, force re-request) closes it deterministically.

- Track failures in a Redis counter `reset-attempts:{userId}` (TTL = code TTL). On the 5th failure, call the existing `invalidatePendingForUser($userId, 'reset_password')` (`EmailTokenService.php:94`) so the live code dies and the attacker must re-request (which is itself limited at 3/min/email, `:120-121`).
- Reset the counter on a successful consume.
- Apply the same pattern to the email-verify code path (`verifyEmail`) for symmetry — same primitive.

**Rejected:** account-wide login lockout (DoS lever — an attacker can lock out any victim by spamming wrong codes; we mitigate by locking only the *code*, not login, and the victim simply re-requests).

### 3.5 Legacy Node app + stale infra decommission; admin https

**Decision:** Archive/remove `apps/api` (Node/Fastify) and the compose/nginx that target it; keep only the Laravel deployable. Confirm admin builds are https-only.

**Why:** `docker-compose.prod.yml` builds `context: ./apps/api` and nginx proxies `→ http://api:3000` (`infra/nginx.conf` upstream `linkfit_api`, `:43,:62`), but prod actually runs Laravel php-fpm directly on the droplet. The Node tree (`apps/api`, last touched 2026-06-21) is a live second implementation of the same surface — a confusing, un-deployed, potentially-vulnerable attack-surface twin and a real footgun (someone could `docker compose up` it). Admin `.env` already uses `https://api.linkfit.az` (`apps/admin/.env:1`, `.env.local:1`), so the "admin cleartext-API-URL fix" the web team did is effectively in place — this item is now *verify + guardrail*, not change.

- Move `apps/api` to `archive/` (or delete after a tagged commit) and remove/rewrite `docker-compose*.yml` + `infra/nginx.conf` so the repo has no path that boots the Node API. If compose is still wanted for local dev, point it at `apps/api-laravel`.
- Add a CI guard (grep) that fails the build if any tracked `.env*`/config in `apps/{web,admin,partner}` contains `http://` for an API host. This makes 3.5's https requirement permanent, not a one-time fix.

---

## 4. Risks

| Change | Risk | Mitigation |
|---|---|---|
| 3.1 promo lock | New `UNIQUE(promo_code_id,user_id)` can fail to add if existing duplicate rows exist | Pre-flight `SELECT` for dups on prod; backfill/dedupe before `CREATE UNIQUE INDEX CONCURRENTLY` (Postgres, non-blocking) |
| 3.1 row lock | Lock held inside booking txn could add latency under a viral promo | Lock is per-code and microsecond-scale; the txn already exists — no new long-held lock |
| 3.2 allowlist | Too-strict allowlist breaks legit attachments already in flight | Build allowlist from the *same* `Storage::disk()->url()` the uploader uses; ship behind a config flag; log-and-allow for one deploy, then enforce |
| 3.3 sid check | Adds a DB/cache read to **every** authenticated request (hot path) | 30 s `Cache::remember`; the check is a single indexed `EXISTS`; degrade-open only on cache/DB *infra* failure, never on a definitive "revoked" |
| 3.3 logout-family-revoke | Revoking the whole family on logout could log out a second device sharing a family | Families are per-session (`issueSession` mints a fresh `sid`, `TokenService.php:45`), so one family ≈ one device — no cross-device impact |
| 3.4 lockout | Attacker spams wrong codes to grief a victim | Lock the *code* only (victim re-requests), never login; counter TTL = code TTL |
| 3.5 decommission | Removing compose/nginx breaks someone's local workflow | Tag a `pre-decommission` commit; provide a Laravel-pointed compose if local dev needs it |

All five touch a **LIVE** API. Sequencing (below) is staged: schema-only and additive-middleware changes first, behavior-enforcing flips second, each independently revertible.

---

## 5. Step-by-step plan

**Phase 0 — Pre-flight (no prod change)**
1. On a prod replica: dedupe-check `booking_promo_redemptions` for `(promo_code_id, user_id)` duplicates and any `count > max_redemptions`. Record findings.
2. Confirm `MEDIA_DISK` / `AWS_URL` / `APP_URL` values in prod env so the 3.2 allowlist is built from the right hosts.
3. Add contract/unit tests (red) for all five before touching prod code (concurrent-redemption test, off-host attachment rejected, revoked-`sid` access token → 401, 6th wrong reset code → locked, no `http://` in web envs).

**Phase 1 — Schema + additive, dark (low risk, no behavior flip)**
4. `CREATE UNIQUE INDEX CONCURRENTLY` for `(promo_code_id, user_id)` on `booking_promo_redemptions` (after dedupe). (3.1)
5. Add `MediaUrl::isAllowed()` helper + wire it into message-send validation behind `MEDIA_ATTACHMENT_ENFORCE=false` (log-only). (3.2)
6. Add the `sid`-liveness check to `JwtAuthenticate` behind `ENFORCE_SID_REVOCATION=false` (log "would-reject" only); make `AuthController@logout` revoke the whole family. (3.3)
7. Add per-code attempt counter in `EmailTokenService` consume/verify paths (enforce immediately — it only ever *helps* a legit user by re-requesting). (3.4)

**Phase 2 — Enforce flips (one at a time, watch Sentry/logs between each)**
8. Flip `MEDIA_ATTACHMENT_ENFORCE=true` after a deploy of clean log-only data. (3.2)
9. Flip `ENFORCE_SID_REVOCATION=true`; verify logout/reset now invalidate access tokens within 30 s; watch 401 rate. (3.3)
10. Add the per-user-limit `23505` mapping + `FOR UPDATE` global-count check inside the booking txn. (3.1)

**Phase 3 — Decommission + guardrail**
11. Tag `pre-node-decommission`; move `apps/api` to `archive/` (or delete); remove/rewrite `docker-compose*.yml` + `infra/nginx.conf`. (3.5)
12. Add CI grep guard: fail if `apps/{web,admin,partner}` configs contain `http://<api-host>`. Verify admin `.env` https (already true). (3.5)

**Rollback:** every Phase-1/2 behavior change is a single env flag flip back to `false`; the index in step 4 is `DROP INDEX CONCURRENTLY`; step 11 is a git revert of the archive commit.

---

## 6. Open questions
- Do we want "log out everywhere" as a user-facing action now that family-revoke is wired? (Cheap once 3.3 lands.)
- Should `attachment_type=video` even be allowed before we have transcoding/size policy on the media disk? (Out of scope; flag for product.)
- Reset-code attempt budget N: 5 vs 3 — pick based on real support-ticket data on typo rates.
