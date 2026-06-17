import Foundation

/// The credential pair persisted in the Keychain. `expiresAt` is computed at
/// save time from the server's `access_token_expires_in_seconds` so the client
/// can refresh proactively (a little before expiry) instead of waiting for a 401.
public struct AuthTokens: Codable, Sendable, Equatable {
    public var accessToken: String
    public var refreshToken: String
    public var expiresAt: Date

    public init(accessToken: String, refreshToken: String, expiresAt: Date) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
    }

    /// True within `leeway` seconds of expiry — triggers a proactive refresh.
    public func isExpiring(within leeway: TimeInterval = 60, now: Date = Date()) -> Bool {
        now.addingTimeInterval(leeway) >= expiresAt
    }
}

/// Storage contract for the token pair. Lives in `Models` so both `Networking`
/// (reader/refresher) and `Persistence` (Keychain implementor) can see it
/// without depending on each other — dependency inversion.
public protocol TokenStoring: Sendable {
    func currentAccessToken() async -> String?
    func tokens() async -> AuthTokens?
    func save(_ tokens: AuthTokens) async
    func clear() async
}
