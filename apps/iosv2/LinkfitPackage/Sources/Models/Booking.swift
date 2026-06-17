import Foundation

public enum BookingStatus: String, Codable, Sendable, Equatable {
    case pendingPayment = "pending_payment"
    case partiallyPaid = "partially_paid"
    case paid, cancelled, refunded, failed
}

public struct PaymentSplit: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let userId: String
    public let amountMinor: Int
    /// Kept as a string for forward-compatibility with new split states.
    public let status: String
    public let externalRef: String?
}

public struct Booking: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let gameId: String?
    public let courtId: String
    public let userId: String
    public let venueId: String
    public let venueName: String
    public let courtName: String
    public let startsAt: Date
    public let endsAt: Date
    public let durationMinutes: Int
    public let totalMinor: Int
    public let currency: String
    public let status: BookingStatus
    public let createdAt: Date?
    public let paidAt: Date?
    public let cancelledAt: Date?
    public let splits: [PaymentSplit]?
}

/// `GET /api/v1/bookings/me` → upcoming + past.
public struct BookingsList: Codable, Sendable, Equatable {
    public let upcoming: [Booking]
    public let past: [Booking]
}

/// One slot from `GET /api/v1/courts/:id/availability?date=`. Times are kept as
/// raw strings (they may be "HH:mm" or ISO) — format/compare via the helpers.
public struct CourtAvailabilitySlot: Codable, Sendable, Equatable, Hashable, Identifiable {
    public let startTime: String
    public let endTime: String
    public let status: String
    public let minutesFromMidnight: Int
    public let booked: Bool?

    public var id: Int { minutesFromMidnight }
    public var isBooked: Bool { booked == true || status == "booked" || status == "unavailable" }
}

public struct CourtAvailability: Codable, Sendable, Equatable {
    public let date: String
    public let openHour: Int
    public let closeHour: Int
    public let slots: [CourtAvailabilitySlot]
}
