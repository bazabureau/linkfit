import Foundation

/// Immutable, value-typed runtime configuration loaded once at launch from the
/// app's Info.plist (which in turn pulls from `.xcconfig` / CI env). Keeping this
/// a plain `Sendable` struct means it can cross actor boundaries freely and is
/// trivial to stub in tests.
public struct EnvConfig: Sendable {
    public let apiBaseURL: URL
    public let sentryDSN: String?
    public let posthogKey: String?
    public let googleClientID: String?
    /// Base64-encoded SHA-256 SPKI pins for `api.linkfit.az`. Empty disables pinning.
    public let certPins: [String]

    public init(
        apiBaseURL: URL,
        sentryDSN: String? = nil,
        posthogKey: String? = nil,
        googleClientID: String? = nil,
        certPins: [String] = []
    ) {
        self.apiBaseURL = apiBaseURL
        self.sentryDSN = sentryDSN
        self.posthogKey = posthogKey
        self.googleClientID = googleClientID
        self.certPins = certPins
    }

    /// Production fallback used whenever the Info.plist key is absent (dev builds).
    public static let defaultBaseURL = URL(string: "https://api.linkfit.az")!

    public static func load(bundle: Bundle = .main) -> EnvConfig {
        func string(_ key: String) -> String? {
            guard let raw = bundle.object(forInfoDictionaryKey: key) as? String else { return nil }
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }

        let base = string("API_BASE_URL").flatMap(URL.init(string:)) ?? defaultBaseURL
        let pins = (string("CERT_PINS") ?? "")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }

        return EnvConfig(
            apiBaseURL: base,
            sentryDSN: string("SENTRY_DSN"),
            posthogKey: string("POSTHOG_API_KEY"),
            googleClientID: string("GOOGLE_CLIENT_ID"),
            certPins: pins
        )
    }
}
