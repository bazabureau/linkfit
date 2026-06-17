import Foundation

/// Per-sport rating/stats block embedded in a profile.
public struct SportStats: Codable, Sendable, Equatable, Identifiable {
    public let sportId: String
    public let sportSlug: String
    public let eloRating: Int
    public let gamesPlayed: Int
    public let gamesWon: Int
    public let reliabilityScore: Int

    public var id: String { sportId }
    public var gamesLost: Int { max(0, gamesPlayed - gamesWon) }
    public var winRate: Double { gamesPlayed > 0 ? Double(gamesWon) / Double(gamesPlayed) : 0 }
}

/// Public profile (`GET /api/v1/users/:id/profile`).
public struct PublicProfile: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let displayName: String
    public let photoUrl: URL?
    public let createdAt: Date?
    public let stats: [SportStats]
    public let followersCount: Int?
    public let followingCount: Int?
    public let isFollowing: Bool?
    public let followsViewer: Bool?
}
