import Foundation

/// Wire shape of the `login` / `register` / `refresh` / social responses:
/// `{ user, access_token, refresh_token, access_token_expires_in_seconds }`.
/// Decode-only — the repository maps it to a `User` + `AuthTokens` (stamping
/// `expiresAt` from the seconds value at the moment of receipt).
public struct AuthSessionDTO: Decodable, Sendable, Equatable {
    public let user: User
    public let accessToken: String
    public let refreshToken: String
    public let accessTokenExpiresInSeconds: Int

    public func tokens(now: Date = Date()) -> AuthTokens {
        AuthTokens(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: now.addingTimeInterval(TimeInterval(accessTokenExpiresInSeconds))
        )
    }
}
