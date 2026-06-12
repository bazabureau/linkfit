import Foundation
#if canImport(PostHog)
import PostHog
#endif
import os.log

// =============================================================================
// ANALYTICS FACADE
// -----------------------------------------------------------------------------
// Thin call-site facade over the PostHog iOS SDK. Three contracts the rest of
// the app depends on:
//
//   1. **Safe with no API key.** `start(apiKey:host:)` with a nil/empty key
//      is a no-op — every subsequent call short-circuits. This lets dev/CI
//      builds boot without configuring PostHog. The same is true when the
//      `PostHog` module isn't linked at all (the package is opt-in via
//      SwiftPM and we guard with `canImport`).
//
//   2. **Typed events only.** `track(_:)` accepts an `AnalyticsEvent` enum
//      so the schema lives in one place and call sites can't drift. A
//      legacy free-form `track(_:_:)` is kept for the in-house buffer (see
//      `AnalyticsClient.swift`) so existing call sites don't break — we
//      forward those into PostHog too when the SDK is configured.
//
//   3. **PII boundary.** `identify(userId:traits:)` only sends the
//      server-side UUID and explicitly enumerated traits. The call site
//      MUST NOT pass email or phone — strip those at the boundary. The
//      backend hashes emails before they reach PostHog; the iOS layer
//      simply never sees the raw value.
//
// The release version is read from the bundle; the host is read from the
// `POSTHOG_HOST` Info.plist value with `https://app.posthog.com` as the
// fallback. Production builds substitute both keys at xcodegen time from
// the `$(POSTHOG_API_KEY)` / `$(POSTHOG_HOST)` env vars — see
// `project.yml`.
// =============================================================================

/// Call-site entry point for analytics. All methods are no-ops when the SDK
/// has not been configured with a non-empty API key, so callers don't need
/// to special-case dev/CI builds.
enum Analytics {
    private static let log = Logger(subsystem: "az.linkfit.app", category: "Analytics")

    /// Sentinel flipped after the first successful `start(...)` call.
    /// Subsequent `track`/`identify`/`reset` calls short-circuit when this
    /// stays false (no API key or SDK not linked).
    nonisolated(unsafe) private static var isStarted: Bool = false

    // MARK: - Bootstrap

    /// Initialize the PostHog client. Idempotent — a second call with the
    /// same key returns immediately. A nil or empty `apiKey` makes every
    /// subsequent call a no-op, so this is safe to invoke from
    /// `LinkfitApp.init` without a configured project.
    ///
    /// - Parameters:
    ///   - apiKey: PostHog project API key. Read from the `POSTHOG_API_KEY`
    ///     Info.plist value at the call site. Nil/empty → no-op.
    ///   - host: PostHog cloud host. Read from `POSTHOG_HOST` with
    ///     `https://app.posthog.com` as the default.
    static func start(apiKey: String?, host: String?) {
        guard !isStarted else { return }
        let trimmedKey = apiKey?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmedKey.isEmpty else {
            log.info("PostHog disabled — no API key configured")
            return
        }

        #if canImport(PostHog)
        let resolvedHost: String = {
            let trimmedHost = host?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return trimmedHost.isEmpty ? "https://app.posthog.com" : trimmedHost
        }()

        // PostHog 3.x renamed `apiKey` → `projectToken` for the init; the
        // overload with both fields takes `(projectToken:host:)`. We pass
        // the trimmed key + resolved host so a custom EU / self-hosted
        // instance can be wired via `POSTHOG_HOST` without code changes.
        let config = PostHogConfig(projectToken: trimmedKey, host: resolvedHost)
        // Sessions + session replay are off by default — turn on later
        // when we're ready to deal with the privacy review. Autocapture
        // is left at the SDK default (off on iOS today) for the same
        // reason.
        config.captureScreenViews = false
        config.captureApplicationLifecycleEvents = true
        // We control flushes ourselves on background/foreground via the
        // SDK's default batching policy (every 30s / 20 events). No need
        // to override here.
        PostHogSDK.shared.setup(config)
        isStarted = true
        log.info("PostHog initialized")
        #else
        // Package not linked — leave `isStarted` false so every subsequent
        // call is a clean no-op. Don't log an error: the brief explicitly
        // permits this build configuration in dev/CI.
        _ = trimmedKey
        #endif
    }

    // MARK: - Identification

    /// Tag subsequent events with a stable user identifier. Call this once
    /// after sign-in or registration succeeds; the `userId` is the
    /// server-side UUID, never an email or phone number.
    ///
    /// Traits map onto PostHog person properties — keep them to a small,
    /// auditable set (locale, signup_method, etc.). NEVER pass `email` or
    /// `phone` here — the backend is responsible for hashed email
    /// properties; the iOS surface never sees raw values.
    static func identify(userId: String, traits: [String: Any] = [:]) {
        let cleanedId = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanedId.isEmpty else { return }

        #if canImport(PostHog)
        if isStarted {
            if traits.isEmpty {
                PostHogSDK.shared.identify(cleanedId)
            } else {
                PostHogSDK.shared.identify(cleanedId, userProperties: traits)
            }
        }
        #endif

        // Mirror the distinct_id into the in-house buffer so events
        // queued by `AnalyticsClient` carry the same identifier even
        // when PostHog is not configured (dev/CI builds still want
        // events tagged with the right user id for the server-side
        // `/api/v1/analytics/events` consumer).
        AnalyticsClient.shared.assumeIdentify(cleanedId)
    }

    // MARK: - Tracking — typed

    /// Emit a typed event. The enum case enforces the property schema so
    /// the dashboard never sees a malformed payload from this layer.
    ///
    /// Also mirrors into the legacy in-house buffer so server-side
    /// analytics (which currently consumes `/api/v1/analytics/events`)
    /// continue to receive the same stream — once we're confident in
    /// PostHog as the single source of truth this mirror can drop.
    static func track(_ event: AnalyticsEvent) {
        let name = event.name
        let properties = event.properties

        #if canImport(PostHog)
        if isStarted {
            PostHogSDK.shared.capture(name, properties: properties)
        }
        #endif

        // Mirror into the in-house buffer using the typed-value variant.
        // Translate the heterogeneous `[String: Any]` into
        // `[String: AnalyticsValue]` — only scalar values pass through
        // (matching `AnalyticsValue`'s closed enum); anything else is
        // dropped silently. The enum's own contract guarantees scalars,
        // so the drop branch is dead code in practice.
        Analytics.track(name, Self.toAnalyticsValues(properties))
    }

    // MARK: - Tracking — legacy free-form

    /// Buffer an event for later flush via the in-house pipeline. Kept for
    /// backward compatibility with existing call sites that wrote
    /// `Analytics.track("foo", [...])` before the typed event enum
    /// landed. Prefer `track(_ event: AnalyticsEvent)` for new code.
    static func track(_ event: String, _ properties: [String: AnalyticsValue] = [:]) {
        // Mirror to PostHog — convert AnalyticsValue back to scalar Any
        // so the vendor SDK doesn't need to know our enum.
        #if canImport(PostHog)
        if isStarted {
            let flat = Self.toAnyDict(properties)
            PostHogSDK.shared.capture(event, properties: flat)
        }
        #endif

        Task { await AnalyticsClient.shared.track(event, properties: properties) }
    }

    /// Tag subsequent events with a stable user identifier. Call this once
    /// after sign-in succeeds. Legacy overload — new code should use the
    /// `identify(userId:traits:)` variant.
    static func identify(_ userId: String) {
        identify(userId: userId, traits: [:])
    }

    /// Drop the distinct_id and the pending buffer. Call this on logout
    /// so the next user's session can't be attributed to the previous
    /// one. Resets PostHog's distinct_id when the SDK is configured.
    static func reset() {
        #if canImport(PostHog)
        if isStarted {
            PostHogSDK.shared.reset()
        }
        #endif
        Task { await AnalyticsClient.shared.reset() }
    }

    /// Force a flush. Useful right before a process terminates (e.g.
    /// inside a background-task expiration handler) or in tests.
    static func flush() {
        #if canImport(PostHog)
        if isStarted {
            PostHogSDK.shared.flush()
        }
        #endif
        Task { await AnalyticsClient.shared.flush() }
    }

    // MARK: - Private conversion helpers

    /// Translate a property bag of scalars (`String`/`Int`/`Bool`/
    /// `Double`) into the closed `AnalyticsValue` enum used by the
    /// in-house buffer. Non-scalar values are silently dropped — the
    /// typed-event enum guarantees scalars at the source, so this branch
    /// is dead in practice and exists only as defense-in-depth.
    private static func toAnalyticsValues(_ raw: [String: Any]) -> [String: AnalyticsValue] {
        var out: [String: AnalyticsValue] = [:]
        out.reserveCapacity(raw.count)
        for (key, value) in raw {
            // Bool MUST be checked before Int — on iOS, `Bool` bridges
            // to `NSNumber` which also matches `Int`. Without this order
            // a `true` would land as `1`.
            if let bool = value as? Bool {
                out[key] = .bool(bool)
            } else if let int = value as? Int {
                out[key] = .int(int)
            } else if let double = value as? Double {
                out[key] = .double(double)
            } else if let string = value as? String {
                out[key] = .string(string)
            }
            // Else: drop. The typed-event enum never produces non-scalars.
        }
        return out
    }

    /// Convert the legacy `AnalyticsValue` bag into the heterogeneous
    /// dictionary PostHog's `capture` method expects.
    private static func toAnyDict(_ values: [String: AnalyticsValue]) -> [String: Any] {
        var out: [String: Any] = [:]
        out.reserveCapacity(values.count)
        for (key, value) in values {
            switch value {
            case .string(let s): out[key] = s
            case .int(let i):    out[key] = i
            case .double(let d): out[key] = d
            case .bool(let b):   out[key] = b
            }
        }
        return out
    }
}

// =============================================================================
// IN-HOUSE BUFFER BRIDGE
// -----------------------------------------------------------------------------
// `AnalyticsClient` exposes async `identify(_:)` already, but we want a
// fire-and-forget surface so the PostHog facade can mirror the distinct_id
// without awaiting. Extension lives in this file (rather than in
// AnalyticsClient.swift) so the legacy file is untouched by this agent.
// =============================================================================

extension AnalyticsClient {
    /// Fire-and-forget identity sync. Called by the PostHog facade when
    /// `Analytics.identify(userId:traits:)` runs so the in-house buffer
    /// tags subsequent events with the same id.
    nonisolated func assumeIdentify(_ userId: String) {
        Task { [weak self] in await self?.identify(userId) }
    }
}
