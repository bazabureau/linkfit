import Foundation

public struct Court: Codable, Sendable, Equatable, Identifiable, Hashable {
    public let id: String
    public let venueId: String
    public let sportId: String
    public let sportSlug: String
    public let name: String
    public let hourlyPriceMinor: Int
    public let currency: String
}

/// Venue list card (`GET /api/v1/venues`).
public struct Venue: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let address: String
    public let lat: Double
    public let lng: Double
    public let isPartner: Bool
    public let phone: String?
    public let description: String?
    public let distanceKm: Double?
    public let photoUrl: URL?
    public let photoUrls: [URL]?
    public let ratingAvg: Double?
    public let ratingCount: Int?
}

/// Full venue (`GET /api/v1/venues/:id`) — adds courts.
public struct VenueDetail: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let address: String
    public let lat: Double
    public let lng: Double
    public let isPartner: Bool
    public let phone: String?
    public let description: String?
    public let distanceKm: Double?
    public let courts: [Court]
    public let photoUrl: URL?
    public let photoUrls: [URL]?
    public let ratingAvg: Double?
    public let ratingCount: Int?
}
