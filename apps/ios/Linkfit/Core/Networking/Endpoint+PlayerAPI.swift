import Foundation

// MARK: - App info

struct AppMetadataResponse: Decodable, Equatable {
    let api: String
    let environment: String
    let features: [String: Bool]
}

struct AppCapabilitiesResponse: Decodable, Equatable {
    let api: String
    let brand: String
    let supported_sports: [String]
    let clients: [String: [String: Bool]]
    let endpoints: [String: String]
}

extension Endpoint where Response == AppMetadataResponse {
    static func appMetadata() -> Endpoint<AppMetadataResponse> {
        Endpoint(method: .get, path: "/api/v1/app/metadata")
    }
}

extension Endpoint where Response == AppCapabilitiesResponse {
    static func appCapabilities() -> Endpoint<AppCapabilitiesResponse> {
        Endpoint(method: .get, path: "/api/v1/app/capabilities")
    }
}

// MARK: - Catalog extras

struct PaginationInfo: Decodable, Equatable {
    let limit: Int
    let offset: Int
    let total: Int
}

struct CourtsListResponse: Decodable, Equatable {
    let items: [Court]
    let pagination: PaginationInfo?
}

struct VenueAvailabilitySlot: Decodable, Equatable, Hashable {
    let start_at: String
    let end_at: String
    let status: String
    let booking_id: String?
    let block_id: String?
    let reason: String?

    var isFree: Bool { status == "free" }
}

struct VenueAvailabilityCourt: Decodable, Equatable, Identifiable {
    let id: String
    let venue_id: String
    let sport_id: String
    let sport_slug: String
    let name: String
    let hourly_price_minor: Int
    let currency: String
    let status: String?
    let photo_url: String?
    let photo_urls: [String]?
    let slots: [VenueAvailabilitySlot]
    let free_slots_count: Int
    let next_free_slot: String?
}

struct VenueAvailabilityResponse: Decodable, Equatable {
    let venue: Venue
    let date: String
    let open_hour: Int?
    let close_hour: Int?
    let slot_minutes: Int
    let min_booking_minutes: Int?
    let max_booking_minutes: Int?
    let cancellation_window_minutes: Int?
    let courts: [VenueAvailabilityCourt]
}

struct SuggestedCourtSlot: Decodable, Equatable, Identifiable {
    var id: String { "\(court_id)-\(starts_at)" }
    let court_id: String
    let venue_id: String
    let venue_name: String
    let starts_at: String
    let ends_at: String
    let duration_minutes: Int
    let total_minor: Int
    let currency: String
}

struct SuggestedSlotsResponse: Decodable, Equatable {
    let court_id: String
    let requested_starts_at: String
    let duration_minutes: Int
    let items: [SuggestedCourtSlot]
}

extension Endpoint where Response == CourtsListResponse {
    static func courts(
        venueId: String? = nil,
        q: String? = nil,
        sport: String? = nil,
        status: String? = nil,
        minPriceMinor: Int? = nil,
        maxPriceMinor: Int? = nil,
        sort: String? = nil,
        limit: Int? = nil,
        offset: Int? = nil
    ) -> Endpoint<CourtsListResponse> {
        var query: [URLQueryItem] = []
        if let venueId { query.append(.init(name: "venue_id", value: venueId)) }
        if let q { query.append(.init(name: "q", value: q)) }
        if let sport { query.append(.init(name: "sport", value: sport)) }
        if let status { query.append(.init(name: "status", value: status)) }
        if let minPriceMinor { query.append(.init(name: "min_price_minor", value: "\(minPriceMinor)")) }
        if let maxPriceMinor { query.append(.init(name: "max_price_minor", value: "\(maxPriceMinor)")) }
        if let sort { query.append(.init(name: "sort", value: sort)) }
        if let limit { query.append(.init(name: "limit", value: "\(limit)")) }
        if let offset { query.append(.init(name: "offset", value: "\(offset)")) }
        return Endpoint(method: .get, path: "/api/v1/courts", query: query)
    }
}

extension Endpoint where Response == VenueAvailabilityResponse {
    static func venueAvailability(venueId: String, date: String, sport: String? = nil) -> Endpoint<VenueAvailabilityResponse> {
        var query: [URLQueryItem] = [.init(name: "date", value: date)]
        if let sport { query.append(.init(name: "sport", value: sport)) }
        return Endpoint(method: .get, path: "/api/v1/venues/\(venueId)/availability", query: query)
    }
}

extension Endpoint where Response == SuggestedSlotsResponse {
    static func suggestedSlots(
        courtId: String,
        startsAt: String,
        durationMinutes: Int,
        limit: Int? = nil,
        daysAhead: Int? = nil
    ) -> Endpoint<SuggestedSlotsResponse> {
        var query: [URLQueryItem] = [
            .init(name: "starts_at", value: startsAt),
            .init(name: "duration_minutes", value: "\(durationMinutes)"),
        ]
        if let limit { query.append(.init(name: "limit", value: "\(limit)")) }
        if let daysAhead { query.append(.init(name: "days_ahead", value: "\(daysAhead)")) }
        return Endpoint(method: .get, path: "/api/v1/courts/\(courtId)/suggested-slots", query: query)
    }
}

// MARK: - Booking commerce

struct BookingQuotePromo: Decodable, Equatable {
    let code: String?
    let discount_minor: Int?
    let description: String?
}

struct BookingQuoteResponse: Decodable, Equatable {
    let court_id: String
    let venue_id: String
    let venue_name: String
    let starts_at: String
    let ends_at: String
    let duration_minutes: Int
    let hourly_price_minor: Int
    let subtotal_minor: Int
    let discount_minor: Int
    let total_minor: Int
    let currency: String
    let available: Bool
    let payment_methods: [String]
    let promo: BookingQuotePromo?
}

struct PromoValidationResponse: Decodable, Equatable {
    let valid: Bool
    let code: String?
    let discount_minor: Int?
    let message: String?
}

struct BookingHold: Decodable, Equatable, Identifiable {
    let id: String
    let court_id: String
    let court_name: String?
    let venue_id: String?
    let venue_name: String?
    let starts_at: String
    let ends_at: String?
    let duration_minutes: Int
    let expires_at: String
    let created_at: String?
}

struct BookingHoldsResponse: Decodable, Equatable {
    let items: [BookingHold]
}

struct BookingHoldReleaseResponse: Decodable, Equatable {
    let id: String
    let released: Bool
}

struct BookingReceiptParty: Decodable, Equatable {
    let id: String?
    let name: String?
    let email: String?
    let address: String?
    let phone: String?
    let sport_slug: String?
    let sport_name: String?
}

struct BookingReceiptLineItem: Decodable, Equatable {
    let description: String
    let starts_at: String
    let ends_at: String
    let duration_minutes: Int
    let amount_minor: Int
    let currency: String
}

struct BookingReceiptTotals: Decodable, Equatable {
    let subtotal_minor: Int
    let discount_minor: Int
    let tax_minor: Int
    let total_minor: Int
    let currency: String
}

struct BookingReceiptPayment: Decodable, Equatable {
    let status: String
    let method: String?
    let paid_at: String?
    let external_ref: String?
    let refund_status: String?
    let refund_amount_minor: Int?
    let refund_note: String?
    let refunded_at: String?
}

struct BookingReceiptResponse: Decodable, Equatable {
    let receipt_number: String
    let booking: Booking
    let customer: BookingReceiptParty
    let venue: BookingReceiptParty
    let court: BookingReceiptParty
    let line_items: [BookingReceiptLineItem]
    let totals: BookingReceiptTotals
    let payment: BookingReceiptPayment
    let issued_at: String?
}

extension Endpoint where Response == BookingQuoteResponse {
    static func bookingQuote(
        courtId: String,
        startsAt: String,
        durationMinutes: Int,
        holdId: String? = nil,
        promoCode: String? = nil
    ) -> Endpoint<BookingQuoteResponse> {
        var body: [String: Any] = [
            "court_id": courtId,
            "starts_at": startsAt,
            "duration_minutes": durationMinutes,
        ]
        if let holdId { body["hold_id"] = holdId }
        if let promoCode { body["promo_code"] = promoCode }
        return Endpoint(method: .post, path: "/api/v1/bookings/quote", body: encodePlayerAPIJSON(body))
    }
}

extension Endpoint where Response == PromoValidationResponse {
    static func validatePromoCode(
        code: String,
        courtId: String? = nil,
        startsAt: String? = nil,
        durationMinutes: Int? = nil
    ) -> Endpoint<PromoValidationResponse> {
        var body: [String: Any] = ["code": code]
        if let courtId { body["court_id"] = courtId }
        if let startsAt { body["starts_at"] = startsAt }
        if let durationMinutes { body["duration_minutes"] = durationMinutes }
        return Endpoint(method: .post, path: "/api/v1/promo-codes/validate", body: encodePlayerAPIJSON(body))
    }
}

extension Endpoint where Response == BookingHoldsResponse {
    static func bookingHolds(limit: Int? = nil, includeExpired: Bool = false) -> Endpoint<BookingHoldsResponse> {
        var query: [URLQueryItem] = []
        if let limit { query.append(.init(name: "limit", value: "\(limit)")) }
        if includeExpired { query.append(.init(name: "include_expired", value: "true")) }
        return Endpoint(method: .get, path: "/api/v1/booking-holds", query: query, requiresAuth: true)
    }
}

extension Endpoint where Response == BookingHold {
    static func createBookingHold(
        courtId: String,
        startsAt: String,
        durationMinutes: Int,
        idempotencyKey: String? = nil,
        ttlSeconds: Int? = nil
    ) -> Endpoint<BookingHold> {
        var body: [String: Any] = [
            "court_id": courtId,
            "starts_at": startsAt,
            "duration_minutes": durationMinutes,
            "source": "app",
        ]
        if let idempotencyKey { body["idempotency_key"] = idempotencyKey }
        if let ttlSeconds { body["ttl_seconds"] = ttlSeconds }
        return Endpoint(method: .post, path: "/api/v1/booking-holds", body: encodePlayerAPIJSON(body), requiresAuth: true)
    }
}

extension Endpoint where Response == BookingHoldReleaseResponse {
    static func releaseBookingHold(id: String) -> Endpoint<BookingHoldReleaseResponse> {
        Endpoint(method: .delete, path: "/api/v1/booking-holds/\(id)", requiresAuth: true)
    }
}

extension Endpoint where Response == BookingReceiptResponse {
    static func bookingReceipt(id: String) -> Endpoint<BookingReceiptResponse> {
        Endpoint(method: .get, path: "/api/v1/bookings/\(id)/receipt", requiresAuth: true)
    }
}

// MARK: - Saved places

extension Endpoint where Response == ItemsResponse<Venue> {
    static func savedVenues(limit: Int? = nil) -> Endpoint<ItemsResponse<Venue>> {
        var query: [URLQueryItem] = []
        if let limit { query.append(.init(name: "limit", value: "\(limit)")) }
        return Endpoint(method: .get, path: "/api/v1/me/saved-venues", query: query, requiresAuth: true)
    }
}

extension Endpoint where Response == ItemsResponse<Court> {
    static func savedCourts(limit: Int? = nil) -> Endpoint<ItemsResponse<Court>> {
        var query: [URLQueryItem] = []
        if let limit { query.append(.init(name: "limit", value: "\(limit)")) }
        return Endpoint(method: .get, path: "/api/v1/me/saved-courts", query: query, requiresAuth: true)
    }
}

extension Endpoint where Response == Venue {
    static func saveVenue(id: String) -> Endpoint<Venue> {
        Endpoint(method: .post, path: "/api/v1/venues/\(id)/save", requiresAuth: true)
    }
}

extension Endpoint where Response == Court {
    static func saveCourt(id: String) -> Endpoint<Court> {
        Endpoint(method: .post, path: "/api/v1/courts/\(id)/save", requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    static func unsaveVenue(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete, path: "/api/v1/venues/\(id)/save", requiresAuth: true)
    }

    static func unsaveCourt(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete, path: "/api/v1/courts/\(id)/save", requiresAuth: true)
    }
}

// MARK: - Waitlist

struct BookingWaitlistUser: Decodable, Equatable {
    let id: String
    let display_name: String
    let email: String?
    let photo_url: String?
}

struct BookingWaitlistEntry: Decodable, Equatable, Identifiable {
    let id: String
    let user_id: String
    let user: BookingWaitlistUser?
    let court_id: String
    let court_name: String?
    let venue_id: String?
    let venue_name: String?
    let sport_slug: String?
    let starts_at: String
    let ends_at: String
    let duration_minutes: Int
    let status: String
    let notified_at: String?
    let cancelled_at: String?
    let created_at: String?
}

struct BookingWaitlistResponse: Decodable, Equatable {
    let items: [BookingWaitlistEntry]
}

extension Endpoint where Response == BookingWaitlistResponse {
    static func myWaitlist(limit: Int? = nil, status: String? = nil) -> Endpoint<BookingWaitlistResponse> {
        var query: [URLQueryItem] = []
        if let limit { query.append(.init(name: "limit", value: "\(limit)")) }
        if let status { query.append(.init(name: "status", value: status)) }
        return Endpoint(method: .get, path: "/api/v1/me/waitlist", query: query, requiresAuth: true)
    }
}

extension Endpoint where Response == BookingWaitlistEntry {
    static func joinCourtWaitlist(courtId: String, startsAt: String, durationMinutes: Int) -> Endpoint<BookingWaitlistEntry> {
        Endpoint(
            method: .post,
            path: "/api/v1/courts/\(courtId)/waitlist",
            body: encodePlayerAPIJSON(["starts_at": startsAt, "duration_minutes": durationMinutes]),
            requiresAuth: true
        )
    }

    static func cancelWaitlistEntry(id: String) -> Endpoint<BookingWaitlistEntry> {
        Endpoint(method: .delete, path: "/api/v1/waitlist/\(id)", requiresAuth: true)
    }
}

// MARK: - Payments

struct PaymentHistoryItem: Decodable, Equatable, Identifiable {
    let id: String
    let kind: String?
    let status: String
    let amount_minor: Int
    let currency: String
    let created_at: String
    let title: String?
    let subtitle: String?
}

struct PaymentSummary: Decodable, Equatable {
    let total_paid_minor: Int?
    let total_refunded_minor: Int?
    let currency: String?
    let count: Int?
}

struct PaymentHistoryResponse: Decodable, Equatable {
    let items: [PaymentHistoryItem]
    let pagination: PaginationInfo?
    let summary: PaymentSummary?
}

struct PaymentSheetResponse: Decodable, Equatable {
    let payment_intent_id: String
    let client_secret: String
    let ephemeral_key: String
    let customer_id: String
    let publishable_key_hint: String?
    let mode: String
    let booking_id: String?
    let amount_minor: Int?
    let currency: String?
}

struct PaymentStatusResponse: Decodable, Equatable {
    let status: String
    let paid_at: String?
}

struct PublicStatsResponse: Decodable, Equatable {
    let active_players: Int
    let partner_clubs: Int
    let weekly_matches: Int
    let tournaments: Int
}

struct RealtimeHealthResponse: Decodable, Equatable {
    let ok: Bool
    let transport: String
}

extension Endpoint where Response == PaymentHistoryResponse {
    static func paymentHistory(limit: Int? = nil, offset: Int? = nil, type: String? = nil, status: String? = nil) -> Endpoint<PaymentHistoryResponse> {
        var query: [URLQueryItem] = []
        if let limit { query.append(.init(name: "limit", value: "\(limit)")) }
        if let offset { query.append(.init(name: "offset", value: "\(offset)")) }
        if let type { query.append(.init(name: "type", value: type)) }
        if let status { query.append(.init(name: "status", value: status)) }
        return Endpoint(method: .get, path: "/api/v1/payments/history", query: query, requiresAuth: true)
    }
}

extension Endpoint where Response == PaymentSummary {
    static func paymentSummary() -> Endpoint<PaymentSummary> {
        Endpoint(method: .get, path: "/api/v1/payments/summary", requiresAuth: true)
    }
}

extension Endpoint where Response == PaymentSheetResponse {
    static func bookingPaymentIntent(id: String) -> Endpoint<PaymentSheetResponse> {
        Endpoint(method: .post, path: "/api/v1/payments/booking/\(id)/intent", requiresAuth: true)
    }

    static func tournamentPaymentIntent(tournamentId: String, squadName: String, playerIds: [String]) -> Endpoint<PaymentSheetResponse> {
        Endpoint(
            method: .post,
            path: "/api/v1/payments/tournament/\(tournamentId)/entry-intent",
            body: encodePlayerAPIJSON(["squad_name": squadName, "player_ids": playerIds]),
            requiresAuth: true
        )
    }
}

extension Endpoint where Response == PaymentStatusResponse {
    static func bookingPaymentStatus(id: String) -> Endpoint<PaymentStatusResponse> {
        Endpoint(method: .get, path: "/api/v1/payments/booking/\(id)/status", requiresAuth: true)
    }
}

extension Endpoint where Response == PublicStatsResponse {
    static func publicStats() -> Endpoint<PublicStatsResponse> {
        Endpoint(method: .get, path: "/api/v1/stats")
    }
}

extension Endpoint where Response == RealtimeHealthResponse {
    static func realtimeHealth() -> Endpoint<RealtimeHealthResponse> {
        Endpoint(method: .get, path: "/api/v1/realtime/health")
    }
}

// MARK: - Lessons and coaches

struct Lesson: Decodable, Equatable, Identifiable {
    let id: String
    let coach_id: String
    let coach_name: String
    let coach_photo_url: String?
    let title: String
    let kind: String
    let sport_slug: String
    let level_label: String?
    let level_min_elo: Int?
    let level_max_elo: Int?
    let starts_at: String
    let duration_minutes: Int
    let capacity: Int
    let booked_count: Int
    let spots_left: Int
    let price_minor: Int?
    let currency: String?
    let status: String
    let venue_id: String?
    let venue_name: String?
    let court_name: String?
    let is_booked_by_me: Bool?
    let is_booked: Bool?
}

struct Coach: Decodable, Equatable, Identifiable {
    let id: String
    let display_name: String
    let photo_url: String?
    let bio: String?
    let rating: Double?
    let years_experience: Int?
    let hourly_rate_minor: Int?
    let currency: String?
    let sport_slug: String?
    let venue_id: String?
    let venue_name: String?
}

struct LessonDetail: Decodable, Equatable, Identifiable {
    let id: String
    let coach_id: String
    let coach_name: String
    let coach_photo_url: String?
    let title: String
    let kind: String
    let sport_slug: String
    let level_label: String?
    let level_min_elo: Int?
    let level_max_elo: Int?
    let starts_at: String
    let duration_minutes: Int
    let capacity: Int
    let booked_count: Int
    let spots_left: Int
    let price_minor: Int?
    let currency: String?
    let status: String
    let venue_id: String?
    let venue_name: String?
    let court_name: String?
    let is_booked_by_me: Bool?
    let is_booked: Bool?
    let description: String?
    let coach: Coach?
    let participants: [PublicUser]
}

struct CoachDetail: Decodable, Equatable, Identifiable {
    let id: String
    let display_name: String
    let photo_url: String?
    let bio: String?
    let rating: Double?
    let years_experience: Int?
    let hourly_rate_minor: Int?
    let currency: String?
    let sport_slug: String?
    let venue_id: String?
    let venue_name: String?
    let upcoming_lessons: [Lesson]
}

struct LessonsPage: Decodable, Equatable {
    let items: [Lesson]
    let next_offset: Int?
    let next_cursor: String?
}

struct LessonBookingResponse: Decodable, Equatable {
    let ok: Bool
    let already_booked: Bool?
    let spots_left: Int?
}

extension Endpoint where Response == LessonsPage {
    static func lessons(
        sport: String? = nil,
        venueId: String? = nil,
        kind: String? = nil,
        date: String? = nil,
        cursor: String? = nil,
        limit: Int? = nil
    ) -> Endpoint<LessonsPage> {
        var query: [URLQueryItem] = []
        if let sport { query.append(.init(name: "sport", value: sport)) }
        if let venueId { query.append(.init(name: "venue_id", value: venueId)) }
        if let kind { query.append(.init(name: "kind", value: kind)) }
        if let date { query.append(.init(name: "date", value: date)) }
        if let cursor { query.append(.init(name: "cursor", value: cursor)) }
        if let limit { query.append(.init(name: "limit", value: "\(limit)")) }
        return Endpoint(method: .get, path: "/api/v1/lessons", query: query, requiresAuth: true)
    }
}

extension Endpoint where Response == ItemsResponse<Lesson> {
    static func myLessons() -> Endpoint<ItemsResponse<Lesson>> {
        Endpoint(method: .get, path: "/api/v1/me/lessons", requiresAuth: true)
    }
}

extension Endpoint where Response == LessonDetail {
    static func lesson(id: String) -> Endpoint<LessonDetail> {
        Endpoint(method: .get, path: "/api/v1/lessons/\(id)", requiresAuth: true)
    }
}

extension Endpoint where Response == ItemsResponse<Coach> {
    static func coaches(sport: String? = nil, venueId: String? = nil) -> Endpoint<ItemsResponse<Coach>> {
        var query: [URLQueryItem] = []
        if let sport { query.append(.init(name: "sport", value: sport)) }
        if let venueId { query.append(.init(name: "venue_id", value: venueId)) }
        return Endpoint(method: .get, path: "/api/v1/coaches", query: query)
    }
}

extension Endpoint where Response == CoachDetail {
    static func coach(id: String) -> Endpoint<CoachDetail> {
        Endpoint(method: .get, path: "/api/v1/coaches/\(id)", requiresAuth: true)
    }
}

extension Endpoint where Response == LessonBookingResponse {
    static func bookLesson(id: String) -> Endpoint<LessonBookingResponse> {
        Endpoint(method: .post, path: "/api/v1/lessons/\(id)/book", requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    static func cancelLesson(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete, path: "/api/v1/lessons/\(id)/book", requiresAuth: true)
    }
}

// MARK: - Support and owner applications

struct SupportUserSummary: Decodable, Equatable, Identifiable {
    let id: String
    let email: String?
    let display_name: String
    let photo_url: String?
    let admin_role: String?
}

struct SupportTicketMessage: Decodable, Equatable, Identifiable {
    let id: String
    let author_user_id: String?
    let author: SupportUserSummary?
    let author_role: String
    let body: String
    let created_at: String
}

struct SupportTicket: Decodable, Equatable, Identifiable {
    let id: String
    let user_id: String
    let user: SupportUserSummary?
    let category: String
    let subject: String
    let message: String
    let status: String
    let priority: String
    let related_kind: String?
    let related_id: String?
    let assigned_to_user_id: String?
    let assigned_to: SupportUserSummary?
    let resolution_note: String?
    let resolved_at: String?
    let created_at: String
    let updated_at: String
    let messages_count: Int
    let messages: [SupportTicketMessage]?
}

struct SupportTicketsResponse: Decodable, Equatable {
    let items: [SupportTicket]
    let pagination: PaginationInfo?
}

struct OwnerVenueSummary: Decodable, Equatable {
    let id: String
    let name: String
    let address: String
    let status: String?
    let is_partner: Bool?
}

struct OwnerApplication: Decodable, Equatable, Identifiable {
    let id: String
    let user_id: String
    let user: SupportUserSummary?
    let venue_id: String?
    let venue: OwnerVenueSummary?
    let venue_name: String
    let venue_address: String
    let lat: Double?
    let lng: Double?
    let contact_name: String
    let contact_phone: String?
    let contact_email: String
    let message: String?
    let status: String
    let reviewed_by_user_id: String?
    let reviewed_by: SupportUserSummary?
    let reviewed_at: String?
    let review_note: String?
    let created_at: String
    let updated_at: String
}

struct OwnerApplicationsResponse: Decodable, Equatable {
    let items: [OwnerApplication]
}

extension Endpoint where Response == SupportTicketsResponse {
    static func supportTickets(limit: Int? = nil, offset: Int? = nil, status: String? = nil) -> Endpoint<SupportTicketsResponse> {
        var query: [URLQueryItem] = []
        if let limit { query.append(.init(name: "limit", value: "\(limit)")) }
        if let offset { query.append(.init(name: "offset", value: "\(offset)")) }
        if let status { query.append(.init(name: "status", value: status)) }
        return Endpoint(method: .get, path: "/api/v1/support/tickets", query: query, requiresAuth: true)
    }
}

extension Endpoint where Response == SupportTicket {
    static func supportTicket(id: String) -> Endpoint<SupportTicket> {
        Endpoint(method: .get, path: "/api/v1/support/tickets/\(id)", requiresAuth: true)
    }

    static func createSupportTicket(
        category: String = "general",
        subject: String,
        message: String,
        priority: String = "normal",
        relatedKind: String? = nil,
        relatedId: String? = nil
    ) -> Endpoint<SupportTicket> {
        var body: [String: Any] = [
            "category": category,
            "subject": subject,
            "message": message,
            "priority": priority,
        ]
        if let relatedKind { body["related_kind"] = relatedKind }
        if let relatedId { body["related_id"] = relatedId }
        return Endpoint(method: .post, path: "/api/v1/support/tickets", body: encodePlayerAPIJSON(body), requiresAuth: true)
    }

    static func addSupportTicketMessage(id: String, body: String) -> Endpoint<SupportTicket> {
        Endpoint(
            method: .post,
            path: "/api/v1/support/tickets/\(id)/messages",
            body: encodePlayerAPIJSON(["body": body]),
            requiresAuth: true
        )
    }

    static func closeSupportTicket(id: String) -> Endpoint<SupportTicket> {
        Endpoint(method: .post, path: "/api/v1/support/tickets/\(id)/close", requiresAuth: true)
    }
}

extension Endpoint where Response == OwnerApplicationsResponse {
    static func ownerApplications() -> Endpoint<OwnerApplicationsResponse> {
        Endpoint(method: .get, path: "/api/v1/owner/applications", requiresAuth: true)
    }
}

extension Endpoint where Response == OwnerApplication {
    static func createOwnerApplication(
        venueId: String? = nil,
        venueName: String,
        venueAddress: String,
        lat: Double? = nil,
        lng: Double? = nil,
        contactName: String,
        contactPhone: String? = nil,
        contactEmail: String,
        message: String? = nil
    ) -> Endpoint<OwnerApplication> {
        var body: [String: Any] = [
            "venue_name": venueName,
            "venue_address": venueAddress,
            "contact_name": contactName,
            "contact_email": contactEmail,
        ]
        if let venueId { body["venue_id"] = venueId }
        if let lat { body["lat"] = lat }
        if let lng { body["lng"] = lng }
        if let contactPhone { body["contact_phone"] = contactPhone }
        if let message { body["message"] = message }
        return Endpoint(method: .post, path: "/api/v1/owner/applications", body: encodePlayerAPIJSON(body), requiresAuth: true)
    }
}

// MARK: - Feed and media

struct FeedLikeResponse: Decodable, Equatable {
    let likes_count: Int
}

struct MediaAssetResponse: Decodable, Equatable, Identifiable {
    let id: String
    let url: String
    let width: Int?
    let height: Int?
    let mime: String?
}

extension Endpoint where Response == FeedLikeResponse {
    static func likeFeedEvent(id: String) -> Endpoint<FeedLikeResponse> {
        Endpoint(method: .post, path: "/api/v1/feed/\(id)/like", requiresAuth: true)
    }

    static func unlikeFeedEvent(id: String) -> Endpoint<FeedLikeResponse> {
        Endpoint(method: .delete, path: "/api/v1/feed/\(id)/like", requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    static func deleteMedia(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete, path: "/api/v1/media/\(id)", requiresAuth: true)
    }
}

// MARK: - Home/activity aggregates

struct ActivityEvent: Decodable, Equatable, Identifiable {
    let id: String
    let type: String?
    let kind: String?
    let title: String?
    let subtitle: String?
    let event_at: String?
    let status: String?
    let venue_name: String?
}

struct ActivityResponse: Decodable, Equatable {
    let items: [ActivityEvent]
    let pagination: PaginationInfo?
    let summary: [String: Int]?
}

struct HomeAggregateMembership: Decodable, Equatable {
    let tier: String?
    let is_premium: Bool?
    let is_plus: Bool?
    let on_trial: Bool?
    let trial_ends_at: String?
    let current_period_end: String?
    let cancel_at_period_end: Bool?
}

struct HomeAggregateResponse: Decodable, Equatable {
    let me: PublicUser?
    let membership: HomeAggregateMembership?
    let unread: UnreadCountsResponse?
    let agenda: AgendaResponse?
    let nearby_games: [GameSummary]?
    let suggested_follows: [SuggestedFollowItem]?
    let insights_summary: InsightsResponse?
}

extension Endpoint where Response == ActivityResponse {
    static func myActivity(limit: Int? = nil, offset: Int? = nil, type: String? = nil, timeframe: String? = nil) -> Endpoint<ActivityResponse> {
        var query: [URLQueryItem] = []
        if let limit { query.append(.init(name: "limit", value: "\(limit)")) }
        if let offset { query.append(.init(name: "offset", value: "\(offset)")) }
        if let type { query.append(.init(name: "type", value: type)) }
        if let timeframe { query.append(.init(name: "timeframe", value: timeframe)) }
        return Endpoint(method: .get, path: "/api/v1/me/activity", query: query, requiresAuth: true)
    }
}

extension Endpoint where Response == HomeAggregateResponse {
    static func myHomeAggregate() -> Endpoint<HomeAggregateResponse> {
        Endpoint(method: .get, path: "/api/v1/me/home", requiresAuth: true)
    }
}

// MARK: - Tournaments, Americano, membership portal, result report

struct MembershipPortalResponse: Decodable, Equatable {
    let mode: String
    let portal_url: String?
    let membership: MembershipState
}

struct MatchResultSetBody: Encodable, Equatable {
    let a: Int
    let b: Int
}

extension Endpoint where Response == MembershipPortalResponse {
    static func membershipPortal() -> Endpoint<MembershipPortalResponse> {
        Endpoint(method: .post, path: "/api/v1/me/membership/portal", requiresAuth: true)
    }
}

extension Endpoint where Response == ItemsResponse<Tournament> {
    static func myTournaments() -> Endpoint<ItemsResponse<Tournament>> {
        Endpoint(method: .get, path: "/api/v1/me/tournaments", requiresAuth: true)
    }
}

extension Endpoint where Response == ItemsResponse<AmericanoTournament> {
    static func myAmericanoTournaments() -> Endpoint<ItemsResponse<AmericanoTournament>> {
        Endpoint(method: .get, path: "/api/v1/americano/tournaments/my", requiresAuth: true)
    }
}

extension Endpoint where Response == MatchScore {
    static func reportGameResult(
        gameId: String,
        teamAUserIds: [String],
        teamBUserIds: [String],
        sets: [MatchResultSetBody]
    ) -> Endpoint<MatchScore> {
        let body: [String: Any] = [
            "team_a_user_ids": teamAUserIds,
            "team_b_user_ids": teamBUserIds,
            "sets": sets.map { ["a": $0.a, "b": $0.b] },
        ]
        return Endpoint(method: .post, path: "/api/v1/games/\(gameId)/result", body: encodePlayerAPIJSON(body), requiresAuth: true)
    }
}

// MARK: - Account extras and messaging counters

struct UnreadCountsResponse: Decodable, Equatable {
    let notifications: Int?
    let conversations: Int?
    let total: Int?
}

extension Endpoint where Response == UnreadCountsResponse {
    static func unreadCounts() -> Endpoint<UnreadCountsResponse> {
        Endpoint(method: .get, path: "/api/v1/me/unread-counts", requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    static func changePassword(currentPassword: String, newPassword: String) -> Endpoint<EmptyResponse> {
        Endpoint(
            method: .post,
            path: "/api/v1/me/change-password",
            body: encodePlayerAPIJSON(["current_password": currentPassword, "password": newPassword]),
            requiresAuth: true
        )
    }

    static func changeEmail(email: String) -> Endpoint<EmptyResponse> {
        Endpoint(
            method: .post,
            path: "/api/v1/me/change-email",
            body: encodePlayerAPIJSON(["email": email]),
            requiresAuth: true
        )
    }

    static func updateDailyDigest(enabled: Bool) -> Endpoint<EmptyResponse> {
        Endpoint(
            method: .put,
            path: "/api/v1/me/notification-preferences/daily-digest",
            body: encodePlayerAPIJSON(["enabled": enabled]),
            requiresAuth: true
        )
    }
}

private func encodePlayerAPIJSON(_ value: Any) -> Data? {
    try? JSONSerialization.data(withJSONObject: value)
}
