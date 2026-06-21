# Design Doc: API Versioning & Contract Governance

- **Status:** Draft (for review)
- **Owner:** Backend platform / API tech lead
- **Date:** 2026-06-21
- **Scope:** `apps/api-laravel` (LIVE — `api.linkfit.az`, php-fpm on 142.93.166.170) and its clients: Flutter (`Desktop/LINKFITAPP`), `apps/web`, `apps/admin`, `apps/partner`, legacy `apps/api` (Node/Fastify, pending decommission).

This doc defines how we version the LinkFit HTTP API and how we keep the wire contract from silently breaking clients we cannot force-update (App Store builds in particular). It is grounded in the code as it ships today, not an aspirational rewrite.

---

## 1. Current State

### 1.1 There is one version, and it is a literal path string

The API is mounted with Laravel's default prefix disabled and `api/v1` written by hand into the route file:

- `bootstrap/app.php` — `withRouting(api: routes/api.php, apiPrefix: '')`. The comment is explicit: *"iOS hits absolute paths like `/api/v1/auth/login`, so we mount the API route file with NO extra prefix and write the full `/api/v1/...` paths."*
- `routes/api.php:62` — `Route::prefix('api/v1')->group(...)` wraps essentially the entire surface (528 lines, ~50 controllers).

There is **no version negotiation**. No `Accept-Version` header, no `Accept: application/vnd.linkfit.v1+json`, no per-version route files. `v1` is a string segment, identical in kind to `auth` or `bookings`. A `v2` today means find-and-replace plus a parallel route tree — there is no mechanism for it.

### 1.2 Clients hardcode `/api/v1` as part of the base URL

- Flutter: `lib/core/config/app_config.dart:11` → `API_BASE_URL` defaults to `https://api.linkfit.az/api/v1`; `app_config.dart:40,69` document a second origin "without the `/api/v1` suffix" for `/og`, `/.well-known`, and Reverb. So the client already special-cases the fact that some routes live *outside* the version prefix.
- Web: `apps/web/src/lib/api.ts:54` builds a base from `NEXT_PUBLIC_API_BASE_URL`; callers pass literal `/api/v1/...` paths (`calendar/page.tsx:264`, `verify-email/page.tsx:174`, etc.).
- Admin: `apps/admin/README.md:16,20,69-70` still points at the **legacy Node/Fastify `apps/api`** over `/api/v1/admin/*`, with `NEXT_PUBLIC_API_PREFIX=/api/v1` and `api.linkfit.app` (note: `.app`, not the live `.az`). This is the dual-stack hazard called out in PENDING work.

Implication: the version is baked into config in four+ places. Any version change is a coordinated multi-repo release, and one of the consumers (admin) currently believes it talks to a different stack on a different TLD.

### 1.3 The real contract is the JSON shape, and it is enforced only by convention + Swift decoders

The binding contract today is not the URL — it is the response/error envelope that the iOS Swift decoders and Flutter models parse:

- `app/Support/ErrorEnvelope.php:14-22` — every error renders as `{ "error": { "code", "message", "request_id" } }` and the docstring warns the `code` strings (`UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | CONFLICT | VALIDATION_ERROR | RATE_LIMITED | INTERNAL`) "MUST stay identical to the public API contract" because `APIError.from(envelope:status:)` switches on them.
- `AppInfoController::version()` (`version` route at `routes/api.php:82`) hand-shapes a nested `ios` block where "every field except `release_notes_url` is non-optional on the Swift side, so each must be present with the correct JSON type." The comment is doing the job a schema should do.
- The mobile reconciliation history (this session, plus prior `aa34bb69 Lock down API surface contracts`, `5b5d93a0 Expand public API surface safeguards`) shows the team repeatedly chasing field-name/shape drift by hand: NotificationPrefs envelope parse fix, home `access.full_access` fallback, suggested-slots params, CSV export fix.

There are **no contract tests and no machine-readable schema**. `tests/` has only `Feature/` and `Unit/`; nothing named `*contract*` or `*openapi*` exists. Drift is caught when a human notices a client broke.

### 1.4 An ad-hoc capability/version surface already exists (and should be the lever, not the path)

We already ship runtime negotiation primitives that are *not* the URL version:

- `GET /api/v1/app/version` — min-supported / latest build + `force_update` for iOS soft/hard upgrade gating (`AppInfoController::version`).
- `GET /api/v1/app/capabilities` and `app/metadata` — per-client feature booleans (`AppInfoController::capabilities`).
- `GET /api/v1/internal/capabilities` (internal-key gated) — server-to-server capability probe (`InternalController::capabilities`).
- `X-Linkfit-App-Key` gate (`app/Http/Middleware/ApiKeyGuard.php`) — app *identity*, not version, but proves we already run cross-cutting middleware on the whole `api` group and can hang version logic there.

This is the key insight for the target: **we already evolve behavior via capability flags and build gates, not via URL versions.** That is the grain we should cut with.

---

## 2. Goals & Non-Goals

**Goals**
- Never silently break an already-installed App Store build. Backward-incompatible changes must be *impossible to ship by accident*.
- Make the contract machine-checkable in CI so drift fails the build, not production.
- Define exactly when `v2` is warranted, what it costs, and how the two versions coexist.
- Decouple "the version" from four hardcoded base URLs so a future bump is a server-side concern, not a 4-repo lockstep release.

**Non-Goals**
- Rewriting the route file or introducing `v2` now. v1 is healthy; this doc governs *change*, it does not mandate a migration.
- GraphQL / gRPC. We stay REST+JSON.
- Versioning the internal (`internal.key`) and admin surfaces on the same cadence as the public mobile surface — they have force-updatable clients and a looser SLA (see §3.4).

---

## 3. Target Design & Decisions

### Decision 1: Keep `v1` as the only URL version. Evolve additively within it; reserve URL-version bumps for true incompatibility.

`/api/v1` stays. We adopt an **additive-only** rule inside v1, enforced by contract tests (§3.3):

- ALLOWED without a version bump: new endpoints, new *optional* request fields, new response fields, new enum values **only on fields clients treat as open** (see Decision 4), new error `details`.
- FORBIDDEN inside v1 (these are what force a `v2`): removing/renaming a response field, narrowing a type, removing an endpoint or required-field semantics, changing an existing error `code` for a given condition, repurposing a field's meaning.

Rationale: URL versioning is the heaviest tool. Mobile already evolves through capability flags + build gates (§1.4); 90% of "we need v2" instincts are actually "we need a new optional field" or "a new capability flag." The expensive cases (you genuinely must break a field an old binary reads) are rare and deserve a deliberate `v2`.

### Decision 2: `v2`, when it happens, is a sibling route file mounted at a sibling prefix — never an in-place mutation of v1.

When a real break is required:
- Add `routes/api_v2.php`, mount it alongside v1 in `bootstrap/app.php`'s `withRouting` (a second `api:` group, or one route file that nests `Route::prefix('api/v2')`).
- v2 controllers/resources live in `App\Http\Controllers\Api\V2\*` and reuse v1 services; only the serialization layer (API Resources / response shaping) forks. Business logic is **never** duplicated.
- v1 stays frozen-additive and supported until telemetry (§3.5) shows the floor of live builds has migrated, then it is sunset on a published timeline (§4 step 6).

Rationale: in-place mutation is exactly how the current "human notices it broke" failure mode happens. A physically separate tree makes "did I break v1?" a diffable, testable question.

### Decision 3: Introduce a machine-readable contract (OpenAPI 3.1) as the source of truth, generated from code, diffed in CI.

- Generate `docs/eng/openapi/linkfit-v1.yaml` from the Laravel routes + Form Requests + API Resources (e.g. `dedoc/scramble`, which reads existing type hints/validation with near-zero annotation).
- Commit the generated spec. CI runs the generator and **fails if the working spec diverges from the committed one without an accompanying changelog entry**, and runs `oasdiff` (or equivalent) to **classify** the diff as `additive` (pass) or `breaking` (fail unless the PR is explicitly labeled `api-breaking` + targets a new version).
- The error envelope and the `app/version` iOS block (the two shapes most load-bearing for Swift decoders, §1.3) get **golden-file contract tests** in `tests/Feature/Contract/` asserting exact JSON keys/types, so the hand-written warnings in `ErrorEnvelope.php` and `AppInfoController.php` become executable.

Rationale: today the contract lives in code comments and a senior engineer's memory. CODifying it is the single highest-leverage change in this doc — it converts every PENDING/this-session-style "field drift" bug into a red CI check.

### Decision 4: Standardize tolerant reading on both sides; document "open" vs "closed" fields.

- Server: never break a client by *adding*. New response fields are always safe **only if clients ignore unknowns**. Audit Flutter models and Swift `Decodable`s to confirm unknown-key tolerance (Swift `Codable` already ignores unknown keys; verify Flutter `fromJson` does too and does not `assert` on shape).
- Contract: enum fields are explicitly marked **open** (client must handle unknown values with a fallback — e.g. booking status, notification type) or **closed** (exhaustive; adding a value is breaking). This is documented per-field in the OpenAPI `description`. Memory already records the inverse pain (Order/Attendance enum mismatches in the APAR project); we make the open/closed contract explicit so adding an enum value is a known-safe or known-breaking decision, not a surprise.

### Decision 5: Decouple clients from the literal prefix; negotiate capability, not URL.

- Clients keep `/api/v1` in their base-URL config (cheap, stable) but **must not** branch behavior on the URL version. Behavior differences are driven by `GET /app/capabilities` + `GET /app/version` (already live), which become the official, documented negotiation surface.
- The `X-Linkfit-App-Key` middleware group (`bootstrap/app.php` `api(append:[...])`) is the natural place to later stamp a resolved API version onto `$request->attributes` if/when v2 lands, so controllers read one canonical value instead of inferring from the path.

### 3.4 Surface tiers (different governance, same spec discipline)

| Tier | Clients | Update control | Versioning policy |
| --- | --- | --- | --- |
| Public mobile (`/api/v1/*` consumed by Flutter/iOS) | App Store binaries | **Cannot force** | Strict additive-only; breaking ⇒ `v2`; contract tests mandatory |
| Web (`apps/web`) | Next.js, deploys hourly | Can force-deploy | Additive-only, but sunset window can be days not months |
| Admin / Partner | internal Next.js | Can force-deploy | Same spec, lighter sunset; **currently mis-pointed at legacy Node `apps/api` — fix during decommission (§4 step 1)** |
| Internal (`internal.key`) | server-to-server | We own both ends | Capability-probe (`internal/capabilities`); no URL versioning needed |

### 3.5 Version observability

Add a lightweight per-request log/metric dimension (cheap, in the existing `RequestId`/middleware path): resolved API version + `X-Linkfit-App-Key` fingerprint (already computed in `ApiKeyGuard`) + client build (from `app/version` checks or a `User-Agent`/`X-Client-Build` header). This gives us the **floor of live builds** number that gates any v1 sunset decision. Without it, "is it safe to drop v1?" is a guess.

---

## 4. Step-by-Step Plan

Sequenced so the highest-leverage, lowest-risk work lands first. None of steps 1–5 change the wire contract; they make it *defensible*.

1. **Decommission the legacy dual stack (unblocks everything).** Retire Node `apps/api` + stale compose/nginx (already in PENDING). Repoint `apps/admin` and `apps/partner` env/docs off `api.linkfit.app` / Node and onto the live Laravel `api.linkfit.az`. Fix `apps/admin/README.md:16,20,69-73` and the admin `.env` (also fixes the admin cleartext/`https` items the parallel web team is touching). *Until this is done there are two "v1"s and any governance is fiction.*
2. **Freeze the contract as it ships.** Generate `openapi/linkfit-v1.yaml` from the current routes; commit it as the baseline. Manually reconcile the two known hand-shaped surfaces (`ErrorEnvelope`, `AppInfoController::version`) so the spec is exact.
3. **Add contract CI.** (a) Regenerate-and-diff gate; (b) `oasdiff` additive/breaking classifier wired to a required check; (c) golden-file `tests/Feature/Contract/` for the error envelope codes and the `ios` version block. Land alongside the existing 188-test Flutter suite + PHPUnit so red means stop.
4. **Document the additive-only rule + open/closed enums** (Decisions 1 & 4) in `docs/eng/` and link it from `routes/api.php`'s header comment, replacing tribal knowledge with a referenced policy.
5. **Add version/build observability** (§3.5) so we can later measure migration.
6. **Publish the `v2` playbook (don't build it).** A short runbook: when to bump, how to add `routes/api_v2.php` + `Api\V2\*` resources, the sunset criteria (floor-of-live-builds threshold from step 5), and the deprecation-header convention (`Deprecation` / `Sunset` headers on v1 once v2 exists). This is the artifact that makes a future bump a checklist, not an archaeology project.

### Risks & Mitigations

- **R1 — "Additive-only" gets bypassed under deadline pressure.** A field gets renamed in v1, an old iOS build crashes. *Mitigation:* make it mechanically impossible — the `oasdiff` breaking-change check is a **required** status check; the only escape hatch is the `api-breaking` label which forces the v2 path.
- **R2 — Generated spec doesn't capture the hand-shaped responses** (the very ones that bite us — error envelope, version block). *Mitigation:* those two get explicit golden-file tests (step 3c), not just generator coverage.
- **R3 — Decommission breaks admin/partner** because they really do depend on a Node-only endpoint. *Mitigation:* before deleting Node, diff `apps/api` routes against the Laravel surface; any admin endpoint with no Laravel equivalent is a port-or-confirm-dead task, gated on the new contract tests.
- **R4 — Flutter/iOS models are NOT tolerant of unknown fields**, so "additive is safe" is false for them. *Mitigation:* audit (Decision 4) before relying on additive-safety; this is a prerequisite, not an assumption.
- **R5 — Contract tests calcify legitimate fixes** (e.g. a genuine bug in a response shape). *Mitigation:* the gate blocks *silent* breaks, not *intentional* ones — an intentional change updates the committed spec + changelog in the same PR, which is exactly the audit trail we want.
- **R6 — Over-investment.** This is a single-product API with a handful of clients; full API-management tooling would be overkill. *Mitigation:* scope is deliberately just spec-in-CI + a v2 runbook, no gateway, no version router until v2 is actually needed.

---

## 5. Open Questions

- Do we expose `Deprecation`/`Sunset` headers now (cheap, forward-compatible) or only when v2 ships?
- Which OpenAPI generator survives our hand-shaped responses with least annotation burden — `scramble` vs `l5-swagger`? (Spike during step 2.)
- Is `X-Client-Build` worth standardizing across iOS + Flutter + web now, to power the §3.5 floor metric uniformly?
