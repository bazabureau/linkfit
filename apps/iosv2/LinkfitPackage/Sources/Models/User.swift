import Foundation

/// Public-facing user record returned by `/api/v1/me`, auth responses, and
/// embedded in games / rosters / messages. Mirrors the backend `PublicUser`.
public struct User: Codable, Sendable, Equatable, Identifiable, Hashable {
    public let id: String
    public let email: String
    public let displayName: String
    public let photoUrl: URL?
    public let homeLat: Double?
    public let homeLng: Double?
    public let createdAt: Date?
    public let emailVerifiedAt: Date?

    public init(
        id: String,
        email: String,
        displayName: String,
        photoUrl: URL? = nil,
        homeLat: Double? = nil,
        homeLng: Double? = nil,
        createdAt: Date? = nil,
        emailVerifiedAt: Date? = nil
    ) {
        self.id = id
        self.email = email
        self.displayName = displayName
        self.photoUrl = photoUrl
        self.homeLat = homeLat
        self.homeLng = homeLng
        self.createdAt = createdAt
        self.emailVerifiedAt = emailVerifiedAt
    }

    public var isEmailVerified: Bool { emailVerifiedAt != nil }

    /// Initials for the avatar fallback (e.g. "Kamran Namazov" -> "KN").
    public var initials: String {
        let parts = displayName.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first }.map(String.init)
        return letters.joined().uppercased()
    }
}
