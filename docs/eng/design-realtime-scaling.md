# Realtime (Reverb) Architecture & Scaling

Status: Draft for review
Owner: Backend / Platform
Last updated: 2026-06-21
Scope: Laravel Reverb WebSocket layer powering chat (messages, typing, conversation-updated). Grounded in the live code at `apps/api-laravel`, the Flutter client at `LINKFITAPP/lib/core/realtime/reverb_client.dart`, the web client at `apps/web/src/lib/realtime.ts`, and prod server `142.93.166.170`.

---

## 1. Current state

### 1.1 What ships realtime today
Exactly three broadcast events exist, all `ShouldBroadcastNow` (synchronous publish, no queue dependency):

| Event | File | Channel(s) | `broadcastAs` |
|---|---|---|---|
| `MessageSent` | `app/Events/MessageSent.php` | `private-conversation.{id}` | `message.sent` |
| `ConversationTyping` | `app/Events/ConversationTyping.php` | `private-conversation.{id}` | `conversation.typing` |
| `ConversationUpdated` | `app/Events/ConversationUpdated.php` | fan-out `private-user.{id}` per participant | `conversation.updated` |

Producers: `MessagingController` (`apps/api-laravel/app/Http/Controllers/Api/MessagingController.php:561,633,646`) and `StoriesController` (story replies, `:255-256`).

### 1.2 Authorization model
- Channel auth lives in `routes/channels.php`. `conversation.{conversationId}` is gated by an active row in `conversation_participants` (`left_at IS NULL`); `user.{userId}` requires `$user->id === $userId`. This is correct and IDOR-safe.
- `/broadcasting/auth` is registered in `bootstrap/app.php` via `->withBroadcasting(...)` and explicitly runs the **same middleware stack as the API** before the closure: `RequestId → throttle:api → BrowserOriginGuard → ApiKeyGuard → jwt → SecurityHeaders`. So the auth route is behind the `X-Linkfit-App-Key` gate and JWT, not the public API prefix. Good — this is easy to miss and was done right.
- The WebSocket handshake itself (`wss://api.linkfit.az/app/{appKey}`) is **not** behind the app-key gate (it can't be — it's a raw upgrade). The Reverb app key (`1ucpujv2zolv9jd7sawm`) is public by design; security rests entirely on the per-private-channel `/broadcasting/auth` check above.

### 1.3 Infrastructure (prod 142.93.166.170)
- Single droplet, 2 vCPU / 8 GB, Ubuntu 24.04. API served by **php8.4-fpm** (nginx fastcgi → `/opt/linkfit-api-laravel/public`), `pm.max_children=30`, opcache `validate_timestamps=0`.
- `linkfit-reverb.service` runs `php artisan reverb:start` (single process, default `:8080`), `linkfit-horizon.service` runs queue workers. Both from `/opt/linkfit-api-laravel`.
- `.env` (prod): `BROADCAST_CONNECTION=reverb`, `REVERB_APP_KEY=1ucpujv2zolv9jd7sawm`, `REDIS_CLIENT=predis`, Redis localhost-only. nginx proxies `api.linkfit.az/app/*` → `127.0.0.1:8080`.
- No `config/broadcasting.php` or `config/reverb.php` is published in the repo — the framework/package vendor defaults are used (`vendor/laravel/framework/config/broadcasting.php`, `vendor/laravel/reverb/config/reverb.php`). All tuning is env-driven.
- ufw allows 80/443 **from Cloudflare ranges only**; Cloudflare proxies the WS (must stay enabled for WSS to terminate at the edge).

### 1.4 Failure isolation (this is the strong part — preserve it)
Every broadcast call is doubly guarded so a Reverb outage can never fail a write:
1. A `broadcastingEnabled()` short-circuit — `MessagingController.php:665` — skips publishing entirely when `broadcasting.default` is `log`/`null`/`''`.
2. The publish is wrapped in `try { broadcast(...) } catch (\Throwable $e) { report($e); }` (`:560-564`, `:632-636`, `:645-649`).

Both clients treat the socket as best-effort and **always keep a polling fallback** (Flutter doc comment `reverb_client.dart:30-32`; web `getEcho()` returns `null` on failure and callers poll). Reconnect uses capped exponential backoff: Flutter `500ms * 2^(attempt-1)`, clamped `[500ms, 30s]`, attempts clamped to 6 (`reverb_client.dart` `_scheduleReconnect`); 20s app-level ping keeps the socket warm. Result: realtime is a latency optimization, not a correctness dependency. This is the right posture for a single-node Reverb.

### 1.5 Local vs prod config drift (note, not a prod bug)
The repo `.env`/`.env.example` carry dev values (`APP_ENV=local`, `QUEUE_CONNECTION=sync`, `BROADCAST_CONNECTION=log`). Prod overrides these. Anyone reading the repo will incorrectly conclude realtime is off; documented here to avoid that trap. There is no prod regression — `BROADCAST_CONNECTION=reverb` is set on the box.

---

## 2. Target

A realtime layer that:
- **R1 — Survives a single Reverb process death** without dropping the whole fleet's chat into polling-only for the duration of a manual restart.
- **R2 — Scales horizontally** behind the app-server beyond what one `reverb:start` process can hold (rule of thumb: one Reverb process saturates ~1 CPU on connection churn / fan-out; today it shares a 2-vCPU box with php-fpm + Horizon + Redis).
- **R3 — Is observable**: we can answer "how many sockets are connected", "are publishes landing", "is the box CPU-bound on Reverb" without SSH guesswork.
- **R4 — Keeps the failure-isolation guarantees of §1.4** unchanged. Realtime stays best-effort; clients keep polling fallback.
- **R5 — Has a documented, repeatable deploy** that reloads Reverb without dropping every socket unnecessarily, and a safe rollback.

Explicit non-goals for this phase: presence channels, read receipts over WS, message ordering guarantees over the socket (DB + polling remains source of truth), multi-region.

---

## 3. Decisions

### D1 — Keep Reverb (do not move to Pusher/Ably/Soketi)
`pusher/pusher-php-server` is already a dep but only as the server-side broadcaster client surface; the transport is self-hosted Reverb. Reverb is first-party, the clients (`laravel-echo` + `pusher-js` on web, a hand-rolled Pusher-protocol client on Flutter) already speak the protocol, and self-hosting keeps chat data off a third party. The cost/latency case for Ably/Pusher-hosted doesn't justify a migration at current scale (~tens of users). **Decision: stay on Reverb.**

### D2 — Introduce a Redis scaling backend for Reverb (enables horizontal scale)
Reverb's default `array`/in-memory connection scope means each process only knows its own connections; running two `reverb:start` processes would split the channel population and break fan-out across them. Reverb supports a **Redis pub/sub scaling driver** (`REVERB_SCALING_ENABLED=true`) that lets N Reverb processes share channel state via the Redis we already run locally. **Decision: enable Redis scaling before adding a second process.** Until then, stay single-process (adding a 2nd process without it is actively wrong).

### D3 — Run Reverb as a horizontally-scalable systemd unit set, fronted by nginx upstream
Move from one `linkfit-reverb.service` to a small pool (`reverb@8080`, `reverb@8081`) once D2 is in, each on its own port, with nginx `upstream` load-balancing `/app/*` (sticky by `ip_hash` to keep a client on one process across the lifetime of a socket — not required for correctness with D2, but reduces churn). **Decision: templated systemd unit (`reverb@.service`) + nginx upstream block.**

### D4 — Publishes stay `ShouldBroadcastNow`
Chat must feel instant; routing publish through Horizon would add queue latency and a new failure mode (queue backlog → delayed messages) for no benefit, since the publish is a fast local Redis/HTTP call. The existing try/catch already prevents publish failure from affecting the write. **Decision: do not queue the broadcast events.** (Revisit only if publish latency ever shows up in request p95.)

### D5 — Observability via Reverb's pulse/metrics + a synthetic check
Reverb exposes connection metrics; wire them into a lightweight check (`reverb:start` health + a periodic publish-and-listen canary) and surface Sentry breadcrumbs on the existing `report($e)` path. **Decision: add a realtime canary to the existing health tooling rather than build a dashboard now.**

### D6 — Don't publicly couple to `pusher-js` quirks we can't control
The web client relies on Pusher's double-JSON-encoding of `data` (handled in Flutter `_decodeData`); keep that contract pinned by a contract test so a `pusher-js`/`laravel-echo` bump can't silently break decoding. **Decision: add a frame-decode contract test (web + Flutter already have contract suites; extend them).**

---

## 4. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| K1 | Single Reverb process dies; all chat falls back to polling until manual/systemd restart. Polling masks it, so it can go unnoticed for hours. | Med | Med | D2+D3 multi-process; `Restart=always` + `WatchdogSec` on the unit; D5 canary alerts. |
| K2 | Reverb saturates a CPU on the shared 2-vCPU box and starves php-fpm/Horizon (chat success path uses fpm). | Low-Med (grows with users) | High | Pin Reverb to dedicated core via `CPUAffinity`/`cgroup`, or move Reverb to its own droplet once connection count climbs; D5 to see it coming. |
| K3 | Adding a 2nd Reverb process **without** D2 → split-brain fan-out (users on process A never get messages published from a request that hit process B). | High if D3 done before D2 | High | Hard ordering: D2 (Redis scaling) is a prerequisite gate for D3. CI/runbook check. |
| K4 | `REVERB_APP_KEY` is shared by web + Flutter + any future client; rotating it is a coordinated, breaking change (all clients have it as a fallback constant in source — `realtime.ts:9`, Flutter `app_config.dart`). | Low | Med | Treat key as public (it already is); rotation requires staged client release. Document that it's not a secret and gives no access without `/broadcasting/auth`. |
| K5 | nginx WS upstream misconfig (missing `Upgrade`/`Connection` headers, short `proxy_read_timeout`) silently drops idle sockets; clients reconnect-storm. | Med | Low-Med | Set `proxy_read_timeout 3600s`, proper upgrade headers; 20s app ping already keeps sockets warm under that. |
| K6 | Cloudflare WS proxying: free-tier WS timeouts / disconnects on idle. | Med | Low | App-level 20s ping (already present) stays under CF idle thresholds; backoff handles drops gracefully. |
| K7 | `ConversationUpdated` fans out one publish per participant on `user.{id}` channels — N publishes per event. For large group chats this multiplies publish volume. | Low (groups small today) | Low | Acceptable now; if group sizes grow, consider a single shared `private-conversation.{id}.meta` channel instead of per-user fan-out. |
| K8 | Reverb scaling Redis shares the instance with cache (`REDIS_CACHE_DB=1`) + Horizon queues; a Redis stall hits all three. | Low | Med | Reverb pub/sub is low-footprint; keep on its own logical DB; monitor Redis with existing health tooling. |

---

## 5. Step-by-step plan

Ordering is load-bearing: **D2 must precede D3** (see K3).

### Phase 0 — Lock in current behavior (no infra change)
1. Add a contract test asserting `broadcastAs()` names + `broadcastWith()` shapes for all three events (so a refactor can't silently change the wire contract the clients parse). Extend the existing contract suites referenced in the session's mobile work.
2. Add a frame-decode test on the Flutter `_decodeData` path (double-encoded `data`) — covers D6/K-D6.
3. Document in `.env.example` a commented block (`# prod overrides:`) listing the real `BROADCAST_CONNECTION=reverb` + `REVERB_*` keys so the repo stops implying realtime is off (§1.5). **Doc/comment only — do not change committed dev defaults.**

### Phase 1 — Resilience of the single process (cheap, high value)
4. Harden `linkfit-reverb.service`: `Restart=always`, `RestartSec=2`, `StartLimitIntervalSec`/`StartLimitBurst` to avoid crash-loop spin, and a systemd watchdog if feasible. Verify with a kill test on a staging box.
5. Add the D5 canary: a scheduled command (Horizon-scheduled or systemd timer) that opens a WS, subscribes to a throwaway private channel authorized for a service user, publishes a sentinel `MessageSent`-style event, and asserts round-trip < N ms; report failures to Sentry via the existing `report()` path. Alert on K1.
6. nginx review: confirm the `/app/*` location sets `Upgrade`/`Connection: upgrade`, `proxy_http_version 1.1`, and `proxy_read_timeout 3600s` (K5).

### Phase 2 — Horizontal readiness (do before you actually need it)
7. Enable Reverb Redis scaling: set `REVERB_SCALING_ENABLED=true` pointing at the existing local Redis (own logical DB, not the cache DB). Deploy to staging, run the canary, confirm publish from an fpm request reaches a socket on the **same** single process (no behavior change yet — this is the prerequisite, K3).
8. Template the unit: `reverb@.service` taking the port as the instance, start `reverb@8080` only (still one process). Confirm parity.

### Phase 3 — Scale out (only when metrics justify)
9. Start `reverb@8081`; add nginx `upstream reverb { server 127.0.0.1:8080; server 127.0.0.1:8081; ip_hash; }` and point `/app/*` at it. Validate cross-process fan-out with the canary subscribing on one port while publishing lands (via Redis) to a socket on the other (K3 gate proven).
10. Decide K2: if Reverb + fpm contend for CPU, either `CPUAffinity`-pin Reverb or split it to a dedicated small droplet (Reverb is stateless given D2 — it can move freely; only nginx upstream + ufw/CF ranges change).

### Phase 4 — Operational hardening
11. Document the deploy runbook: code rsync → `systemctl reload php8.4-fpm` (unchanged) → `systemctl restart 'reverb@*'` (staggered, one port at a time so half the fleet stays connected) → `systemctl restart linkfit-horizon`. Note that a Reverb restart drops sockets but clients reconnect with backoff (§1.4) — staggering halves the blast radius.
12. Rollback: Reverb is config-only here. Revert env (`REVERB_SCALING_ENABLED=false`) + stop the extra instance + restore nginx to a single `proxy_pass 127.0.0.1:8080`. Because realtime is best-effort, even a full Reverb outage degrades to polling, never to data loss — the rollback has no correctness risk.

### Acceptance
- R1: kill `reverb@8080` with `reverb@8081` up → web/Flutter sockets reconnect to the survivor; chat stays realtime (canary green within one backoff cycle).
- R2: two processes serve sockets; a message published from an fpm request reaches a subscriber pinned to the other process.
- R3: canary + Sentry surface a forced outage within one scrape interval.
- R4: `broadcastingEnabled()` + try/catch guards unchanged; a forced Reverb-down test still returns 2xx on message send with the message persisted.

---

## Appendix — key file references
- Events: `apps/api-laravel/app/Events/{MessageSent,ConversationTyping,ConversationUpdated}.php`
- Producers/guards: `apps/api-laravel/app/Http/Controllers/Api/MessagingController.php:559-668`, `StoriesController.php:255-256`
- Channel auth: `apps/api-laravel/routes/channels.php`
- Auth-route middleware: `apps/api-laravel/bootstrap/app.php` (`->withBroadcasting`)
- Flutter client: `LINKFITAPP/lib/core/realtime/reverb_client.dart`; config `LINKFITAPP/lib/core/config/app_config.dart:54-66`
- Web client: `apps/web/src/lib/realtime.ts`
- Prod facts: server `142.93.166.170`, `linkfit-reverb.service` + `linkfit-horizon.service` in `/opt/linkfit-api-laravel`, `BROADCAST_CONNECTION=reverb`, `REVERB_APP_KEY=1ucpujv2zolv9jd7sawm`, nginx `api.linkfit.az/app/* → 127.0.0.1:8080`.
