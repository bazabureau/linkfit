# Agile Project Management Report & Burndown Schedule

**Date**: June 1, 2026  
**Author**: Agile Project Manager (PM)  
**Target Directory**: `/Users/kamrannamazov/Desktop/linkfit/`  
**Audience**: Project CTO / Tech Lead, Product Owner, Engineering Groups  
**Status**: Active & Audit Complete  

---

## 1. Executive Summary

This report establishes a comprehensive Agile project audit and burndown schedule to coordinate the premium startup integration of the Linkfit platform. By analyzing the current deliverables and findings from the iOS and Backend Engineering Groups, we have identified several critical cross-functional dependencies, technical bottlenecks, and a major UI/UX blocker that disables the application's signature Dark Mode. 

To ensure a friction-free, production-ready release with zero placeholders and sub-50ms API latencies, we map out a structured **10-day Agile Coordination Burndown Schedule** starting **June 1, 2026** and ending **June 10, 2026**, along with actionable mitigation plans for all highlighted risks.

---

## 2. Subagent Milestone Audits & Readiness Status

We have audited the active subagent folders, planning files (`PROJECT.md`, `plan.md`), and specialized engineering reports. Below is the updated status of all audited milestones:

### 2.1. Backend Engineering Group

*   **Milestone 1: ESLint Styling Clean-up**  
    *   **Status**: **100% COMPLETE**  
    *   **Details**: 48 backend styling and type errors resolved across core module files, restoring full compliance with strict compilation and linting gates.
*   **Milestone 2: Logging, Env Strictness & Docker**  
    *   **Status**: **90% COMPLETE (Awaiting Final Remediation & Audit)**  
    *   **Identified Defects & Gotchas** (Source: `teamwork_preview_explorer_milestone_2_3/handoff.md`):
        1.  *Docker User Redundancy*: The `apps/api/Dockerfile` creates system group/user `nodeapp` (UID `1001`) but drops root privileges using `USER node` (the default user at UID `1000`), making `nodeapp` redundant.
        2.  *Directory Permissions Collision*: The unprivileged `node` user will encounter `EACCES: permission denied` when writing to `/data/uploads` volume because the volume directory is not pre-created or chowned to `node` in the container.
        3.  *Production Migration Crash*: The production compose file runs `npm run migrate:up`, which executes `node --env-file=.env ...`. However, the `.dockerignore` file correctly excludes `.env` from production. Node will throw a fatal `ENOENT` error and crash due to the missing `.env` file during boot.
*   **Milestone 3: Telemetry & Deep Health-check**  
    *   **Status**: **PLANNED** (Design Approved)  
    *   **Details**: Integration of `prom-client` with Fastify, exposure of `/metrics` (basic auth), and deep `/health/ready` multi-dependency probes (Postgres ping, Stripe `account.retrieve`, SMTP `transporter.verify`, and APNs provider state checks).
*   **Milestone 7: Specialized Backend Swarms (API Latency & Kysely DB Tuning)**  
    *   **Status**: **UNDER DESIGN / AUDIT COMPLETE**  
    *   **Identified Bottlenecks** (Sources: `api_performance_report.md` & `dba_optimization_report.md`):
        1.  *Redundant B2B DB Queries*: Pre-handler `partnerGuard` queries the DB on *every* request to verify partner roles and venue associations, limiting throughput.
        2.  *High Serialization Overhead*: Fastify uses slow dynamic Zod-based response parsing instead of fast pre-compiled `fast-json-stringify` output structures.
        3.  *Missing Spatial Index*: `users` table has no GiST index on home coordinates, forcing slow sequential scans during player searches (`social.service.ts:204`).
        4.  *Matchmaking Algorithmic Flaw*: `recommendPlayers` fetches the **200 newest sign-ups globally** before applying geographical/ELO scoring, completely excluding older local active players.
        5.  *UUID Array Foreign Key Anti-Pattern*: Relational IDs stored in arrays (`uuid[]`) in notifications and match scores destroy referential integrity.
        6.  *High-Frequency Chat Locking*: Synchronous DB trigger updates `conversations.last_message_at` on every message, creating row-level write contention during active group chats.
        7.  *Cast-Induced Partial Index Invalidation*: Overlap queries cast `status::text`, causing Postgres to ignore the partial index `bookings_active_window_idx`.
        8.  *Deployment Scale Bottlenecks*: In-memory rate-limiting, node-local SSE bus, and competing background worker `FeedWorker` timer sweeps prevent horizontal scaling.

### 2.2. iOS Engineering Group

*   **Milestone 8: Premium iOS Swarms (SwiftUI, Concurrency & Widgets)**  
    *   **Status**: **80% COMPLETE**  
    *   **Identified Defects & Gotchas** (Source: `ui_ux_audit_report.md` & `widget_extension_report.md`):
        1.  *Critical Light/Dark Mode Lock Bug*: `ThemeManager.swift` lines 22-25 hardcodes `resolved: ColorScheme? { .light }`, completely blocking the app's glowing dark mode palette despite theme options in settings.
        2.  *Spacing & Typographic Violations*: Core views (`HomeView.swift`, `MatchesView.swift`, `ProfileView.swift`) bypass `DSSpacing` and `DSType` tokens in favor of hardcoded magic sizes (e.g. 28pt spacings, 14pt card radii).
        3.  *Safe-Area Spacing Hacks*: Bottom tab bars are cleared using arbitrary spacers (`Spacer().frame(height: 80)`) instead of native safe-area modifiers.
        4.  *App Extensions Health*: Live activities and widgets are architected perfectly using native zero-drift rendering and local timeline nudges, keeping memory well within Apple's strict 30MB watchdog bounds.

---

## 3. iOS & Backend Dependencies Audit

We have analyzed the cross-functional dependencies between the iOS Group (Milestone 4/8) and Backend Group (Milestone 2/3/7). These dependencies represent critical coordination points:

```
┌────────────────────────────────────────────────────────┐
│               iOS GROUP (Milestone 8)                  │
│  - SwiftUI Layout & Motion    - Widgets & Live Activity│
│  - MVVM Client Bindings       - Theme & Settings       │
└───────────────────────────┬────────────────────────────┘
                            │
              CRITICAL CO-DEPENDENCY WINDOWS
                            │
┌───────────────────────────▼────────────────────────────┐
│             BACKEND GROUP (Milestones 2/3/7)           │
│  - Telemetry & Health Probe   - APNs Push Engine       │
│  - Booking & Stripe Splits    - B2B API Latency        │
└────────────────────────────────────────────────────────┘
```

1.  **APNs Push Notifications & Live Activity Track (M8 ↔ M7)**  
    *   *Description*: The iOS Live Activity (`MatchLiveActivity.swift`) is structurally optimized to handle score updates. However, live, real-world remote updates from the server-side scoring engine rely on the APNs push pipeline.
    *   *Co-Dependency*: Backend Milestone 7 must implement and deploy the APNs retry and push policies, while iOS Milestone 8 must supply valid APNs push tokens. This requires a shared push contract (payload under 4KB) and synchronized testing on a physical iOS device.
2.  **B2B Partner APIs & Client Integration (M8 ↔ M7)**  
    *   *Description*: The iOS matchmaking and matches discovery screens display active games and partner courts.
    *   *Co-Dependency*: Backend Milestone 7 optimizations under `/api/v1/partner/*` (such as in-memory TTL caching in `partnerGuard` and hybrid serialization) must be completed before load-testing client-side views. Severe backend latencies will cause MVVM view models to hang, leading to visual loading states or connection timeouts.
3.  **Split Checkout & Minor Unit Pricing (M8 ↔ M7)**  
    *   *Description*: The business strategy enforces booking splits using integer minor units (qəpik) via the payments service.
    *   *Co-Dependency*: Backend Milestone 7 (Stripe split-payment idempotency) must align perfectly with the client-side checkout views. The iOS app must display exact, non-rounded Azerbaijani qəpik values to prevent transaction mismatches or client-side calculation errors.
4.  **Deep Health-Checks & Widget Lifecycle (M8 ↔ M3)**  
    *   *Description*: The iOS Widget Cache (`SharedDefaults.swift`) triggers `reloadWidgetTimelines()` upon VM database writes, while the backend exposes `/health/ready`.
    *   *Co-Dependency*: The widget network footprint is minimized using a dual-cadence scheduling scheme. The client-side status dashboard should consume the backend's `/health/ready` JSON data to display system statuses (Postgres, Stripe, APNs) transparently, ensuring a premium "startup-grade" diagnostics page.

---

## 4. Premium Startup Integration Burndown Schedule
### Sprint Window: June 1 – June 10, 2026

We establish a coordinated **10-day burndown schedule** to eliminate all technical debt, resolve cross-functional dependencies, and ensure a pristine launch.

```
       100% ┼──────────────────────────────────────────────────────────
            │ █                                                       
        80% │   █                                                     
            │     █                                                   
        60% │       █ █                                               
            │           █                                             
        40% │             █ █                                         
            │                 █                                       
        20% │                     █ █                                 
            │                         █                               
         0% ┼─────────────────────────────█ ──── Progress Targets
             D1  D2  D3  D4  D5  D6  D7  D8  D9 D10
```

### Day-by-Day Coordinate Schedule

*   **Sprint Day 1 (June 1, 2026): Milestone 2 Remediation & Sign-off**  
    *   *Actions*:
        1.  Modify `apps/api/Dockerfile` to remove the redundant `nodeapp` user and pre-create `/data/uploads` with unprivileged ownership (`chown -R node:node`).
        2.  Update `apps/api/package.json` to add `--env-file`-free migration scripts (`migrate:up:prod` / `migrate:down:prod`).
        3.  Update `docker-compose.prod.yml` documentation to leverage these production migration commands.
        4.  Spawn a forensic auditor subagent and reviewers to verify the changes, and officially mark **Milestone 2 as DONE**.
*   **Sprint Day 2 (June 2, 2026): SwiftUI UI/UX Polish & Theme Unlocking**  
    *   *Actions*:
        1.  Apply Swift Patch 1 to `ThemeManager.swift` to resolve the Light Mode locking bug, allowing dynamic mapping of `resolved` to `mode.colorScheme`.
        2.  Apply Swift Patch 2 to `Radius.swift` to define card radii `DSRadius.xl = 20` and `DSRadius.xxl = 24`.
        3.  Apply Swift Patch 3 to `SpringPressStyle.swift` to enhance vertical scroll transitions with translation offsets.
        4.  Refactor hardcoded spacing magic numbers in `HomeView.swift`, `MatchesView.swift`, and `ProfileView.swift` to use uniform design system tokens.
*   **Sprint Day 3-4 (June 3-4, 2026): Milestone 3 Implementation (Telemetry & Deep Health)**  
    *   *Actions*:
        1.  Integrate `prom-client` and Fastify hooks for request logging counters and duration histograms (`http_requests_total`, `http_request_duration_seconds`).
        2.  Implement `GET /metrics` with basic credential auth.
        3.  Create the deep `/health/ready` route executing Postgres, Stripe, SMTP, and APNs provider probes, complete with robust unit tests.
        4.  Complete and sign-off **Milestone 3**.
*   **Sprint Day 5-6 (June 5-6, 2026): Milestone 7 Implementation - Database Tuning**  
    *   *Actions*:
        1.  Write a Kysely migration to add `users_earth_idx` (expression GiST index on `home_lat/lng`) to optimize player geographic searches.
        2.  Refactor the matchmaking candidates query (`matchmaking.service.ts`) to pre-filter spatially in Kysely/SQL rather than slicing `LIMIT 200` globally in TypeScript.
        3.  Remove the synchronous conversation bump trigger and replace it with dynamic subqueries or asynchronous queues to eliminate chat write locks.
        4.  Correct the overlap checking SQL in `bookings.service.ts` to remove the `status::text` cast and utilize the `bookings_active_window_idx` partial index.
*   **Sprint Day 7 (June 7, 2026): Milestone 7 Implementation - Latency & Horizon Scaling**  
    *   *Actions*:
        1.  Implement a process-local TTL cache map (60s lifetime) in B2B middleware `partnerGuard.ts` to prevent redundant role queries.
        2.  Configure Fastify `@fastify/compress` and the hybrid Zod-to-Fast-JSON serialization compiler to drop JSON formatting CPU times.
        3.  Register Redis-based stores for `@fastify/rate-limit` and `RealtimeBus` (SSE Pub/Sub), and add distributed locks (Redlock) in the `FeedWorker` loop.
        4.  Complete and sign-off **Milestone 7**.
*   **Sprint Day 8 (June 8, 2026): APNs & iOS App Extension Integration**  
    *   *Actions*:
        1.  Establish communication loop between the backend APNs push pipeline and the iOS host app.
        2.  Deploy the built backend container using the new multi-stage Alpine Dockerfile.
        3.  Verify zero-drift rendering and low-memory vector drawing in the Dynamic Island Live Activity under push-notification scoring triggers.
*   **Sprint Day 9 (June 9, 2026): Milestone 4 (Dual-Track E2E & Load Verification)**  
    *   *Actions*:
        1.  Trigger the full E2E test suite (`linkfit.e2e.test.ts`) against the production-ready API container.
        2.  Execute autocannon load testing suites against partner APIs to verify average response latencies are **sub-50ms**.
        3.  Conduct forensic integrity checks to ensure no ESLint suppressions (`/* eslint-disable */` or `// @ts-ignore`) were added.
*   **Sprint Day 10 (June 10, 2026): Product Acceptance & Master Sign-off**  
    *   *Actions*:
        1.  Conduct Product Owner (PO) final audit of features and Azerbaijani/English localizations.
        2.  Collect executive sign-off from CEO, PO, and Quality Swarms.
        3.  Freeze codebases and prepare for production droplet deployment.

---

## 5. Blocked Items, Risks, and Mitigations

Below is a detailed analysis of blocked items and key delivery risks, along with concrete project-management mitigations:

### 5.1. Blocked Items

1.  **Blocker**: **Application locked to Light Mode**  
    *   *Impact*: **CRITICAL**. Disables the signature high-contrast dark theme (deep ink canvas with glowing lime highlights). 
    *   *Cause*: Hardcoded `.light` value in `ThemeManager.swift`.
    *   *Mitigation*: Apply **Swift Patch 1** on Sprint Day 2 to map the value to `mode.colorScheme`.

### 5.2. Delivery Risks & Mitigations

1.  **Risk 1**: **APNs Remote Push Testing Failures on Simulator**  
    *   *Likelihood*: **High**  
    *   *Impact*: **Medium-High** (Prevents Live Activity testing)
    *   *Reason*: Standard iOS simulators do not support native APNs pushes without specialized configuration, and real-world pushes require valid Apple Developer Portal certificates.
    *   *Mitigation*: Implement a mock push trigger endpoint on the backend (`POST /api/v1/debug/push-trigger`) that simulates APNs payloads. On the iOS client, verify the Dynamic Island view model using a local mock service or custom plist updates. Physical device testing is scheduled for Day 8 with standard team certificates.
2.  **Risk 2**: **Database Migration Node Crash in Production Container**  
    *   *Likelihood*: **High**  
    *   *Impact*: **High** (Prevents DB startup in Docker environment)
    *   *Reason*: Dockerignore blocks the `.env` file from the container, which causes `node --env-file=.env` in the default migration script to crash.
    *   *Mitigation*: Implement a dedicated `migrate:up:prod` script that relies entirely on standard container environment variables without loading a local file.
3.  **Risk 3**: **Concurrency Competition in horizontally-scaled FeedWorker**  
    *   *Likelihood*: **Medium**  
    *   *Impact*: **Medium** (Relational races, duplicate database sweeps)
    *   *Reason*: If multiple replicas are spawned, each will run `FeedWorker` on Fastify's `onReady` hook, causing competing DB sweeps.
    *   *Mitigation*: Introduce `RUN_BACKGROUND_WORKER=false` as a default environment flag on standard server replicas, running the worker on exactly one designated replica pod. Alternatively, integrate a Redis-based distributed lock.

---

## 6. Forensic Integration Verification Plan

To verify that the integration is complete, secure, and conforms to the highest standards, the following verification commands must be executed on the final codebase:

### 6.1. Backend Compilation & Quality Gates
Execute these commands in the `apps/api` folder:
*   **TypeScript Check**: `npm run typecheck` (Must exit `0`)
*   **Linter Compliance**: `npm run lint` (Must exit `0` with **zero** warning/error count)
*   **Unit Tests**: `npm run test` or `vitest run` (Confirm config and logger tests pass cleanly)

### 6.2. Containerization and Boot Verification
Execute these commands at the workspace root:
*   **Docker Build**: `docker compose -f docker-compose.prod.yml build` (Confirm clean multi-stage Alpine build)
*   **Database Migrations**: `docker compose -f docker-compose.prod.yml exec api npm run migrate:up:prod` (Confirm migrations execute without `.env` file crash)
*   **Health probes**: `curl http://localhost:3000/health` and `curl -u metrics:pass http://localhost:3000/metrics` to verify telemetry registration.

### 6.3. Client Compilation & Token Checks
Open the Xcode workspace inside `apps/ios/` and verify:
*   **Build Target**: Select simulator or device and build all targets (including `LinkfitWidgets` and `LinkfitLiveActivity`). Verify compile exits with success.
*   **Localization Verification**: Select Settings inside the app, switch to Azerbaijani, and verify all keys in `Localizable.xcstrings` translate correctly in real-time.
