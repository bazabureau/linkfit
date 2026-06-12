import Foundation
#if canImport(Sentry)
import Sentry
#endif

/// Crash + error reporting facade.
///
/// Wraps the Sentry SwiftPM package behind a tiny surface so the rest of the
/// app never imports `Sentry` directly. Three contracts the rest of the
/// codebase relies on:
///
/// 1. **Safe with no DSN.** `start(dsn:)` with a nil/empty DSN is a no-op —
///    every subsequent call short-circuits. This lets dev/CI builds boot
///    without configuring Sentry. The same is true when the `Sentry` module
///    isn't linked at all (the package is opt-in via SwiftPM).
/// 2. **PII scrubbing.** We strip `email`, `display_name`, `phone`, and any
///    `Authorization` / `Cookie` / `Set-Cookie` headers in `beforeSend` and
///    `beforeBreadcrumb`. The app must never leak account identifiers to a
///    third party.
/// 3. **Anonymized user context.** `setUser(userId:)` writes ONLY the
///    server-side user id (a UUID); the email, display name, IP, and any
///    other PII is left blank. Clear on logout via `clearUser()`.
///
/// The release version is read from `CFBundleShortVersionString` +
/// `CFBundleVersion`; the environment is read from the `LINKFIT_ENV` Info.plist
/// build setting (or the build configuration — Debug vs. Release — when that
/// key is unset).
enum CrashReporter {
    /// Sentinel that flips after the first `start(...)` call; subsequent
    /// `capture(...)` calls become no-ops when this is false.
    private static let stateLock = NSLock()
    nonisolated(unsafe) private static var isEnabled = false

    /// Initialize Sentry. Safe to call multiple times — only the first call
    /// with a non-empty DSN takes effect. Passing nil/empty disables capture.
    static func start(dsn: String?) {
        let trimmed = dsn?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else {
            #if DEBUG
            // Verbose only in Debug builds so production logs don't drown in
            // "no DSN" warnings every cold launch.
            NSLog("[CrashReporter] SENTRY_DSN unset — crash reporting disabled")
            #endif
            return
        }
        #if canImport(Sentry)
        stateLock.lock()
        let already = isEnabled
        if !already { isEnabled = true }
        stateLock.unlock()
        guard !already else { return }

        let environment = readEnvironment()
        let release = readReleaseString()

        SentrySDK.start { options in
            options.dsn = trimmed
            options.environment = environment
            options.releaseName = release
            // Enable automatic crash + Swift error capture. These are the
            // Sentry defaults but we set them explicitly so a future SDK
            // version change doesn't silently flip the behavior.
            options.enableCrashHandler = true
            options.enableAutoSessionTracking = true
            options.attachStacktrace = true
            // Default automatic breadcrumb tracking — view-controller
            // transitions, network requests, touches. The `beforeBreadcrumb`
            // hook below redacts the PII-sensitive ones before they're stored.
            options.enableAutoBreadcrumbTracking = true
            // PII scrubbing — see `scrubEvent` / `scrubBreadcrumb`. Sentry's
            // built-in `sendDefaultPii` is false by default, but we still
            // explicitly scrub the event payload to catch anything our own
            // breadcrumb calls might add.
            options.sendDefaultPii = false
            options.beforeSend = { event in
                CrashReporter.scrubEvent(event)
                return event
            }
            options.beforeBreadcrumb = { crumb in
                CrashReporter.scrubBreadcrumb(crumb)
            }
        }
        #endif
    }

    /// Set the active user context after a successful sign-in. The argument
    /// is the server-side user id (a UUID). Email/display name are NEVER
    /// passed in — the contract is "stable opaque identifier only" so an
    /// engineer triaging a crash can join across events but the third-party
    /// service never sees the account.
    static func setUser(userId: String) {
        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        #if canImport(Sentry)
        stateLock.lock()
        let enabled = isEnabled
        stateLock.unlock()
        guard enabled else { return }
        // Fully qualified — guards against any future `User` typealias in
        // the app surface colliding with `Sentry.User`.
        let user = Sentry.User()
        user.userId = trimmed
        // Leave email, username, name, ipAddress nil — the redact hook would
        // strip them anyway but we never want to set them in the first place.
        SentrySDK.setUser(user)
        #endif
    }

    /// Clear the active user context on logout. After this call any new
    /// events recorded are anonymous until `setUser(userId:)` is called
    /// again.
    static func clearUser() {
        #if canImport(Sentry)
        stateLock.lock()
        let enabled = isEnabled
        stateLock.unlock()
        guard enabled else { return }
        SentrySDK.setUser(nil)
        #endif
    }

    /// Capture an explicit Swift `Error`. Used by the API transport for errors
    /// that aren't surfaced to the user (e.g. background refresh failures)
    /// but should still reach Sentry for triage.
    ///
    /// `context` is attached as a tag bag — keep values short and free of PII.
    /// The contract is "the caller already removed user identifiers."
    static func capture(error: Error, context: [String: String] = [:]) {
        #if canImport(Sentry)
        stateLock.lock()
        let enabled = isEnabled
        stateLock.unlock()
        guard enabled else { return }
        SentrySDK.capture(error: error) { scope in
            for (key, value) in context {
                scope.setTag(value: value, key: key)
            }
        }
        #endif
    }

    /// Capture a plain message at `warning` level. Useful for "this is a
    /// soft failure but we want to know it happened" — e.g. a feature flag
    /// fell back to its default because the remote-config payload was
    /// malformed.
    static func captureMessage(_ message: String, context: [String: String] = [:]) {
        #if canImport(Sentry)
        stateLock.lock()
        let enabled = isEnabled
        stateLock.unlock()
        guard enabled else { return }
        SentrySDK.capture(message: message) { scope in
            scope.setLevel(.warning)
            for (key, value) in context {
                scope.setTag(value: value, key: key)
            }
        }
        #endif
    }

    // MARK: - Internals

    /// Read the build-time environment tag. Order:
    /// 1. `LINKFIT_ENV` Info.plist key (set via xcconfig / project.yml).
    /// 2. `LINKFIT_ENV` process env (overrides for ad-hoc TestFlight builds).
    /// 3. Build configuration — `"debug"` if compiled under `DEBUG`, else
    ///    `"release"`.
    static func readEnvironment() -> String {
        if let v = Bundle.main.object(forInfoDictionaryKey: "LINKFIT_ENV") as? String,
           !v.isEmpty {
            return v
        }
        if let v = ProcessInfo.processInfo.environment["LINKFIT_ENV"], !v.isEmpty {
            return v
        }
        #if DEBUG
        return "debug"
        #else
        return "release"
        #endif
    }

    /// Compose the release string the same way Sentry's Cocoa SDK does
    /// internally (`<bundle id>@<short-version>+<build>`), but compute it
    /// ourselves so the value is stable across SDK updates and so unit tests
    /// can verify it without a live SDK present.
    static func readReleaseString() -> String {
        let bundleId = Bundle.main.bundleIdentifier ?? "az.linkfit.app"
        let short = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
            as? String) ?? "0.0.0"
        let build = (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion")
            as? String) ?? "0"
        return "\(bundleId)@\(short)+\(build)"
    }

    /// Mutate the event in-place to strip user PII before it leaves the
    /// device. We touch three places: `event.user`, `event.tags`, and the
    /// nested `extra` bag.
    #if canImport(Sentry)
    static func scrubEvent(_ event: Event) {
        // Drop any user identity beyond the auto-generated install ID. The
        // server-side Sentry project doesn't need (and shouldn't get) the
        // user's email or display name.
        if let user = event.user {
            user.email = nil
            user.username = nil
            user.name = nil
            user.ipAddress = nil
            user.data = nil
            event.user = user
        }
        event.tags = scrubStringMap(event.tags)
        event.extra = scrubAnyMap(event.extra)
    }

    /// Drop or redact breadcrumbs that contain user PII (URL paths with
    /// email, Authorization headers in network breadcrumbs).
    static func scrubBreadcrumb(_ crumb: Breadcrumb) -> Breadcrumb? {
        // Network breadcrumbs commonly have `Authorization` in their data
        // map. Drop the key wholesale; never let an access token leak.
        if var data = crumb.data {
            for key in PII_HEADER_KEYS where data[key] != nil {
                data[key] = "[REDACTED]"
            }
            for key in PII_FIELD_KEYS where data[key] != nil {
                data[key] = "[REDACTED]"
            }
            crumb.data = data
        }
        if let message = crumb.message, looksLikeEmail(message) {
            crumb.message = "[REDACTED]"
        }
        return crumb
    }

    private static func scrubStringMap(_ map: [String: String]?) -> [String: String]? {
        guard var copy = map else { return nil }
        for key in PII_FIELD_KEYS where copy[key] != nil {
            copy[key] = "[REDACTED]"
        }
        return copy
    }

    private static func scrubAnyMap(_ map: [String: Any]?) -> [String: Any]? {
        guard var copy = map else { return nil }
        for key in PII_FIELD_KEYS where copy[key] != nil {
            copy[key] = "[REDACTED]"
        }
        return copy
    }
    #endif

    /// Keys we always strip from any data bag (tags, extras, breadcrumb data).
    static let PII_FIELD_KEYS: Set<String> = [
        "email", "Email", "user_email", "userEmail",
        "display_name", "displayName",
        "name", "username",
        "phone", "phone_number", "phoneNumber",
    ]

    /// Header names that should never appear in breadcrumbs as cleartext.
    static let PII_HEADER_KEYS: Set<String> = [
        "Authorization", "authorization",
        "Cookie", "cookie",
        "Set-Cookie", "set-cookie",
    ]

    /// Cheap email heuristic. We don't need RFC 5322 — just enough to catch
    /// strings like "fetched profile for alice@example.com" before they hit
    /// the breadcrumb buffer.
    static func looksLikeEmail(_ s: String) -> Bool {
        guard s.contains("@") else { return false }
        let parts = s.split(separator: "@")
        guard parts.count == 2, let last = parts.last else { return false }
        return last.contains(".") && last.count >= 3
    }
}
