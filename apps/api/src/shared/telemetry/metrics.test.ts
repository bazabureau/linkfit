import { describe, it, expect, beforeEach } from "vitest";
import { createTelemetry, type TelemetryHandle } from "./metrics.js";

describe("createTelemetry", () => {
  let t: TelemetryHandle;

  beforeEach(() => {
    t = createTelemetry();
  });

  it("registers all expected metric names", async () => {
    const text = await t.registry.metrics();
    const names = [
      "http_requests_total",
      "http_request_duration_seconds",
      "http_requests_in_flight",
      "linkfit_auth_attempts_total",
      "linkfit_games_created_total",
      "linkfit_games_completed_total",
      "linkfit_payment_intents_total",
      "linkfit_db_pool_size",
    ];
    for (const n of names) {
      expect(text).toContain(`# HELP ${n}`);
      expect(text).toContain(`# TYPE ${n}`);
    }
  });

  it("includes default Node.js metrics under nodejs_ prefix", async () => {
    const text = await t.registry.metrics();
    expect(text).toContain("nodejs_eventloop_lag_seconds");
    expect(text).toContain("nodejs_heap_size_total_bytes");
  });

  it("tags every series with service=linkfit-api", async () => {
    t.http.requestsTotal.inc({ method: "GET", route: "/health", status_code: "200" });
    const text = await t.registry.metrics();
    expect(text).toMatch(/service="linkfit-api"/);
  });

  it("increments business counters by label", async () => {
    t.business.authAttempts.inc({ method: "password", result: "ok" });
    t.business.authAttempts.inc({ method: "password", result: "ok" });
    t.business.authAttempts.inc({ method: "apple", result: "fail" });
    const text = await t.registry.metrics();
    expect(text).toMatch(/linkfit_auth_attempts_total\{[^}]*method="password"[^}]*result="ok"[^}]*\} 2/);
    expect(text).toMatch(/linkfit_auth_attempts_total\{[^}]*method="apple"[^}]*result="fail"[^}]*\} 1/);
  });

  it("observes histogram durations into buckets", async () => {
    t.http.requestDurationSeconds.observe({ method: "GET", route: "/api/v1/games" }, 0.05);
    t.http.requestDurationSeconds.observe({ method: "GET", route: "/api/v1/games" }, 0.5);
    const text = await t.registry.metrics();
    expect(text).toContain("http_request_duration_seconds_bucket");
    expect(text).toContain("http_request_duration_seconds_count");
    expect(text).toContain("http_request_duration_seconds_sum");
  });

  it("tracks in-flight requests via gauge", async () => {
    t.http.requestsInFlight.inc();
    t.http.requestsInFlight.inc();
    t.http.requestsInFlight.dec();
    const text = await t.registry.metrics();
    expect(text).toMatch(/http_requests_in_flight\{[^}]*\} 1/);
  });
});
