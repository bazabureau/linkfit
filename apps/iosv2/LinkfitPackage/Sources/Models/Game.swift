import Foundation

public enum GameStatus: String, Codable, Sendable, Equatable {
    case open, full, cancelled, completed
}

public enum GameVisibility: String, Codable, Sendable, Equatable {
    case publicGame = "public"
    case invite
}

public enum ParticipantStatus: String, Codable, Sendable, Equatable {
    case confirmed, cancelled, played
    case noShow = "no_show"
}

public struct GameParticipant: Codable, Sendable, Equatable, Identifiable {
    public let userId: String
    public let displayName: String
    public let photoUrl: URL?
    public let status: ParticipantStatus
    public let joinedAt: Date?

    public var id: String { userId }
}

/// List/card representation of a game (`GET /api/v1/games`).
public struct GameSummary: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let sportId: String
    public let sportSlug: String
    public let hostUserId: String
    public let hostDisplayName: String
    public let courtId: String?
    public let venueName: String?
    public let venuePhotoUrl: URL?
    public let lat: Double
    public let lng: Double
    public let startsAt: Date
    public let durationMinutes: Int
    public let capacity: Int
    public let participantsCount: Int
    public let status: GameStatus
    public let visibility: GameVisibility
    public let skillMinElo: Int?
    public let skillMaxElo: Int?
    public let distanceKm: Double?

    public var spotsLeft: Int { max(0, capacity - participantsCount) }
}

/// Full game (`GET /api/v1/games/:id`) — adds notes + roster.
public struct GameDetail: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let sportId: String
    public let sportSlug: String
    public let hostUserId: String
    public let hostDisplayName: String
    public let courtId: String?
    public let venueName: String?
    public let venuePhotoUrl: URL?
    public let lat: Double
    public let lng: Double
    public let startsAt: Date
    public let durationMinutes: Int
    public let capacity: Int
    public let participantsCount: Int
    public let status: GameStatus
    public let visibility: GameVisibility
    public let skillMinElo: Int?
    public let skillMaxElo: Int?
    public let distanceKm: Double?
    public let notes: String?
    public let participants: [GameParticipant]
    public let createdAt: Date?

    public var spotsLeft: Int { max(0, capacity - participantsCount) }
}
