import Foundation

/// Decoded payload from `GET /api/v1/app/version`.
///
/// Backend currently returns just the `ios` block — older releases (or
/// non-iOS-aware servers) may omit it, so callers should defend against a
/// decode failure rather than treating it as fatal. The version-gate
/// view-model swallows network/decode errors and leaves the user
/// unblocked when this lookup can't complete.
struct AppVersionResponse: Decodable, Equatable {
    struct iOS: Decodable, Equatable {
        let latest_build: Int
        let latest_version: String
        let min_supported_build: Int
        let force_update: Bool
        let release_notes_url: String?
    }
    let ios: iOS
}

extension Endpoint where Response == AppVersionResponse {
    /// Public app-version probe. Anonymous (no token required) so that
    /// a logged-out user can still be blocked from running an
    /// unsupported build.
    static func appVersion() -> Endpoint<AppVersionResponse> {
        Endpoint(method: .get, path: "/api/v1/app/version", requiresAuth: false)
    }
}
