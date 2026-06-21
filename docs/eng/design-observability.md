# Design: Observability (logging, metrics, tracing, error tracking, alerting)

Status: Draft · Owner: Backend tech lead · Scope: api-laravel (LIVE), Horizon/Reverb
workers, Next web/admin/owner, Flutter client · Prod host: `142.93.166.170`
(`api.linkfit.az`, php8.4-fpm + nginx, Horizon + Reverb under systemd).

This doc is grounded in the current tree. It assumes the single-droplet, no-paid-SaaS
posture we ship on today and proposes a path that adds signal without adding a new
managed bill until traffic justifies it.

---

## 1. Current state (what actually exists)

**Error tracking — wired, dormant.**
- `sentry/sentry-laravel ^4.26` is installed; `config/sentry.php` is fully tuned
  (traces, profiles, breadcrumbs, `ignore_transactions => ['/up']`,
  `send_default_pii => false`).
- `bootstrap/app.php` calls `Integration::handles($exceptions)` *before* our custom
  render, so unhandled throwables are captured then re-rendered as the public
  envelope.
- BUT `.env.example` ships `SENTRY_LARAVEL_DSN=` (empty) and `SENTRY_TRACES_SAMPLE_RATE=`
  (null). In prod this means **Sentry is a no-op**: no errors, no traces leave the box.
  We are currently blind to unhandled 500s except via the on-disk log.

**Logging — local file, unstructured, no shipping.**
- `config/logging.php` default `stack` → `single` → `storage/logs/laravel.log`
  (`.env.example`: `LOG_STACK=single`, `LOG_LEVEL=debug`). On prod that file is written
  by `www-data`; nothing rotates it except Laravel's `single` driver (no rotation) and
  nothing ships it off-box. A `daily`, `papertrail`, `slack`, and `stderr` channel exist
  in config but none is selected.
- Application logging is essentially absent: a repo-wide grep finds **1** `Log::info`
  and **2** `Log::warning` calls in `app/`. There is no request-completion log line, no
  structured context, no per-request latency record.
- We DO have correlation primitives: `App\Http\Middleware\RequestId` mints/propagates
  `X-Request-Id` (honours inbound, falls back to UUID) and stamps it into
  `request->attributes['request_id']`; `App\Support\ErrorEnvelope` echoes that id into
  every error body. The id is **not** currently attached to log lines or Sentry events.

**Audit trail — exists, business-scoped.**
- `audit_log` table is written for mutating admin/partner/payment/moderation actions
  (e.g. `AdminOpsController.php:3365` insert; read/filtered at `:836`, `:3110`, `:3418`).
  This is a product/compliance log, *not* an ops telemetry stream. Keep them separate.

**Metrics — none, except built-ins.**
- `laravel/horizon ^5.47` ships queue throughput/runtime/wait snapshots (`config/horizon.php`
  `metrics` + `horizon:snapshot`) — visible only in the Horizon dashboard, not exported.
- `partner/metrics` and `admin/metrics` routes (`routes/api.php:248,298`) are **product**
  KPIs (business counts), not infra metrics. Do not conflate.
- No RED metrics (Rate/Errors/Duration), no process/PHP-FPM/queue depth time series, no
  `/metrics` scrape endpoint.

**Health — solid, the one bright spot.**
- `/up` (framework health, used by `bootstrap/app.php` `health:` and excluded from Sentry).
- `/api/v1/health` (`{ok:true}`) and `/api/v1/health/ready` (`select 1`) — `HealthController`.
- `spatie/laravel-health ^1.40`: `AppServiceProvider::boot` registers `DatabaseCheck`,
  `CacheCheck`, `RedisCheck`, `UsedDiskSpaceCheck` (warn 80 / fail 90), plus prod-only
  `DebugModeCheck(false)` and the boot-time secret/keyring/membership assertions.
  `HorizonCheck` is gated behind `HEALTH_CHECK_HORIZON=false` (off in prod today).
- Result store is `CacheHealthResultStore` (`HEALTH_CACHE_STORE=file`). Notifications
  default `enabled=true` in config but `.env.example` sets `HEALTH_NOTIFICATIONS_ENABLED=false`
  and `HEALTH_TO_ADDRESS=` empty → **no one is paged when a check fails.**
- `health.schedule.heartbeat_url` / `horizon.heartbeat_url` are supported but unset.

**Tracing — config present, unused.** Sentry tracing/profiling knobs exist but are off
(`traces_sample_rate` null, no DSN). No distributed trace context flows web→api→queue.

**Frontend/mobile — nothing.** No browser error capture in web/admin/owner; no crash
reporting in Flutter beyond store-level crash stacks.

**Net assessment:** we have excellent *plumbing* (RequestId, ErrorEnvelope, Sentry SDK,
spatie health) and almost no *activated signal*. The cheapest, highest-leverage work is
turning on and connecting what is already installed.

---

## 2. Target state

A single-droplet-friendly observability stack that answers, within minutes:
"is the API up, how fast, how many errors, which request, and who got paged?"

1. **Errors** → Sentry, with DSN set, environment/release tagged, `request_id`,
   `user.id`, route, and trace attached. Same DSN reused by web/admin/owner (browser)
   and Flutter (crashes) so a single incident correlates across tiers.
2. **Logs** → structured JSON to `stderr`/`daily`, every line carrying `request_id`,
   `user_id`, `route`, `status`, `duration_ms`, `ip`. Shipped off-box to a log sink
   (Grafana Loki self-hosted, or Better Stack/Papertrail managed — `papertrail` channel
   already stubbed). Rotated and retention-bounded.
3. **Metrics** → RED metrics for HTTP + queue depth/latency + FPM/process gauges, exposed
   on an internal-only `/metrics` (Prometheus text), scraped by a small Prometheus, viewed
   in Grafana. Horizon stays as the queue deep-dive.
4. **Tracing** → Sentry performance with a low sample rate (≤10%) and trace propagation
   from web→api→Horizon jobs, so a slow booking flow shows DB/Redis/HTTP spans.
5. **Alerting** → a real on-call channel (Telegram/Slack/email) fed by: spatie-health
   failures, Sentry issue alerts (new/regression/spike), Prometheus Alertmanager rules
   (error-rate, p95 latency, queue backlog, disk), and **dead-man heartbeats** so a fully
   down box still pages.

Hard constraints baked into the target:
- **No PII leakage.** Keep `SENTRY_SEND_DEFAULT_PII=false`; scrub bearer tokens, the
  `X-Linkfit-App-Key`, emails, phones, coordinates from logs and Sentry. Our security doc
  already forbids logging keys; extend that to all telemetry.
- **Telemetry endpoints are not public.** `/metrics`, Horizon, and spatie's health UI must
  sit behind the internal-key gate / CF firewall / bound to localhost — never on the
  public app surface.
- **Bounded cost on a 2 vCPU / 8 GB box.** Sampling, retention caps, and `ignore_transactions`
  keep CPU/disk in check.

---

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Activate Sentry as the error + APM backbone.** Set DSN, `SENTRY_ENVIRONMENT=production`, `SENTRY_RELEASE` per deploy. | SDK + config already in tree; zero new infra; cross-tier correlation by reusing one project. |
| D2 | **Attach `request_id`, `user.id`, route via a `configureScope` in a middleware/listener; keep `send_default_pii=false`.** | RequestId already exists; this is the missing link between envelope, logs, and Sentry. |
| D3 | **Switch prod logging to structured JSON via `stderr` (captured by systemd/journald) or `daily` + a `JsonFormatter`, with a global Monolog processor injecting `request_id`/`user_id`/route.** Keep `LOG_LEVEL=info` in prod (not `debug`). | `single` never rotates and `debug` is noisy/PII-risky; JSON is grep/ship-able; processor centralizes context. |
| D4 | **Add a single request-completion log line** (status, duration_ms, route, bytes) in a terminating middleware — the one structured "access log" we lack. | Gives RED data even before Prometheus; cheap; one place to scrub. |
| D5 | **Self-host Prometheus + Grafana + Loki (or Better Stack managed) on the same box / a sidecar.** Expose `/metrics` behind `internal.key` or localhost-only. | We already run multiple systemd services; no per-event SaaS bill; Loki ingests the JSON logs. Managed is the fallback if ops bandwidth is thin. |
| D6 | **Turn on spatie-health notifications and add dead-man heartbeats** (`HEALTH_NOTIFICATIONS_ENABLED=true`, a Telegram/Slack webhook, `HORIZON_HEARTBEAT_URL`, `SCHEDULE_HEARTBEAT_URL`, set `HEALTH_CHECK_HORIZON=true`). | Checks exist but page nobody; heartbeat catches total-down where in-box alerts can't fire. |
| D7 | **Expose a scheduler/queue heartbeat to an external dead-man (cronitor/healthchecks.io free tier or a CF Worker).** | A crashed Horizon or stuck scheduler is our highest-impact silent failure (push, reminders, media cleanup all run on schedule). |
| D8 | **Reuse the same Telegram channel we already operate for alert delivery**, with Sentry/Alertmanager → webhook. | Lowest-friction on-call for a small team; no new tool to learn. |
| D9 | **Browser SDK in web/admin/owner + Flutter Sentry**, sampled, with the same `request_id` propagated via the existing `X-Request-Id` header. | One incident, one trace, from tap to DB. |
| D10 | **Standardize a deploy marker**: set `SENTRY_RELEASE` to the git SHA and send a Sentry "deploy" on each rsync deploy. | Regressions get pinned to a release; mean-time-to-cause drops sharply. |

Sampling/retention starting points: `SENTRY_TRACES_SAMPLE_RATE=0.1`,
`SENTRY_PROFILES_SAMPLE_RATE=0.1`, errors at 1.0; logs 14–30 day retention; Prometheus 15d;
Loki 14d. Revisit once we see real volume (≈51 users today → headroom is large).

---

## 4. Risks & mitigations

- **PII / secret leakage into telemetry.** Bearer tokens, `X-Linkfit-App-Key`, emails,
  phone, geo. → `send_default_pii=false` (already), a `before_send` scrubber + Monolog
  processor redaction list, never log request bodies for auth/payment/messaging routes,
  keep `sql_bindings` off (already `false`).
- **Cost / resource pressure on a 2 vCPU box.** Sentry tracing + Prometheus + Loki + Grafana
  on the same host can starve php-fpm (`pm.max_children=30`). → low sample rates, scrape
  interval ≥30s, Loki/Prometheus memory caps, or push the TSDB/log sink to a tiny separate
  droplet / managed tier. Load-test before/after.
- **Alert fatigue / noisy pages.** → start with a *small* rule set (5xx rate, p95, queue
  backlog, disk, dead-man), use spatie's `throttle_notifications_for_minutes=60`, group
  Sentry issues, route warnings to a digest not a page.
- **Activating Sentry surfaces a 500 backlog.** First DSN turn-on will likely reveal real
  errors we've been silently swallowing via ErrorEnvelope's `report($e)` → 'Internal server
  error'. → expect a triage spike; that's the point, budget a day.
- **Telemetry endpoints exposed publicly = recon surface.** `/metrics` leaks route names,
  Horizon leaks queue internals. → bind localhost / `internal.key` gate / CF-only firewall
  (we already restrict 80/443 to Cloudflare ranges; reuse that). Add to the security smoke
  test: `/metrics` and the health UI must 403 from a public origin.
- **opcache deploy gotcha hides telemetry config changes.** `validate_timestamps=0` means
  `.env`/config edits need `php artisan config:cache` + `systemctl reload php8.4-fpm`. →
  fold into the deploy runbook; verify `SENTRY_RELEASE` shows the new SHA post-deploy.
- **Trace-context spoofing.** Honouring inbound `X-Request-Id` / trace headers from
  untrusted clients lets an attacker poison correlation. → only continue trust from the CF
  edge / our own frontends (origin-checked); treat inbound ids as untrusted labels, never
  as security identifiers (`strict_trace_continuation` stays conservative).
- **Log volume from the new access line.** Every request = a line. → `info` level, sampling
  for health/asset routes, exclude `/up` and `/health*` from the access log.

---

## 5. Step-by-step plan

**Phase 0 — Turn on what we own (½ day, no new infra).**
1. Set in prod `.env`: `SENTRY_LARAVEL_DSN`, `SENTRY_ENVIRONMENT=production`,
   `SENTRY_RELEASE=<git-sha>`, `SENTRY_TRACES_SAMPLE_RATE=0.1`,
   `SENTRY_PROFILES_SAMPLE_RATE=0.1`, keep `SENTRY_SEND_DEFAULT_PII=false`.
2. `php artisan config:cache && systemctl reload php8.4-fpm && systemctl restart linkfit-horizon`.
3. Trigger a test exception in staging; confirm event lands with `request_id`.

**Phase 1 — Correlate (1 day).**
4. Add a small middleware/listener that, after `RequestId`, calls
   `Sentry::configureScope()` to set `request_id`, `user.id` (post-JWT), and route; and a
   Monolog `processor` injecting the same into every log record.
5. Switch prod logging: `LOG_STACK=stderr` (JSON via `LOG_STDERR_FORMATTER=…JsonFormatter`)
   or `daily` + JSON, `LOG_LEVEL=info`, `LOG_DAILY_DAYS=14`. Verify journald captures FPM
   `stderr`.
6. Add the terminating "access log" line (status, `duration_ms`, route, ip, bytes), with
   `/up` + `/health*` + static excluded, and the redaction list applied.

**Phase 2 — Alert on down (1 day).**
7. `HEALTH_NOTIFICATIONS_ENABLED=true`, set `HEALTH_SLACK_WEBHOOK_URL` *or* wire the
   Telegram channel; set `HEALTH_TO_ADDRESS` for mail fallback (Gmail API transport works).
8. `HEALTH_CHECK_HORIZON=true`; set `HORIZON_HEARTBEAT_URL` + `SCHEDULE_HEARTBEAT_URL` to a
   free external dead-man (healthchecks.io / CF Worker). Schedule a `php artisan schedule:run`
   liveness ping.
9. Configure Sentry issue alerts: new-issue, regression, and event-spike → same on-call
   channel.

**Phase 3 — Metrics & dashboards (2–3 days).**
10. Add a Prometheus exporter: a guarded `/internal/metrics` (behind `internal.key`,
    localhost-only) emitting HTTP RED counters/histograms (from the access-log middleware),
    queue depth/oldest-job age (from Horizon/Redis), and process/FPM gauges.
11. Stand up Prometheus + Grafana (+ Loki for the JSON logs) — same box with memory caps, or
    a small sidecar droplet. Scrape interval 30s.
12. Build dashboards: API RED, queue health, DB/Redis, disk; wire Alertmanager rules
    (5xx>2%/5m, p95>800ms/10m, queue backlog>N, disk>85%) → on-call channel.

**Phase 4 — Frontend & mobile + deploy markers (1–2 days).**
13. Add Sentry browser SDK to web/admin/owner and Sentry Flutter, sampled, sharing the
    project; propagate `X-Request-Id` from the client so traces stitch tap→DB.
14. In the deploy script, emit a Sentry release + deploy with the git SHA on each rsync
    deploy; add a smoke check that `/metrics` and Horizon/health UIs 403 from a public
    origin.

**Phase 5 — Tune (ongoing).**
15. After a week of real data, re-tune sample rates, retention, and alert thresholds to the
    actual error/latency/volume baseline; document the on-call runbook (where to look,
    `request_id` → Sentry/Loki lookup, common alerts and first response).

---

## Appendix — file references

- `bootstrap/app.php` — Sentry `Integration::handles`, RequestId/throttle/origin/key
  middleware stack, `health: '/up'`.
- `app/Http/Middleware/RequestId.php` — correlation id source (reuse for all telemetry).
- `app/Support/ErrorEnvelope.php` — `report($e)` swallow point; the 500s Sentry will surface.
- `config/sentry.php` — fully-tuned, DSN/sample-rate the only gaps.
- `config/logging.php` — `single` default (no rotation); `daily`/`stderr`/`papertrail`/`slack`
  channels available.
- `config/health.php` + `app/Providers/AppServiceProvider.php::boot` — spatie checks,
  notifications off by default, heartbeat URLs unset.
- `config/horizon.php` — `metrics`/`snapshot` (queue telemetry, dashboard-only).
- `routes/api.php:57-58,108` — `/health`, `/health/ready`, `realtime/health`.
- `routes/console.php` — scheduled `push:process` (1m), `ops:send-reminders` (5m),
  `ops:cleanup-media` (daily 03:20) — the jobs a scheduler dead-man must protect.
- Prod infra: `142.93.166.170`, php8.4-fpm + nginx, Horizon/Reverb systemd, CF-only
  80/443 firewall, opcache `validate_timestamps=0` (reload required after config changes).
