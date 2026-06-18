import Foundation

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

struct Endpoint<Response: Decodable> {
    let method: HTTPMethod
    let path: String
    var query: [URLQueryItem] = []
    var body: Data? = nil
    var requiresAuth: Bool = false
}

// MARK: - Models

struct HealthResponse: Decodable, Equatable {
    let ok: Bool?
    let status: String?
    let uptime_seconds: Int?
    let version: String?
    let db: String?
    let checks: [String: String]?
}

struct PublicUser: Decodable, Equatable, Identifiable {
    let id: String
    let email: String
    let display_name: String
    let username: String?
    let photo_url: String?
    let home_lat: Double?
    let home_lng: Double?
    let created_at: String
    /// ISO timestamp the user completed the magic-link verification flow.
    /// `nil` until the EmailVerification agent flips it server-side.
    /// Optional so older payloads (pre-email-agent) still decode.
    let email_verified_at: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(String.self, forKey: .id)
        self.email = try c.decode(String.self, forKey: .email)
        self.display_name = try c.decode(String.self, forKey: .display_name)
        self.username = try c.decodeIfPresent(String.self, forKey: .username)
        self.photo_url = try c.decodeIfPresent(String.self, forKey: .photo_url)
        self.home_lat = try c.decodeIfPresent(Double.self, forKey: .home_lat)
        self.home_lng = try c.decodeIfPresent(Double.self, forKey: .home_lng)
        self.created_at = try c.decode(String.self, forKey: .created_at)
        self.email_verified_at = try c.decodeIfPresent(String.self, forKey: .email_verified_at)
    }

    private enum CodingKeys: String, CodingKey {
        case id, email, display_name, username, photo_url, home_lat, home_lng, created_at, email_verified_at
    }
}

struct AuthSession: Decodable, Equatable {
    let user: PublicUser
    let access_token: String
    let refresh_token: String
    let access_token_expires_in_seconds: Int
}

struct Sport: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let slug: String
    let name: String
    let min_players: Int
    let max_players: Int
}

struct Court: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let venue_id: String
    let sport_id: String
    let sport_slug: String
    let name: String
    let hourly_price_minor: Int
    let currency: String
}

// `Codable` (not just `Decodable`) so the offline `ResponseCache` can
// round-trip cached venue lists through UserDefaults.
struct Venue: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let address: String
    let lat: Double
    let lng: Double
    let is_partner: Bool
    let phone: String?
    let description: String?
    let distance_km: Double?
    /// Cover photo URL (server keeps it in sync with `photo_urls[0]`).
    let photo_url: String?
    /// Full image gallery. Defaults to `[]` for older payloads that
    /// don't yet ship the field — render still works (falls back to
    /// the illustration hero).
    let photo_urls: [String]?
    /// Star-rating summary for the listing card.
    let rating_avg: Double?
    let rating_count: Int?
}

struct VenueDetail: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let address: String
    let lat: Double
    let lng: Double
    let is_partner: Bool
    let phone: String?
    let description: String?
    let distance_km: Double?
    let courts: [Court]
    /// Cover photo URL (mirrors `photo_urls[0]` server-side).
    let photo_url: String?
    /// Full image gallery for the venue / its courts.
    let photo_urls: [String]?
    /// Aggregated review summary.
    let rating_avg: Double?
    let rating_count: Int?
}

// `Codable` so containing structs (GameSummary, GameDetail) can round-trip
// through ResponseCache. Raw-value enums get this for free.
enum GameStatus: String, Codable, Equatable {
    case open, full, cancelled, completed
}
enum GameVisibility: String, Codable, Equatable {
    case `public`, invite
}
enum ParticipantStatus: String, Codable, Equatable {
    case confirmed, cancelled, no_show, played
}

// `Codable` so `ResponseCache` can persist the home-games list offline.
struct GameSummary: Codable, Equatable, Identifiable {
    let id: String
    let sport_id: String
    let sport_slug: String
    let host_user_id: String
    let host_display_name: String
    let court_id: String?
    let venue_name: String?
    let venue_photo_url: String?
    let lat: Double
    let lng: Double
    let starts_at: String
    let duration_minutes: Int
    let capacity: Int
    let participants_count: Int
    let status: GameStatus
    let visibility: GameVisibility
    let skill_min_elo: Int?
    let skill_max_elo: Int?
    let distance_km: Double?
}

struct Participant: Decodable, Equatable, Identifiable {
    var id: String { user_id }
    let user_id: String
    let display_name: String
    let photo_url: String?
    let status: ParticipantStatus
    let joined_at: String
}

struct GameDetail: Decodable, Equatable, Identifiable {
    let id: String
    let sport_id: String
    let sport_slug: String
    let host_user_id: String
    let host_display_name: String
    let court_id: String?
    let venue_name: String?
    let venue_photo_url: String?
    let lat: Double
    let lng: Double
    let starts_at: String
    let duration_minutes: Int
    let capacity: Int
    let participants_count: Int
    let status: GameStatus
    let visibility: GameVisibility
    let skill_min_elo: Int?
    let skill_max_elo: Int?
    let distance_km: Double?
    let notes: String?
    let participants: [Participant]
    let created_at: String
}

struct SportStats: Decodable, Equatable, Identifiable {
    var id: String { sport_id }
    let sport_id: String
    let sport_slug: String
    let elo_rating: Int
    let games_played: Int
    let games_won: Int
    let reliability_score: Int
}

struct PublicProfile: Decodable, Equatable, Identifiable {
    let id: String
    let display_name: String
    let username: String?
    let photo_url: String?
    let created_at: String
    let stats: [SportStats]
    /// Followers / following counts. Marked optional so existing
    /// payloads (which don't yet ship these fields) still decode —
    /// backend can roll the change out gradually without breaking
    /// older clients.
    let followers_count: Int?
    let following_count: Int?
    /// Whether the requesting (authenticated) user is currently following
    /// this profile. Optional so older payloads (and unauthenticated
    /// fetches) still decode — defaults to `false` at the call site.
    let is_following: Bool?
    /// Whether THIS profile follows the requesting viewer back. Drives the
    /// "Follows you" pill in the hero block, the "Follow back" CTA, and
    /// the "Mutual" indicator. Optional for back-compat with older
    /// payloads that don't yet ship the field — defaults to `false`.
    let follows_viewer: Bool?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(String.self, forKey: .id)
        self.display_name = try c.decode(String.self, forKey: .display_name)
        self.username = try c.decodeIfPresent(String.self, forKey: .username)
        self.photo_url = try c.decodeIfPresent(String.self, forKey: .photo_url)
        self.created_at = try c.decode(String.self, forKey: .created_at)
        self.stats = try c.decode([SportStats].self, forKey: .stats)
        self.followers_count = try c.decodeIfPresent(Int.self, forKey: .followers_count)
        self.following_count = try c.decodeIfPresent(Int.self, forKey: .following_count)
        self.is_following = try c.decodeIfPresent(Bool.self, forKey: .is_following)
            ?? c.decodeIfPresent(Bool.self, forKey: .is_followed_by_me)
        self.follows_viewer = try c.decodeIfPresent(Bool.self, forKey: .follows_viewer)
    }

    private enum CodingKeys: String, CodingKey {
        case id, display_name, username, photo_url, created_at, stats
        case followers_count, following_count, is_following, is_followed_by_me, follows_viewer
    }
}

struct ItemsResponse<T: Decodable>: Decodable {
    let items: [T]
}
struct PagedItemsResponse<T: Decodable>: Decodable {
    let items: [T]
    let next_cursor: String?
}
struct SubmitRatingsResponse: Decodable, Equatable {
    let recorded: Int
    let skipped_duplicates: Int
}
struct EmptyResponse: Decodable, Equatable {}

// MARK: - Social models

enum NotificationKind: String, Decodable, Equatable {
    case game_joined, game_cancelled, game_reminder
    case no_show_marked, rating_received, tournament_invite
    case message_received, system
    /// Server kinds added for deep-linking from the inbox. `follow`
    /// points at a profile via `payload.follower_user_id`;
    /// `game_invite` opens a game detail via `payload.game_id`.
    case follow, game_invite
}

/// Optional deep-link metadata server emits alongside each notification.
/// All fields are optional — only a subset is relevant for any given
/// `NotificationKind`. The struct tolerates missing keys so older payloads
/// (and unknown shapes added server-side later) still decode cleanly.
struct NotificationPayload: Decodable, Equatable, Hashable, Sendable {
    let conversation_id: String?
    let game_id: String?
    let user_id: String?
    let follower_user_id: String?
    let venue_id: String?
    /// Discriminator for notifications that reuse an existing `type`
    /// (currently game-invites ride on `tournament_invite` with
    /// `kind == "game_invite"`). Optional so older payloads that don't
    /// set it still decode cleanly.
    let kind: String?
    /// Set on game-invite notifications so the Inbox tap can route
    /// straight to the accept/decline action without re-listing.
    let invitation_id: String?
}

struct AppNotification: Decodable, Equatable, Identifiable {
    let id: String
    let type: NotificationKind
    let title: String
    let body: String
    let read_at: String?
    let created_at: String
    let payload: NotificationPayload?

    /// Manual decoder so existing payloads that omit `payload` continue
    /// to decode without error (the server has shipped this field
    /// inconsistently across notification kinds and historical rows).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(String.self, forKey: .id)
        self.type = try c.decode(NotificationKind.self, forKey: .type)
        self.title = try c.decode(String.self, forKey: .title)
        self.body = try c.decode(String.self, forKey: .body)
        self.read_at = try c.decodeIfPresent(String.self, forKey: .read_at)
        self.created_at = try c.decode(String.self, forKey: .created_at)
        self.payload = try c.decodeIfPresent(NotificationPayload.self, forKey: .payload)
    }

    /// Memberwise initializer preserved so the view model can rebuild
    /// `AppNotification` values when optimistically flipping `read_at`.
    init(
        id: String,
        type: NotificationKind,
        title: String,
        body: String,
        read_at: String?,
        created_at: String,
        payload: NotificationPayload? = nil
    ) {
        self.id = id
        self.type = type
        self.title = title
        self.body = body
        self.read_at = read_at
        self.created_at = created_at
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case id, type, title, body, read_at, created_at, payload
    }
}

struct NotificationsResponse: Decodable, Equatable {
    let items: [AppNotification]
    let unread_count: Int
}

struct ConversationSummary: Decodable, Equatable, Identifiable {
    let id: String
    let other_user_id: String
    let other_display_name: String
    let other_photo_url: String?
    let last_message_body: String?
    let last_message_at: String?
    let unread: Bool
}

enum MessageAttachmentType: String, Decodable, Equatable, Hashable {
    case image, voice
}

struct Message: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let conversation_id: String
    let sender_user_id: String
    let body: String
    let attachment_url: String?
    let attachment_type: MessageAttachmentType?
    let created_at: String

    /// Backwards-compatible decoder — older payloads that predate the
    /// attachment columns omit those keys entirely.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(String.self, forKey: .id)
        self.conversation_id = try c.decode(String.self, forKey: .conversation_id)
        self.sender_user_id = try c.decode(String.self, forKey: .sender_user_id)
        self.body = try c.decode(String.self, forKey: .body)
        self.attachment_url = try c.decodeIfPresent(String.self, forKey: .attachment_url)
        self.attachment_type = try c.decodeIfPresent(MessageAttachmentType.self, forKey: .attachment_type)
        self.created_at = try c.decode(String.self, forKey: .created_at)
    }

    private enum CodingKeys: String, CodingKey {
        case id, conversation_id, sender_user_id, body
        case attachment_url, attachment_type, created_at
    }
}

struct UploadImageResponse: Decodable, Equatable {
    let url: String
}

struct ConversationThread: Decodable, Equatable {
    let conversation_id: String
    let other_user_id: String
    let other_display_name: String
    let other_last_read_at: String?
    let messages: [Message]
}

struct ConversationCreatedResponse: Decodable, Equatable {
    let conversation_id: String
}

struct RankingItem: Decodable, Equatable, Identifiable {
    var id: String { user_id }
    let rank: Int
    let user_id: String
    let display_name: String
    let photo_url: String?
    let elo_rating: Int
    let games_played: Int
    let games_won: Int
    let reliability_score: Int
}

struct RankingsResponse: Decodable, Equatable {
    let sport_slug: String
    let items: [RankingItem]
}

// `Codable` so `ResponseCache` can persist the unfiltered players list offline.
struct PlayerSummary: Codable, Equatable, Identifiable {
    let id: String
    let display_name: String
    let photo_url: String?
    let primary_sport: String?
    let primary_elo: Int?
    let reliability_score: Int?
    let distance_km: Double?
    /// Whether the current authenticated viewer follows this player. Optional
    /// so older payloads (and unauthenticated calls) still decode.
    let is_followed_by_me: Bool?
    /// Total followers this player has. Optional for backward compat.
    let followers_count: Int?
    /// Real-time active status from backend auth guard.
    let last_seen_at: String?
}

struct Tournament: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let sport_id: String
    let sport_slug: String
    let venue_id: String?
    let venue_name: String?
    let starts_at: String
    let ends_at: String
    let registration_deadline: String?
    let max_squads: Int
    let squad_size: Int
    let entry_fee_minor: Int
    let currency: String
    let status: String
    let entries_count: Int
}

// MARK: - Endpoint constructors

extension Endpoint where Response == HealthResponse {
    static var health: Endpoint<HealthResponse> {
        Endpoint(method: .get, path: "/health")
    }

    static var healthReady: Endpoint<HealthResponse> {
        Endpoint(method: .get, path: "/health/ready")
    }
}

extension Endpoint where Response == AuthSession {
    static func register(email: String, password: String, displayName: String,
                         birthDate: String? = nil) -> Endpoint<AuthSession> {
        var body: [String: Any] = [
            "email": email,
            "password": password,
            "display_name": displayName,
        ]
        if let birthDate { body["birth_date"] = birthDate }
        return Endpoint(method: .post, path: "/api/v1/auth/register",
                        body: encodeJSON(body))
    }
    static func login(email: String, password: String) -> Endpoint<AuthSession> {
        Endpoint(method: .post, path: "/api/v1/auth/login",
                 body: encodeJSON(["email": email, "password": password]))
    }
    static func refresh(refreshToken: String) -> Endpoint<AuthSession> {
        Endpoint(method: .post, path: "/api/v1/auth/refresh",
                 body: encodeJSON(["refresh_token": refreshToken]))
    }
}

extension Endpoint where Response == EmptyResponse {
    static func logout(refreshToken: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .post, path: "/api/v1/auth/logout",
                 body: encodeJSON(["refresh_token": refreshToken]))
    }
}

extension Endpoint where Response == PublicUser {
    static var me: Endpoint<PublicUser> {
        Endpoint(method: .get, path: "/api/v1/me", requiresAuth: true)
    }
    static func updateMe(displayName: String? = nil,
                         photoUrl: String?? = nil,
                         homeLat: Double? = nil,
                         homeLng: Double? = nil) -> Endpoint<PublicUser> {
        var body: [String: Any] = [:]
        if let displayName { body["display_name"] = displayName }
        if let photoUrl    { body["photo_url"] = photoUrl as Any }
        if let homeLat     { body["home_lat"] = homeLat }
        if let homeLng     { body["home_lng"] = homeLng }
        return Endpoint(method: .patch, path: "/api/v1/me",
                        body: encodeJSON(body), requiresAuth: true)
    }
}

extension Endpoint where Response == ItemsResponse<Sport> {
    static var sports: Endpoint<ItemsResponse<Sport>> {
        Endpoint(method: .get, path: "/api/v1/sports")
    }
}

extension Endpoint where Response == ItemsResponse<Venue> {
    static func venues(lat: Double? = nil, lng: Double? = nil, radiusKm: Double? = nil,
                       sport: String? = nil) -> Endpoint<ItemsResponse<Venue>> {
        var query: [URLQueryItem] = []
        if let lat      { query.append(.init(name: "lat", value: "\(lat)")) }
        if let lng      { query.append(.init(name: "lng", value: "\(lng)")) }
        if let radiusKm { query.append(.init(name: "radius_km", value: "\(radiusKm)")) }
        if let sport    { query.append(.init(name: "sport", value: sport)) }
        return Endpoint(method: .get, path: "/api/v1/venues", query: query)
    }
}

extension Endpoint where Response == VenueDetail {
    static func venue(id: String) -> Endpoint<VenueDetail> {
        Endpoint(method: .get, path: "/api/v1/venues/\(id)")
    }
}

extension Endpoint where Response == PagedItemsResponse<GameSummary> {
    static func games(lat: Double? = nil, lng: Double? = nil, radiusKm: Double? = nil,
                      sport: String? = nil, from: String? = nil, to: String? = nil,
                      cursor: String? = nil, limit: Int? = nil) -> Endpoint<PagedItemsResponse<GameSummary>> {
        var query: [URLQueryItem] = []
        // The server requires lat, lng and radius_km together — if a caller
        // supplies just lat/lng we backfill a sensible default radius so the
        // request doesn't get rejected at validation time.
        let effectiveRadius: Double? = {
            if let radiusKm { return radiusKm }
            if lat != nil && lng != nil { return 50 }
            return nil
        }()
        if let lat              { query.append(.init(name: "lat", value: "\(lat)")) }
        if let lng              { query.append(.init(name: "lng", value: "\(lng)")) }
        if let effectiveRadius  { query.append(.init(name: "radius_km", value: "\(effectiveRadius)")) }
        if let sport            { query.append(.init(name: "sport", value: sport)) }
        if let from             { query.append(.init(name: "from", value: from)) }
        if let to               { query.append(.init(name: "to", value: to)) }
        if let cursor           { query.append(.init(name: "cursor", value: cursor)) }
        if let limit            { query.append(.init(name: "limit", value: "\(limit)")) }
        return Endpoint(method: .get, path: "/api/v1/games", query: query, requiresAuth: true)
    }
}

struct CreateGameBody: Encodable {
    let sport_id: String
    let court_id: String?
    let lat: Double
    let lng: Double
    let starts_at: String
    let duration_minutes: Int
    let capacity: Int?
    let skill_min_elo: Int?
    let skill_max_elo: Int?
    let notes: String?
    /// Client-generated UUID, stable across retries of the same form
    /// session, so a timed-out POST that actually landed doesn't mint a
    /// duplicate game on re-submit. Optional — older backends ignore it.
    let idempotency_key: String?
}

extension Endpoint where Response == GameDetail {
    static func createGame(_ body: CreateGameBody) -> Endpoint<GameDetail> {
        Endpoint(method: .post, path: "/api/v1/games",
                 body: try? JSONEncoder().encode(body), requiresAuth: true)
    }
    static func game(id: String) -> Endpoint<GameDetail> {
        Endpoint(method: .get, path: "/api/v1/games/\(id)")
    }
    static func joinGame(id: String) -> Endpoint<GameDetail> {
        Endpoint(method: .post, path: "/api/v1/games/\(id)/join", requiresAuth: true)
    }
    static func leaveGame(id: String) -> Endpoint<GameDetail> {
        Endpoint(method: .post, path: "/api/v1/games/\(id)/leave", requiresAuth: true)
    }
    static func cancelGame(id: String) -> Endpoint<GameDetail> {
        Endpoint(method: .patch, path: "/api/v1/games/\(id)",
                 body: encodeJSON(["cancel": true]),
                 requiresAuth: true)
    }
    /// Wave-10 reschedule endpoint. Returns the refreshed game detail so
    /// the host's sheet can dismiss + the detail re-renders in one
    /// round-trip. `duration_minutes` is optional — pass `nil` to keep
    /// the existing duration.
    static func rescheduleGame(id: String,
                               startsAt: String,
                               durationMinutes: Int?) -> Endpoint<GameDetail> {
        var body: [String: Any] = ["starts_at": startsAt]
        if let d = durationMinutes { body["duration_minutes"] = d }
        return Endpoint(method: .patch,
                        path: "/api/v1/games/\(id)/reschedule",
                        body: encodeJSON(body),
                        requiresAuth: true)
    }
    /// Host-only post-match action — flags a participant who didn't
    /// show up. The backend drops their `reliability_score` and
    /// returns the refreshed game detail with the participant's
    /// status flipped to `.no_show`.
    static func markNoShow(gameId: String, userId: String) -> Endpoint<GameDetail> {
        Endpoint(method: .post,
                 path: "/api/v1/games/\(gameId)/participants/\(userId)/no-show",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    /// Wave-10 dedicated cancel endpoint. Distinct from the legacy
    /// `cancelGame(id:)` PATCH path — this one carries an optional
    /// free-text reason that the backend fans into participant push
    /// notifications. Returns 204 → `EmptyResponse`.
    static func cancelGameWithReason(id: String, reason: String?) -> Endpoint<EmptyResponse> {
        var body: [String: Any] = [:]
        if let r = reason?.trimmingCharacters(in: .whitespacesAndNewlines), !r.isEmpty {
            body["reason"] = r
        }
        return Endpoint(method: .post,
                        path: "/api/v1/games/\(id)/cancel",
                        body: encodeJSON(body),
                        requiresAuth: true)
    }
}

struct RatingItemBody: Encodable, Equatable, Identifiable {
    var id: String { rated_user_id }
    let rated_user_id: String
    let outcome: String
    let behavior_ok: Bool
    /// 1-5 star skill rating. Optional so existing clients/servers that
    /// only ship `outcome` + `behavior_ok` keep working.
    let stars: Int?
    /// Short behavior labels — values like `team_player`, `fair_play`,
    /// `no_show`. Backend may persist these for later aggregation; the
    /// client just forwards them.
    let tags: [String]?

    init(rated_user_id: String, outcome: String, behavior_ok: Bool,
         stars: Int? = nil, tags: [String]? = nil) {
        self.rated_user_id = rated_user_id
        self.outcome = outcome
        self.behavior_ok = behavior_ok
        self.stars = stars
        self.tags = tags
    }
}

extension Endpoint where Response == SubmitRatingsResponse {
    static func submitRatings(gameId: String, ratings: [RatingItemBody]) -> Endpoint<SubmitRatingsResponse> {
        let body: [String: Any] = [
            "ratings": ratings.map { r -> [String: Any] in
                var item: [String: Any] = [
                    "rated_user_id": r.rated_user_id,
                    "outcome": r.outcome,
                    "behavior_ok": r.behavior_ok,
                ]
                if let s = r.stars { item["stars"] = s }
                if let t = r.tags, !t.isEmpty { item["tags"] = t }
                return item
            },
        ]
        return Endpoint(method: .post, path: "/api/v1/games/\(gameId)/ratings",
                        body: encodeJSON(body), requiresAuth: true)
    }
}

extension Endpoint where Response == PublicProfile {
    /// Public profile read. The endpoint is technically anonymous-friendly
    /// (no `preHandler: authenticate`), but it READS the Bearer token via
    /// soft-auth to populate `is_following` / `follows_viewer` /
    /// `top_skill_level` against the viewer. Without `requiresAuth: true`,
    /// APIClient strips the Authorization header and the backend can't
    /// see who the viewer is — so `is_following` always comes back false
    /// and the Follow button flips back after every refresh (FAZA 76).
    static func profile(id: String) -> Endpoint<PublicProfile> {
        Endpoint(method: .get, path: "/api/v1/users/\(id)/profile", requiresAuth: true)
    }
}

// MARK: - Social endpoints

extension Endpoint where Response == NotificationsResponse {
    static var notifications: Endpoint<NotificationsResponse> {
        Endpoint(method: .get, path: "/api/v1/notifications", requiresAuth: true)
    }
}
extension Endpoint where Response == EmptyResponse {
    static func markNotificationRead(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .post, path: "/api/v1/notifications/\(id)/read", requiresAuth: true)
    }
    static var markAllNotificationsRead: Endpoint<EmptyResponse> {
        Endpoint(method: .post, path: "/api/v1/notifications/read-all", requiresAuth: true)
    }

    /// Delete a single notification. DELETE /api/v1/notifications/:id — returns 204.
    static func deleteNotification(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete, path: "/api/v1/notifications/\(id)", requiresAuth: true)
    }

    /// Delete every notification for the current user. DELETE /api/v1/notifications — returns 204.
    static func deleteAllNotifications() -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete, path: "/api/v1/notifications", requiresAuth: true)
    }

    /// Follow a user. POST /api/v1/users/:id/follow — returns no body.
    static func followUser(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .post, path: "/api/v1/users/\(id)/follow", requiresAuth: true)
    }

    /// Unfollow a user. DELETE /api/v1/users/:id/follow — returns no body.
    static func unfollowUser(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete, path: "/api/v1/users/\(id)/follow", requiresAuth: true)
    }

    /// Block a user. POST /api/v1/users/:id/block — returns no body.
    /// Side-effect on the backend: also tears down any mutual follow edges
    /// so the blocked user disappears from the feed on next refresh.
    static func blockUser(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .post, path: "/api/v1/users/\(id)/block", requiresAuth: true)
    }

    /// Unblock a user. DELETE /api/v1/users/:id/block — returns no body.
    static func unblockUser(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete, path: "/api/v1/users/\(id)/block", requiresAuth: true)
    }
}

extension Endpoint where Response == ItemsResponse<ConversationSummary> {
    static var conversations: Endpoint<ItemsResponse<ConversationSummary>> {
        Endpoint(method: .get, path: "/api/v1/conversations", requiresAuth: true)
    }
}
extension Endpoint where Response == ConversationThread {
    static func conversationThread(id: String) -> Endpoint<ConversationThread> {
        Endpoint(method: .get, path: "/api/v1/conversations/\(id)", requiresAuth: true)
    }
}
extension Endpoint where Response == ConversationCreatedResponse {
    static func startConversation(otherUserId: String) -> Endpoint<ConversationCreatedResponse> {
        Endpoint(method: .post, path: "/api/v1/conversations",
                 body: encodeJSON(["other_user_id": otherUserId]),
                 requiresAuth: true)
    }
}
extension Endpoint where Response == EmptyResponse {
    /// Delete a single conversation for the current user. DELETE
    /// /api/v1/conversations/:id — returns 204. The server soft-deletes the
    /// thread from this user's inbox only; the other party still sees it.
    static func deleteConversation(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete, path: "/api/v1/conversations/\(id)", requiresAuth: true)
    }

    static func markConversationRead(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .post, path: "/api/v1/conversations/\(id)/read", requiresAuth: true)
    }

    static func sendTypingStatus(id: String, isTyping: Bool) -> Endpoint<EmptyResponse> {
        Endpoint(method: .post, path: "/api/v1/conversations/\(id)/typing",
                 body: encodeJSON(["is_typing": isTyping]),
                 requiresAuth: true)
    }
}
extension Endpoint where Response == Message {
    static func sendMessage(conversationId: String, body: String) -> Endpoint<Message> {
        Endpoint(method: .post, path: "/api/v1/conversations/\(conversationId)/messages",
                 body: encodeJSON(["body": body]),
                 requiresAuth: true)
    }

    /// Send a message with an image attachment. The caller is responsible for
    /// uploading the image first via `Endpoint<UploadImageResponse>.uploadImage`
    /// and passing the returned URL through unchanged. `caption` may be empty
    /// for an image-only message.
    static func sendImageMessage(conversationId: String,
                                 attachmentUrl: String,
                                 caption: String) -> Endpoint<Message> {
        var payload: [String: Any] = [
            "attachment_url": attachmentUrl,
            "attachment_type": "image",
        ]
        let trimmed = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            payload["body"] = trimmed
        }
        return Endpoint(method: .post,
                        path: "/api/v1/conversations/\(conversationId)/messages",
                        body: encodeJSON(payload),
                        requiresAuth: true)
    }
}

extension Endpoint where Response == UploadImageResponse {
    /// Marker endpoint — the actual multipart upload is handled in
    /// `APIClient.uploadImage(...)` since `Endpoint` only models JSON bodies.
    static var uploadImage: Endpoint<UploadImageResponse> {
        Endpoint(method: .post, path: "/api/v1/messages/upload-image", requiresAuth: true)
    }
}

extension Endpoint where Response == RankingsResponse {
    static func rankings(sport: String, limit: Int = 50) -> Endpoint<RankingsResponse> {
        Endpoint(method: .get, path: "/api/v1/rankings",
                 query: [.init(name: "sport", value: sport),
                         .init(name: "limit", value: "\(limit)")])
    }
}

extension Endpoint where Response == ItemsResponse<PlayerSummary> {
    static func players(q: String? = nil, sport: String? = nil,
                        minElo: Int? = nil, maxElo: Int? = nil,
                        lat: Double? = nil, lng: Double? = nil, radiusKm: Double? = nil,
                        limit: Int? = nil) -> Endpoint<ItemsResponse<PlayerSummary>> {
        var q2: [URLQueryItem] = []
        if let q       { q2.append(.init(name: "q", value: q)) }
        if let sport   { q2.append(.init(name: "sport", value: sport)) }
        if let minElo  { q2.append(.init(name: "min_elo", value: "\(minElo)")) }
        if let maxElo  { q2.append(.init(name: "max_elo", value: "\(maxElo)")) }
        if let lat     { q2.append(.init(name: "lat", value: "\(lat)")) }
        if let lng     { q2.append(.init(name: "lng", value: "\(lng)")) }
        if let radiusKm { q2.append(.init(name: "radius_km", value: "\(radiusKm)")) }
        if let limit    { q2.append(.init(name: "limit", value: "\(limit)")) }
        return Endpoint(method: .get, path: "/api/v1/players", query: q2, requiresAuth: true)
    }
}

extension Endpoint where Response == ItemsResponse<Tournament> {
    static var tournaments: Endpoint<ItemsResponse<Tournament>> {
        Endpoint(method: .get, path: "/api/v1/tournaments")
    }
}

// MARK: - Follows (Players agent — owns followers/following lists)

/// One row in the followers / following list. Mirrors the API's
/// `FollowEdgeUserSchema` exactly so decoding is a straight pass-through.
struct FollowEdge: Decodable, Equatable, Identifiable {
    let id: String
    let display_name: String
    let photo_url: String?
    let followed_at: String
    let is_following: Bool?
}

struct FollowsPage: Decodable, Equatable {
    let items: [FollowEdge]
    /// `nil` when the server has no more rows past the current window.
    let next_offset: Int?
}

extension Endpoint where Response == FollowsPage {
    static func followers(userId: String, limit: Int = 30, offset: Int = 0) -> Endpoint<FollowsPage> {
        Endpoint(method: .get, path: "/api/v1/users/\(userId)/followers",
                 query: [.init(name: "limit", value: "\(limit)"),
                         .init(name: "offset", value: "\(offset)")])
    }
    static func following(userId: String, limit: Int = 30, offset: Int = 0) -> Endpoint<FollowsPage> {
        Endpoint(method: .get, path: "/api/v1/users/\(userId)/following",
                 query: [.init(name: "limit", value: "\(limit)"),
                         .init(name: "offset", value: "\(offset)")])
    }
}

// MARK: - JSON helper

private func encodeJSON(_ value: Any) -> Data? {
    try? JSONSerialization.data(withJSONObject: value)
}

// MARK: - Tournaments agent

/// Filter bucket exposed to the iOS segmented chip. Translates to a logical
/// bucket on the server; mutually-exclusive with the raw `status` filter.
enum TournamentBucket: String, CaseIterable, Identifiable {
    case upcoming, live, past
    var id: String { rawValue }
}

extension Endpoint where Response == ItemsResponse<Tournament> {
    /// Filtered list. Sends the optional `bucket`+`sport` query params.
    static func tournaments(bucket: TournamentBucket?,
                            sport: String? = nil,
                            limit: Int? = nil) -> Endpoint<ItemsResponse<Tournament>> {
        var q: [URLQueryItem] = []
        if let bucket { q.append(.init(name: "bucket", value: bucket.rawValue)) }
        if let sport  { q.append(.init(name: "sport", value: sport)) }
        if let limit  { q.append(.init(name: "limit", value: "\(limit)")) }
        return Endpoint(method: .get, path: "/api/v1/tournaments", query: q)
    }
}

struct TournamentEntry: Decodable, Equatable, Identifiable {
    let id: String
    let tournament_id: String
    let captain_user_id: String
    let captain_display_name: String
    let captain_photo_url: String?
    let squad_name: String
    let player_ids: [String]
    let player_names: [String]
    let status: String
    let created_at: String
}

struct TournamentDetail: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let sport_id: String
    let sport_slug: String
    let venue_id: String?
    let venue_name: String?
    let starts_at: String
    let ends_at: String
    let registration_deadline: String?
    let max_squads: Int
    let squad_size: Int
    let entry_fee_minor: Int
    let currency: String
    let status: String
    let entries_count: Int
    let entries: [TournamentEntry]
    let my_entry: TournamentEntry?
    let can_register: Bool
    let registration_blocked_reason: String?
}

extension Endpoint where Response == TournamentDetail {
    /// Detail fetch — `requiresAuth=true` so the access token (if any) is
    /// attached, letting the server personalize `my_entry` / `can_register`.
    /// The endpoint also serves anonymous callers — the APIClient won't
    /// fail if the user isn't signed in; it simply omits the header.
    static func tournament(id: String) -> Endpoint<TournamentDetail> {
        Endpoint(method: .get, path: "/api/v1/tournaments/\(id)", requiresAuth: true)
    }
}

extension Endpoint where Response == TournamentEntry {
    static func registerTournamentSquad(tournamentId: String,
                                        squadName: String,
                                        playerIds: [String]) -> Endpoint<TournamentEntry> {
        let body: [String: Any] = [
            "squad_name": squadName,
            "player_ids": playerIds,
        ]
        return Endpoint(method: .post,
                        path: "/api/v1/tournaments/\(tournamentId)/entries",
                        body: encodeJSON(body),
                        requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    static func withdrawTournamentSquad(tournamentId: String,
                                        entryId: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete,
                 path: "/api/v1/tournaments/\(tournamentId)/entries/\(entryId)",
                 requiresAuth: true)
    }
}

// MARK: - Booking agent

enum BookingStatus: String, Decodable, Equatable {
    case pending_payment, partially_paid, paid, cancelled, refunded, failed
}

enum PaymentSplitStatus: String, Decodable, Equatable {
    case pending, authorized, captured, refunded, failed
}

struct PaymentSplit: Decodable, Equatable, Identifiable {
    let id: String
    let user_id: String
    let amount_minor: Int
    let status: PaymentSplitStatus
    let external_ref: String?
}

struct Booking: Decodable, Equatable, Identifiable {
    let id: String
    let game_id: String?
    let court_id: String
    let user_id: String
    let venue_id: String
    let venue_name: String
    let court_name: String
    let starts_at: String
    let ends_at: String
    let duration_minutes: Int
    let total_minor: Int
    let currency: String
    let status: BookingStatus
    let idempotency_key: String
    let external_ref: String?
    let created_at: String
    let paid_at: String?
    let cancelled_at: String?
    let splits: [PaymentSplit]
}

struct BookingsListResponse: Decodable, Equatable {
    let upcoming: [Booking]
    let past: [Booking]
}

/// Body for `POST /api/v1/bookings`. The `idempotency_key` MUST be a stable
/// UUID per attempt — the client should generate one when the user taps
/// Confirm and reuse it across retries so transient network failures don't
/// mint duplicate rows.
struct CreateBookingBody: Encodable {
    let court_id: String
    let starts_at: String
    let duration_minutes: Int
    let idempotency_key: String
}

extension Endpoint where Response == Booking {
    static func createBooking(_ body: CreateBookingBody) -> Endpoint<Booking> {
        Endpoint(method: .post, path: "/api/v1/bookings",
                 body: try? JSONEncoder().encode(body),
                 requiresAuth: true)
    }
    static func booking(id: String) -> Endpoint<Booking> {
        Endpoint(method: .get, path: "/api/v1/bookings/\(id)", requiresAuth: true)
    }
    static func cancelBooking(id: String) -> Endpoint<Booking> {
        Endpoint(method: .post, path: "/api/v1/bookings/\(id)/cancel", requiresAuth: true)
    }
    static func markBookingPaid(id: String) -> Endpoint<Booking> {
        Endpoint(method: .post, path: "/api/v1/bookings/\(id)/mark-paid", requiresAuth: true)
    }
}

extension Endpoint where Response == BookingsListResponse {
    static var myBookings: Endpoint<BookingsListResponse> {
        Endpoint(method: .get, path: "/api/v1/bookings/me", requiresAuth: true)
    }
}

struct CourtAvailabilitySlot: Decodable, Equatable, Hashable {
    let start_time: String
    let end_time: String
    let status: String
    let minutes_from_midnight: Int
    /// Additive flag set by newer backends when the slot is overlapped by an
    /// existing booking. Optional so payloads from older servers (which only
    /// carry `status`) keep decoding unchanged.
    let booked: Bool?

    /// True when the slot can't be booked — either the legacy `status`
    /// string says so or the newer `booked` flag is set.
    var isBooked: Bool {
        booked == true || status == "booked" || status == "unavailable"
    }
}

struct CourtAvailabilityResponse: Decodable, Equatable {
    let date: String
    let open_hour: Int
    let close_hour: Int
    let slots: [CourtAvailabilitySlot]
}

extension Endpoint where Response == CourtAvailabilityResponse {
    static func courtAvailability(courtId: String, date: String) -> Endpoint<CourtAvailabilityResponse> {
        Endpoint(method: .get, path: "/api/v1/courts/\(courtId)/availability",
                 query: [.init(name: "date", value: date)],
                 requiresAuth: false)
    }
}

// MARK: - In-app calendar agent

/// One row inside the agenda payload. `kind` discriminates which downstream
/// detail screen the row links to when tapped (game, booking, or tournament).
/// `venue_name` is optional because games without an assigned court (and the
/// occasional venue-less tournament) have no associated venue.
enum AgendaItemKind: String, Decodable, Equatable, Hashable {
    case game, booking, tournament
}

struct AgendaItem: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let kind: AgendaItemKind
    let starts_at: String
    let ends_at: String
    let title: String
    let venue_name: String?
}

struct AgendaResponse: Decodable, Equatable {
    let games: [AgendaItem]
    let bookings: [AgendaItem]
    let tournaments: [AgendaItem]
}

extension Endpoint where Response == AgendaResponse {
    /// Aggregated agenda for the signed-in user across a date range. `from`
    /// and `to` are inclusive calendar days in `YYYY-MM-DD`. The server
    /// returns games + bookings + tournaments in one shot so the month grid
    /// doesn't need three parallel fetches and three loading states.
    static func myAgenda(from: String, to: String) -> Endpoint<AgendaResponse> {
        Endpoint(
            method: .get,
            path: "/api/v1/me/agenda",
            query: [
                .init(name: "from", value: from),
                .init(name: "to", value: to),
            ],
            requiresAuth: true
        )
    }
}

// MARK: - Insights agent

/// One ELO sample on a calendar day. The backend stamps dates in UTC
/// `YYYY-MM-DD` form — we keep the wire shape as String and let the
/// view parse on demand. Charts work with `Date` after we decode.
struct InsightsEloPoint: Decodable, Equatable, Hashable {
    let date: String
    let elo: Int
}

struct InsightsWinRatePoint: Decodable, Equatable, Hashable {
    let date: String
    /// 0..100 percentage. Float because the backend emits e.g. 33.333…
    let win_rate: Double
    let games: Int
}

struct InsightsWeekBucket: Decodable, Equatable, Hashable {
    /// ISO date of Monday (`YYYY-MM-DD`).
    let week_start: String
    let games: Int
}

struct InsightsOpponent: Decodable, Equatable, Identifiable, Hashable {
    var id: String { user_id }
    let user_id: String
    let display_name: String
    let photo_url: String?
    let games_count: Int
    let wins: Int
    let losses: Int
    let draws: Int
    let win_rate: Double
}

struct InsightsReliabilityPoint: Decodable, Equatable, Hashable {
    let date: String
    let reliability: Int
}

struct InsightsResponse: Decodable, Equatable {
    let sport_slug: String
    let days: Int
    let total_games: Int
    let current_elo: Int
    let current_reliability: Int
    let elo_series: [InsightsEloPoint]
    let win_rate_series: [InsightsWinRatePoint]
    let games_per_week: [InsightsWeekBucket]
    let opponents: [InsightsOpponent]
    let reliability_series: [InsightsReliabilityPoint]
}

/// Window options exposed in the InsightsView header. The `days` value is
/// the query parameter we send the backend. `all` maps to a wide upper
/// bound — the backend caps at 1825 days (5y).
enum InsightsWindow: String, CaseIterable, Identifiable {
    case days30 = "30d"
    case days90 = "90d"
    case days365 = "1y"
    case all = "all"

    var id: String { rawValue }
    /// Maps to the backend `days` parameter. `all` collapses to the cap so
    /// the request body remains valid.
    var days: Int {
        switch self {
        case .days30:  return 30
        case .days90:  return 90
        case .days365: return 365
        case .all:     return 1825
        }
    }
}

extension Endpoint where Response == InsightsResponse {
    /// `GET /api/v1/me/insights?sport=<slug>&days=<n>`.
    /// Requires auth — the backend reads the rated_user_id from the token.
    static func insights(sport: String, days: Int) -> Endpoint<InsightsResponse> {
        Endpoint(
            method: .get,
            path: "/api/v1/me/insights",
            query: [
                .init(name: "sport", value: sport),
                .init(name: "days", value: "\(days)"),
            ],
            requiresAuth: true,
        )
    }
}

// MARK: - Search agent

/// The four entity types the global Search screen surfaces. Iterate over
/// `allCases` to render section headers / segmented chips in a stable order.
enum SearchResultType: String, CaseIterable, Identifiable, Hashable {
    case players, games, tournaments, venues
    var id: String { rawValue }
}

struct SearchPlayerResult: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let display_name: String
    let photo_url: String?
    let primary_sport: String?
    let primary_elo: Int?
}

struct SearchGameResult: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let sport_slug: String
    let host_display_name: String
    let venue_name: String?
    let starts_at: String
    let notes: String?
    let status: String
}

struct SearchTournamentResult: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let name: String
    let sport_slug: String
    let venue_name: String?
    let starts_at: String
    let status: String
}

struct SearchVenueResult: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let name: String
    let address: String
    let is_partner: Bool
}

struct SearchResponse: Decodable, Equatable {
    let query: String
    let players: [SearchPlayerResult]
    let games: [SearchGameResult]
    let tournaments: [SearchTournamentResult]
    let venues: [SearchVenueResult]

    /// `true` only when every bucket is empty — drives the empty-state copy
    /// on the Search screen.
    var isEmpty: Bool {
        players.isEmpty && games.isEmpty && tournaments.isEmpty && venues.isEmpty
    }
}

extension Endpoint where Response == SearchResponse {
    /// `GET /api/v1/search?q=...&type=...&limit=...`
    ///
    /// The endpoint is public; we never attach a token so anonymous
    /// discovery (pre-login) keeps working.
    static func search(q: String,
                       type: SearchResultType? = nil,
                       limit: Int? = nil) -> Endpoint<SearchResponse> {
        var query: [URLQueryItem] = [.init(name: "q", value: q)]
        if let type  { query.append(.init(name: "type", value: type.rawValue)) }
        if let limit { query.append(.init(name: "limit", value: "\(limit)")) }
        return Endpoint(method: .get, path: "/api/v1/search", query: query)
    }
}

// MARK: - Recurring agent

/// One materialized game inside a series. Carries just enough to render
/// the "12 games scheduled" success card — the full GameDetail is fetched
/// on tap from `/api/v1/games/:id`.
struct SeriesGameSummary: Decodable, Equatable, Identifiable {
    let id: String
    let occurrence_number: Int
    let starts_at: String
    let status: GameStatus
    let capacity: Int
    let participants_count: Int
}

/// Series template + materialized game list. `time_of_day` is `HH:MM:SS`
/// in server-side UTC; `day_of_week` is 0=Sunday … 6=Saturday so the
/// client can render localized weekday names without a translation table.
struct GameSeriesDetail: Decodable, Equatable, Identifiable {
    let id: String
    let host_user_id: String
    let sport_id: String
    let sport_slug: String
    let court_id: String?
    let venue_name: String?
    let lat: Double
    let lng: Double
    let day_of_week: Int
    let time_of_day: String
    let duration_minutes: Int
    let capacity: Int
    let occurrences: Int
    let starts_on: String
    let ends_on: String
    let status: String
    let notes: String?
    let created_at: String
    let games: [SeriesGameSummary]
}

/// Body for `POST /api/v1/game-series`. Mirrors the Zod schema 1:1.
/// `time_of_day` accepts `HH:MM`; the server normalizes to `HH:MM:SS`.
struct CreateGameSeriesBody: Encodable {
    let sport_id: String
    let court_id: String?
    let lat: Double
    let lng: Double
    let day_of_week: Int
    let time_of_day: String
    let duration_minutes: Int
    let capacity: Int
    let occurrences: Int
    let starts_on: String?
    let notes: String?
}

extension Endpoint where Response == GameSeriesDetail {
    static func createGameSeries(_ body: CreateGameSeriesBody) -> Endpoint<GameSeriesDetail> {
        Endpoint(method: .post, path: "/api/v1/game-series",
                 body: try? JSONEncoder().encode(body),
                 requiresAuth: true)
    }
    static func gameSeries(id: String) -> Endpoint<GameSeriesDetail> {
        Endpoint(method: .get, path: "/api/v1/game-series/\(id)", requiresAuth: true)
    }
}

struct CancelGameSeriesResponse: Decodable, Equatable {
    let cancelled_count: Int
}

extension Endpoint where Response == CancelGameSeriesResponse {
    /// Cancel every occurrence from `fromOccurrence` (1-indexed) forward.
    /// Pass `1` to cancel the entire series.
    static func cancelGameSeries(id: String, fromOccurrence: Int) -> Endpoint<CancelGameSeriesResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/game-series/\(id)/cancel",
                 body: encodeJSON(["from_occurrence": fromOccurrence]),
                 requiresAuth: true)
    }
}

// MARK: - Push agent (device-tokens)

extension Endpoint where Response == DeviceTokenResponse {
    /// Register the current device's APNs token. The hex string MUST match
    /// what UIKit hands us in `didRegisterForRemoteNotificationsWithDeviceToken`
    /// — we don't transform it.
    static func registerDevice(token: String, platform: String) -> Endpoint<DeviceTokenResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/me/devices",
                 body: encodeJSON(["token": token, "platform": platform]),
                 requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    /// Revoke a previously-registered device token. Called on explicit
    /// sign-out so the server stops fanning future pushes at this device.
    static func revokeDevice(token: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete,
                 path: "/api/v1/me/devices/\(token)",
                 requiresAuth: true)
    }
}

// MARK: - Invitations agent

/// Game-invitation status mirroring the server enum. iOS uses lowercase raw
/// values so JSON decoding is a straight pass-through.
enum InvitationStatus: String, Decodable, Equatable {
    case pending, accepted, declined, expired
}

/// Slim game card embedded in each invitation row. Mirrors
/// `InvitationGamePreviewSchema` on the server.
struct InvitationGamePreview: Decodable, Equatable, Identifiable {
    let id: String
    let sport_id: String
    let sport_slug: String
    let host_user_id: String
    let host_display_name: String
    let court_id: String?
    let venue_name: String?
    let lat: Double
    let lng: Double
    let starts_at: String
    let duration_minutes: Int
    let capacity: Int
    let participants_count: Int
    let status: GameStatus
    let visibility: GameVisibility
}

struct GameInvitation: Decodable, Equatable, Identifiable {
    let id: String
    let game_id: String
    let inviter_user_id: String
    let inviter_display_name: String
    let inviter_photo_url: String?
    let invitee_user_id: String
    let status: InvitationStatus
    let created_at: String
    let responded_at: String?
    let game: InvitationGamePreview
}

struct AcceptInvitationResult: Decodable, Equatable {
    let invitation: GameInvitation
    let game_id: String
}

struct DeclineInvitationResult: Decodable, Equatable {
    let invitation: GameInvitation
}

extension Endpoint where Response == GameInvitation {
    /// Host invites a player. Returns the freshly-created `pending` invitation.
    static func createGameInvitation(gameId: String,
                                     inviteeUserId: String) -> Endpoint<GameInvitation> {
        Endpoint(method: .post,
                 path: "/api/v1/games/\(gameId)/invite",
                 body: encodeJSON(["invitee_user_id": inviteeUserId]),
                 requiresAuth: true)
    }
}

extension Endpoint where Response == ItemsResponse<GameInvitation> {
    /// Invitee's invitations inbox. Pass `status` to filter — default is the
    /// most useful "pending" bucket.
    static func myInvitations(status: InvitationStatus? = .pending) -> Endpoint<ItemsResponse<GameInvitation>> {
        var query: [URLQueryItem] = []
        if let status { query.append(.init(name: "status", value: status.rawValue)) }
        return Endpoint(method: .get, path: "/api/v1/me/invitations",
                        query: query, requiresAuth: true)
    }
}

extension Endpoint where Response == AcceptInvitationResult {
    static func acceptInvitation(id: String) -> Endpoint<AcceptInvitationResult> {
        Endpoint(method: .post, path: "/api/v1/invitations/\(id)/accept",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == DeclineInvitationResult {
    static func declineInvitation(id: String) -> Endpoint<DeclineInvitationResult> {
        Endpoint(method: .post, path: "/api/v1/invitations/\(id)/decline",
                 requiresAuth: true)
    }
}

/// Response from POST /api/v1/games/:id/invitations (batch). `sent` = newly
/// created pending invitations, `blocked` = duplicates/already-in/self/
/// closed-game rows that the server quietly dropped.
struct BatchInviteResult: Decodable, Equatable {
    let sent: Int
    let blocked: Int
}

extension Endpoint where Response == BatchInviteResult {
    /// Host batch-invites multiple players (e.g. their followers after
    /// creating a game). The server iterates server-side and returns counts;
    /// per-row errors are intentionally swallowed so the client doesn't
    /// have to reconcile partial failures.
    static func batchInviteToGame(gameId: String,
                                  userIds: [String]) -> Endpoint<BatchInviteResult> {
        Endpoint(method: .post,
                 path: "/api/v1/games/\(gameId)/invitations",
                 body: encodeJSON(["user_ids": userIds]),
                 requiresAuth: true)
    }
}

// MARK: - Feed agent

/// Activity feed event type. Mirrors the server-side `feed_event_type` enum
/// — keep these in sync, the wire payload uses the raw string values.
enum FeedEventType: String, Decodable, Equatable, Hashable {
    case joined_game
    case won_match
    case registered_tournament
    case elo_milestone
    case followed_user
    case new_partnership
}

enum FeedVisibility: String, Decodable, Equatable {
    case `public`, followers, `private`
}

/// One row in `GET /api/v1/feed`. `payload` is a heterogeneous bag — the
/// renderer reads named keys based on `type`. We decode it as a dictionary
/// of `AnyDecodableValue` so JSON's number/string/bool union round-trips
/// cleanly without forcing every event type into a typed struct.
struct FeedEvent: Decodable, Equatable, Identifiable {
    let id: String
    let type: FeedEventType
    let actor: FeedActor
    let payload: [String: AnyDecodableValue]
    let visibility: FeedVisibility
    let created_at: String
}

struct FeedActor: Decodable, Equatable, Identifiable {
    let id: String
    let display_name: String
    let photo_url: String?
}

/// A loose JSON value wrapper. The feed payload is intentionally schemaless
/// per-event-type so the renderer can be evolved without server changes.
/// Decoder tries each primitive in turn and falls through to `.null` for
/// anything else (nested objects, arrays — neither is used today).
enum AnyDecodableValue: Decodable, Equatable, Hashable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let v = try? c.decode(Bool.self)   { self = .bool(v);   return }
        if let v = try? c.decode(Int.self)    { self = .int(v);    return }
        if let v = try? c.decode(Double.self) { self = .double(v); return }
        if let v = try? c.decode(String.self) { self = .string(v); return }
        self = .null
    }

    /// Convenience accessor — returns the underlying string if this is one
    /// of the textual variants, otherwise coerces numerics so a number-
    /// shaped id still surfaces as text.
    var stringValue: String? {
        switch self {
        case .string(let s): return s
        case .int(let i):    return String(i)
        case .double(let d): return String(d)
        case .bool(let b):   return String(b)
        case .null:          return nil
        }
    }

    var intValue: Int? {
        switch self {
        case .int(let i):    return i
        case .double(let d): return Int(d)
        case .string(let s): return Int(s)
        default:             return nil
        }
    }

    var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }
}

struct FeedPage: Decodable, Equatable {
    let items: [FeedEvent]
    let next_cursor: String?
}

extension Endpoint where Response == FeedPage {
    /// `GET /api/v1/feed?cursor=...&limit=...`. Cursor is opaque — callers
    /// store the previous page's `next_cursor` and pass it back to advance.
    static func feed(cursor: String? = nil, limit: Int? = nil) -> Endpoint<FeedPage> {
        var q: [URLQueryItem] = []
        if let cursor { q.append(.init(name: "cursor", value: cursor)) }
        if let limit  { q.append(.init(name: "limit",  value: "\(limit)")) }
        return Endpoint(method: .get, path: "/api/v1/feed", query: q, requiresAuth: true)
    }
}

// MARK: - Feed comments

/// One comment on a feed event. Wire shape:
/// `{id, user_id, user_display_name, user_avatar_url, body, created_at}`.
/// The server embeds the actor's display name + avatar in the response so
/// the client doesn't need a join roundtrip to render the row.
///
/// `Equatable` so SwiftUI ForEach diffing is cheap; `Identifiable` so the
/// view can ForEach over `[FeedComment]` without an explicit keyPath.
struct FeedComment: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let user_id: String
    let user_display_name: String
    let user_avatar_url: String?
    let body: String
    let created_at: String
}

/// Cursor-paginated response for `GET /api/v1/feed/:eventId/comments`.
/// `total` is the authoritative comment count for the event — feed cards
/// surface it as "{N} şərh" so the user sees how active a thread is
/// before opening the sheet.
struct FeedCommentsPage: Decodable, Equatable {
    let comments: [FeedComment]
    let next_cursor: String?
    let total: Int
}

/// Body for `POST /api/v1/feed/:eventId/comments`. The server trims and
/// length-limits `body`; we send what the user typed and let validation
/// surface in the standard `APIError` envelope.
struct CreateFeedCommentRequest: Encodable, Equatable {
    let body: String
}

extension Endpoint where Response == FeedCommentsPage {
    /// `GET /api/v1/feed/:eventId/comments?cursor=&limit=20`. Cursor is
    /// opaque — pass back the previous page's `next_cursor` to advance.
    /// Server returns oldest-first within the page so the thread reads
    /// chronologically top-to-bottom (mirrors WhatsApp / chat conventions).
    static func feedComments(eventId: String,
                             cursor: String? = nil,
                             limit: Int = 20) -> Endpoint<FeedCommentsPage> {
        var q: [URLQueryItem] = [.init(name: "limit", value: "\(limit)")]
        if let cursor { q.append(.init(name: "cursor", value: cursor)) }
        return Endpoint(method: .get,
                        path: "/api/v1/feed/\(eventId)/comments",
                        query: q,
                        requiresAuth: true)
    }
}

extension Endpoint where Response == FeedComment {
    /// `POST /api/v1/feed/:eventId/comments` — appends a comment. Returns
    /// the persisted row (with server-generated `id` + `created_at`) so
    /// the client can replace its optimistic placeholder.
    static func createFeedComment(eventId: String,
                                  body: String) -> Endpoint<FeedComment> {
        let payload = CreateFeedCommentRequest(body: body)
        return Endpoint(method: .post,
                        path: "/api/v1/feed/\(eventId)/comments",
                        body: try? JSONEncoder().encode(payload),
                        requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    /// `DELETE /api/v1/feed/comments/:commentId` — owner-only on the
    /// server. Returns 204 on success; we decode that as `EmptyResponse`.
    /// The client only surfaces a delete affordance on the caller's own
    /// comments, so the 403 path is defensive rather than expected.
    static func deleteFeedComment(commentId: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete,
                 path: "/api/v1/feed/comments/\(commentId)",
                 requiresAuth: true)
    }
}

// MARK: - Achievements agent
//
// Badge catalog + per-user unlock state for `GET /api/v1/users/:id/achievements`.
// The server returns every catalog row tagged unlocked/locked, plus a
// structured `progress` payload toward each locked criterion. iOS renders
// the grid in `AchievementsView` and a per-badge sheet with the progress bar.

/// Progress hint for the detail sheet's bar — `unit` is one of
/// "games" | "elo" | "wins" | "percent" | "days" | "ratings".
struct AchievementProgress: Decodable, Equatable, Hashable {
    let current: Double
    let target: Double
    let unit: String

    /// Clamped 0...1 fill ratio. We accept floats so the bar can show a
    /// 1450/1500 = 0.967 sliver without rounding.
    var ratio: Double {
        guard target > 0 else { return 0 }
        return min(max(current / target, 0), 1)
    }
}

struct Achievement: Decodable, Equatable, Identifiable, Hashable {
    let slug: String
    let name: String
    let description: String
    let icon_name: String
    let unlocked: Bool
    let unlocked_at: String?
    let progress: AchievementProgress?
    var id: String { slug }
}

struct AchievementsResponse: Decodable, Equatable {
    let items: [Achievement]
    let unlocked_count: Int
    let total_count: Int
}

extension Endpoint where Response == AchievementsResponse {
    /// Public — no auth required. Returns the catalog with unlock state for
    /// the given user id. 404 if the user doesn't exist (server semantics).
    static func achievements(userId: String) -> Endpoint<AchievementsResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/users/\(userId)/achievements")
    }
}

// MARK: - Reports agent

/// Mirrors the backend's `report_target_kind` enum. The iOS UI uses this to
/// pick the right "What are you reporting?" copy and to pass the kind along
/// with the target id.
///
/// Wave-10 added `story` and `feed_comment` so the viewer screens that
/// surface user-generated content (Story viewer, feed comments) can offer
/// the same "Şikayət et" action profile / game / chat already expose.
enum ReportTargetKind: String, Codable, Equatable, CaseIterable {
    case user, game, message, story, feed_event, feed_comment, venue_review, media
}

/// Mirrors the backend's `report_reason` enum exactly. Add a case here and
/// in `reports.schema.ts` together — they're locked at the wire boundary.
///
/// The label/iconography is owned by `ReportSheet` (localized via xcstrings)
/// so this enum stays a pure transport type.
enum ReportReason: String, Codable, Equatable, CaseIterable, Identifiable {
    case spam
    case harassment
    case no_show
    case fake_profile
    case inappropriate_content
    case other

    var id: String { rawValue }
}

enum ReportStatus: String, Codable, Equatable {
    case pending, reviewed, dismissed
}

/// Decoded response of `POST /api/v1/reports`. Includes the moderator-side
/// columns so callers can show a "submitted" confirmation with the created
/// timestamp without a refetch.
struct ReportOut: Decodable, Equatable, Identifiable {
    let id: String
    let reporter_user_id: String
    let reporter_display_name: String?
    let target_kind: ReportTargetKind
    let target_id: String
    let reason: ReportReason
    let status: ReportStatus
    let notes: String?
    let reviewed_by_user_id: String?
    let reviewed_at: String?
    let created_at: String
}

extension Endpoint where Response == ReportOut {
    /// POST /api/v1/reports — file a new report against another user, a
    /// game, a single message, a story, or a feed comment. The server
    /// validates that the target row exists and that the caller hasn't
    /// blown the 5/hour rate limit (returns 429 if they have, surfaced as
    /// `APIError.rateLimited`).
    static func createReport(
        targetKind: ReportTargetKind,
        targetId: String,
        reason: ReportReason,
        notes: String? = nil
    ) -> Endpoint<ReportOut> {
        var body: [String: Any] = [
            "target_kind": targetKind.rawValue,
            "target_id": targetId,
            "reason": reason.rawValue,
        ]
        if let notes, !notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            body["notes"] = notes
        }
        return Endpoint(method: .post, path: "/api/v1/reports",
                        body: encodeJSON(body), requiresAuth: true)
    }
}

/// Trimmed shape for `GET /api/v1/me/reports`. The reporter doesn't see
/// reviewer metadata — just what they reported and the current lifecycle
/// state. Matches the server's `MyReportItem` schema 1:1.
struct MyReportItem: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let target_kind: ReportTargetKind
    let target_id: String
    let status: ReportStatus
    let created_at: String
}

/// One page of "my reports". `next_cursor` is opaque — pass it back as the
/// `cursor` query param to fetch the next page; `nil` means EOL.
struct MyReportsPage: Decodable, Equatable {
    let reports: [MyReportItem]
    let next_cursor: String?
}

extension Endpoint where Response == MyReportsPage {
    /// GET /api/v1/me/reports — paginated history of the caller's own
    /// reports, newest first. Used by the in-app "Şikayətlərim" screen so
    /// users can see what they've submitted and the moderator's decision.
    static func myReports(cursor: String? = nil, limit: Int? = nil) -> Endpoint<MyReportsPage> {
        var query: [URLQueryItem] = []
        if let cursor, !cursor.isEmpty {
            query.append(URLQueryItem(name: "cursor", value: cursor))
        }
        if let limit {
            query.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        return Endpoint(method: .get,
                        path: "/api/v1/me/reports",
                        query: query,
                        requiresAuth: true)
    }
}

// MARK: - Matchmaking agent

/// One ranked game card from `GET /api/v1/me/matchmaking/games`. The score
/// is 0..1; `reasons` are pre-localized phrases the iOS card renders as
/// lime chips (e.g., "Similar ELO", "2 friends going", "12 km away").
struct RecommendedGame: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let sport_id: String
    let sport_slug: String
    let host_user_id: String
    let host_display_name: String
    let venue_name: String?
    let lat: Double
    let lng: Double
    let starts_at: String
    let duration_minutes: Int
    let capacity: Int
    let participants_count: Int
    let skill_min_elo: Int?
    let skill_max_elo: Int?
    let distance_km: Double?
    let score: Double
    let reasons: [String]
}

struct RecommendedGamesResponse: Decodable, Equatable {
    let items: [RecommendedGame]
}

/// One ranked player card from `GET /api/v1/me/matchmaking/players`. The
/// shape mirrors `RecommendedGame` (score + reasons) so the iOS carousel
/// stays uniform across both lanes.
///
/// `reason_codes` carries locale-agnostic tokens the iOS card translates
/// into AZ chips ("same_skill" → "Eyni səviyyə"). Older clients can still
/// fall back to the EN `reasons[]` strings. Optional decode-side so a
/// rolling backend deploy can't crash an older client that pre-dates the
/// field — present on the new "/players/for-me" endpoint, may be missing
/// from cached responses or older builds.
struct RecommendedPlayer: Decodable, Equatable, Identifiable, Hashable {
    var id: String { user_id }
    let user_id: String
    let display_name: String
    let photo_url: String?
    let primary_sport_slug: String?
    let elo_rating: Int?
    let reliability_score: Int?
    let distance_km: Double?
    let mutual_followers_count: Int
    let score: Double
    let reasons: [String]
    let reason_codes: [String]?
}

struct RecommendedPlayersResponse: Decodable, Equatable {
    let items: [RecommendedPlayer]
}

extension Endpoint where Response == RecommendedGamesResponse {
    /// Personalized "Best games for you". Requires auth — the backend
    /// scores the candidate pool against the caller's ELO, follow graph
    /// and home location.
    static func matchmakingGames(limit: Int = 10) -> Endpoint<RecommendedGamesResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/me/matchmaking/games",
                 query: [.init(name: "limit", value: "\(limit)")],
                 requiresAuth: true)
    }
}

extension Endpoint where Response == RecommendedPlayersResponse {
    /// Personalized "Best players for you" — non-followed users ranked by
    /// ELO closeness, mutual-followers count, distance, and reliability.
    static func matchmakingPlayers(limit: Int = 10) -> Endpoint<RecommendedPlayersResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/me/matchmaking/players",
                 query: [.init(name: "limit", value: "\(limit)")],
                 requiresAuth: true)
    }

    /// "Sənə uyğun oyunçular" — strict matchmaker. Hard-filters candidates
    /// to ±200 ELO of the viewer's primary-sport rating and excludes
    /// bidirectional blocks. Used by the PlayersView "Sənə uyğun" tab so
    /// players see other players actually worth scheduling a match with.
    static func matchmakingPlayersForMe(limit: Int = 20) -> Endpoint<RecommendedPlayersResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/me/matchmaking/players/for-me",
                 query: [.init(name: "limit", value: "\(limit)")],
                 requiresAuth: true)
    }
}

// MARK: - Scoring agent

/// One completed set as recorded by the server. Tiebreak metadata is
/// surfaced as `tb` when relevant so the UI can render the small "(7-5)"
/// scoreline next to the 7-6.
struct MatchScoreSet: Decodable, Equatable, Hashable {
    let a: Int
    let b: Int
    let tb: TiebreakScore?

    struct TiebreakScore: Decodable, Equatable, Hashable {
        let a: Int
        let b: Int
    }
}

enum MatchScoreStatus: String, Decodable, Equatable {
    case in_progress, completed
}

enum ScoreTeam: String, Decodable, Equatable {
    case a, b
}

/// Wire shape — mirrors the server's `MatchScoreSchema` 1:1.
struct MatchScore: Decodable, Equatable {
    let game_id: String
    let team_a_user_ids: [String]
    let team_b_user_ids: [String]
    let sets: [MatchScoreSet]
    let current_set: Int
    let current_game_a: Int
    let current_game_b: Int
    let point_a: Int
    let point_b: Int
    let status: MatchScoreStatus
    let started_at: String
    let completed_at: String?
    let winning_team: ScoreTeam?

    /// Tennis-style point label for the in-progress game. Returns "AD" /
    /// "—" for the deuce/advantage branches; raw integers for tiebreaks.
    /// Pure helper — keeps the view free of scoring logic.
    func pointLabel(for team: ScoreTeam) -> String {
        let inTiebreak = current_game_a == 6 && current_game_b == 6
        if inTiebreak {
            return "\(team == .a ? point_a : point_b)"
        }
        let mine = team == .a ? point_a : point_b
        let theirs = team == .a ? point_b : point_a
        // Standard ladder: 0/15/30/40 → 0/1/2/3. After deuce, we encode
        // advantage as `4`; only valid when the opponent is at 3.
        if mine == 4 && theirs == 3 { return "AD" }
        if mine == 3 && theirs == 3 { return "40" }
        switch mine {
        case 0: return "0"
        case 1: return "15"
        case 2: return "30"
        case 3: return "40"
        default: return "\(mine)"
        }
    }
}

extension Endpoint where Response == MatchScore {
    /// POST /api/v1/games/:id/scoring/start — host only.
    static func startScoring(gameId: String,
                             teamAUserIds: [String],
                             teamBUserIds: [String]) -> Endpoint<MatchScore> {
        let body: [String: Any] = [
            "team_a_user_ids": teamAUserIds,
            "team_b_user_ids": teamBUserIds,
        ]
        return Endpoint(method: .post,
                        path: "/api/v1/games/\(gameId)/scoring/start",
                        body: encodeJSON(body),
                        requiresAuth: true)
    }

    /// POST /api/v1/games/:id/scoring/point — confirmed participant.
    static func scoringPoint(gameId: String, team: ScoreTeam) -> Endpoint<MatchScore> {
        Endpoint(method: .post,
                 path: "/api/v1/games/\(gameId)/scoring/point",
                 body: encodeJSON(["team": team.rawValue]),
                 requiresAuth: true)
    }

    /// POST /api/v1/games/:id/scoring/undo — confirmed participant.
    static func scoringUndo(gameId: String) -> Endpoint<MatchScore> {
        Endpoint(method: .post,
                 path: "/api/v1/games/\(gameId)/scoring/undo",
                 requiresAuth: true)
    }

    /// POST /api/v1/games/:id/scoring/complete — confirmed participant.
    static func scoringComplete(gameId: String) -> Endpoint<MatchScore> {
        Endpoint(method: .post,
                 path: "/api/v1/games/\(gameId)/scoring/complete",
                 requiresAuth: true)
    }

    /// GET /api/v1/games/:id/scoring — authenticated read.
    static func scoring(gameId: String) -> Endpoint<MatchScore> {
        Endpoint(method: .get,
                 path: "/api/v1/games/\(gameId)/scoring",
                 requiresAuth: true)
    }
}

// MARK: - Membership agent
//
// Subscription tiers (free, plus, premium) backed by Stripe. The
// `subscribe` route returns one of two shapes: a Stripe Checkout URL
// (`mode == "checkout"`) the iOS app opens in Safari / PaymentSheet, or
// a "demo" payload (`mode == "demo"`) the server flips server-side when
// real Stripe credentials aren't configured. The UI handles both.

/// Tier identifier — matches the server enum exactly. The string values
/// double as a sort key (free < plus < premium) and as an icon-mapping
/// hint on the tier card.
enum MembershipTier: String, Codable, Equatable, CaseIterable, Identifiable {
    case free, plus, premium
    var id: String { rawValue }

    /// Stable numeric rank used to compare tiers (e.g. "is the user's
    /// current tier already at or above this card's tier").
    var rank: Int {
        switch self {
        case .free:    return 0
        case .plus:    return 1
        case .premium: return 2
        }
    }
}

/// One benefit row from the server. `key` is a stable identifier the iOS
/// client maps to an SF Symbol; `label` is the human-readable copy.
struct MembershipBenefit: Decodable, Equatable, Identifiable, Hashable {
    var id: String { key }
    let key: String
    let label: String
}

struct MembershipState: Decodable, Equatable {
    let tier: MembershipTier
    let current_period_end: String?
    let cancel_at_period_end: Bool
    let benefits: [MembershipBenefit]
    /// Monthly price in minor units (qəpik). 0 for free.
    let price_minor: Int
    /// Always "AZN" today — kept on the wire so the formatter doesn't
    /// have to hardcode the currency.
    let currency: String
}

struct SubscribeResponse: Decodable, Equatable {
    enum Mode: String, Decodable, Equatable {
        case checkout, demo
    }
    let mode: Mode
    let checkout_url: String?
    let tier: MembershipTier
    let current_period_end: String?
}

struct CancelMembershipResponse: Decodable, Equatable {
    let tier: MembershipTier
    let cancel_at_period_end: Bool
    let current_period_end: String?
}

extension Endpoint where Response == MembershipState {
    /// `GET /api/v1/me/membership` — tier + period end + benefits list.
    static var myMembership: Endpoint<MembershipState> {
        Endpoint(method: .get, path: "/api/v1/me/membership", requiresAuth: true)
    }
}

extension Endpoint where Response == SubscribeResponse {
    /// `POST /api/v1/membership/subscribe` — body `{ tier: plus|premium }`.
    /// In live mode the response carries a Stripe Checkout URL the app
    /// opens; in demo mode the row is already flipped and we just refresh.
    static func subscribeMembership(tier: MembershipTier) -> Endpoint<SubscribeResponse> {
        Endpoint(method: .post, path: "/api/v1/membership/subscribe",
                 body: encodeJSON(["tier": tier.rawValue]),
                 requiresAuth: true)
    }
}

extension Endpoint where Response == CancelMembershipResponse {
    /// `POST /api/v1/membership/cancel` — flags `cancel_at_period_end=true`.
    /// Users keep their tier through `current_period_end`.
    static var cancelMembership: Endpoint<CancelMembershipResponse> {
        Endpoint(method: .post, path: "/api/v1/membership/cancel", requiresAuth: true)
    }
}

// MARK: - Referrals agent

/// Single row inside the "people you've referred" list. Mirrors the server's
/// `ReferredUserSchema`. `photo_url` may be nil — the dashboard view falls
/// back to a monogram avatar in that case.
struct ReferredUser: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let display_name: String
    let photo_url: String?
    let referred_at: String
}

/// Payload returned from `GET /api/v1/me/referrals`. `code` is the caller's
/// shareable code (server lazily mints one on first call), `referred_users`
/// is newest-first.
struct MyReferralsResponse: Decodable, Equatable {
    let code: String
    let referred_count: Int
    let referred_users: [ReferredUser]
}

/// Payload returned from `POST /api/v1/auth/redeem-referral`.
struct RedeemReferralResponse: Decodable, Equatable {
    let referrer_user_id: String
    let referrer_display_name: String
    let code_used: String
}

/// Compact dashboard payload returned from the Wave-10 endpoint
/// `GET /api/v1/me/referral` (singular). Carries just the caller's code,
/// the lifetime referral_count denormalised on `users`, and the canonical
/// `https://linkfit.az/r/<code>` share URL. Used by the "Dostunu dəvət et"
/// summary card in Settings — the plural endpoint stays the source of
/// truth for the full friend list on the Referrals screen.
struct MyReferralResponse: Decodable, Equatable {
    let code: String
    let count: Int
    let share_url: String
}

extension Endpoint where Response == MyReferralsResponse {
    /// Dashboard fetch — returns my code + the list of friends I've already
    /// referred. Lazily mints my code on the server if I don't have one yet.
    static var myReferrals: Endpoint<MyReferralsResponse> {
        Endpoint(method: .get, path: "/api/v1/me/referrals", requiresAuth: true)
    }
}

extension Endpoint where Response == MyReferralResponse {
    /// Wave-10 compact summary fetch. Single-row read on the server (just
    /// the user's code + referral_count + viral share URL) — used by the
    /// settings sub-screen "share my code" card without paying for the
    /// friend-list JOIN.
    static var myReferral: Endpoint<MyReferralResponse> {
        Endpoint(method: .get, path: "/api/v1/me/referral", requiresAuth: true)
    }
}

extension Endpoint where Response == RedeemReferralResponse {
    /// Redeem a friend's referral code. Server validates the 7-day window,
    /// rejects self-referral, and surfaces 409 if the user already redeemed.
    static func redeemReferral(code: String) -> Endpoint<RedeemReferralResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/auth/redeem-referral",
                 body: encodeJSON(["code": code]),
                 requiresAuth: true)
    }
}

// MARK: - Email agent

/// Response payload from POST /api/v1/auth/send-verification.
/// `sent=false` means the account is already verified (idempotent).
struct SendVerificationResponse: Decodable, Equatable {
    let sent: Bool
}

/// Response payload from POST /api/v1/auth/verify-email.
struct VerifyEmailResponse: Decodable, Equatable {
    let verified: Bool
}

/// Response payload from POST /api/v1/auth/request-password-reset.
/// Always `requested=true` — the API never leaks whether the email is on file.
struct RequestPasswordResetResponse: Decodable, Equatable {
    let requested: Bool
}

/// Response payload from POST /api/v1/auth/reset-password.
struct ResetPasswordResponse: Decodable, Equatable {
    let reset: Bool
}

extension Endpoint where Response == SendVerificationResponse {
    /// POST /api/v1/auth/send-verification — auth required; mints a fresh
    /// magic-link token and mails it. Cool-down: 60 seconds per account.
    static var sendVerification: Endpoint<SendVerificationResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/auth/send-verification",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == VerifyEmailResponse {
    /// POST /api/v1/auth/verify-email — submits the 6-digit code for the
    /// authenticated user. Auth IS required: a 6-digit code isn't globally
    /// unique, so the server identifies the account from the Bearer token and
    /// checks the code against it. (The user is always signed in when the
    /// verification gate is shown.) The body field stays `token`; its value is
    /// now the 6-digit code.
    static func verifyEmail(token: String) -> Endpoint<VerifyEmailResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/auth/verify-email",
                 body: encodeJSON(["token": token]),
                 requiresAuth: true)
    }
}

extension Endpoint where Response == RequestPasswordResetResponse {
    /// POST /api/v1/auth/request-password-reset — anti-enumeration: always
    /// returns 200 whether or not the address exists.
    static func requestPasswordReset(email: String) -> Endpoint<RequestPasswordResetResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/auth/request-password-reset",
                 body: encodeJSON(["email": email]))
    }
}

extension Endpoint where Response == ResetPasswordResponse {
    /// POST /api/v1/auth/reset-password — submits the magic-link token
    /// together with the new password. Server rehashes (argon2id) and
    /// revokes every refresh token belonging to the account.
    static func resetPassword(token: String, newPassword: String) -> Endpoint<ResetPasswordResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/auth/reset-password",
                 body: encodeJSON(["token": token, "password": newPassword]))
    }
}

// MARK: - Venue reviews agent
//
// Wire-format mirrors the Zod schemas in `venue-reviews.schema.ts` 1:1 so
// decode is a straight pass-through. `VenueReviewAuthor` is embedded inside
// each row so list rendering doesn't need a separate /users/:id fetch.

struct VenueReviewAuthor: Decodable, Equatable, Hashable {
    let id: String
    let display_name: String
    let photo_url: String?
}

struct VenueReview: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let venue_id: String
    let author: VenueReviewAuthor
    let rating: Int
    let body: String?
    let photo_url: String?
    let created_at: String
    let updated_at: String
}

struct VenueReviewsPage: Decodable, Equatable {
    let items: [VenueReview]
    let next_cursor: String?
}

/// `venue.rating-summary` payload. The histogram is keyed `"1"..."5"`;
/// `avg_rating` is `nil` when no reviews exist yet (matches the SQL).
struct VenueRatingHistogram: Decodable, Equatable, Hashable {
    let one: Int
    let two: Int
    let three: Int
    let four: Int
    let five: Int

    private enum CodingKeys: String, CodingKey {
        case one = "1", two = "2", three = "3", four = "4", five = "5"
    }

    /// Indexed access for chart rendering — 1..5.
    func count(for star: Int) -> Int {
        switch star {
        case 1: return one
        case 2: return two
        case 3: return three
        case 4: return four
        case 5: return five
        default: return 0
        }
    }
}

struct VenueRatingSummary: Decodable, Equatable {
    let venue_id: String
    let avg_rating: Double?
    let review_count: Int
    let histogram: VenueRatingHistogram
}

/// Sort order matching the backend's `sort` query param.
enum VenueReviewsSort: String, CaseIterable, Identifiable, Hashable {
    case recent, highest
    var id: String { rawValue }
}

extension Endpoint where Response == VenueReviewsPage {
    static func venueReviews(venueId: String,
                             sort: VenueReviewsSort = .recent,
                             limit: Int = 20,
                             cursor: String? = nil) -> Endpoint<VenueReviewsPage> {
        var query: [URLQueryItem] = [
            .init(name: "sort",  value: sort.rawValue),
            .init(name: "limit", value: "\(limit)"),
        ]
        if let cursor { query.append(.init(name: "cursor", value: cursor)) }
        return Endpoint(method: .get,
                        path: "/api/v1/venues/\(venueId)/reviews",
                        query: query)
    }
}

extension Endpoint where Response == VenueRatingSummary {
    static func venueRatingSummary(venueId: String) -> Endpoint<VenueRatingSummary> {
        Endpoint(method: .get, path: "/api/v1/venues/\(venueId)/rating-summary")
    }
}

extension Endpoint where Response == VenueReview {
    /// POST a new review or update an existing one. Server UPSERTs on
    /// (venue, author). Photo upload is reused from the messaging
    /// `uploadImage(...)` helper — pass the returned URL through unchanged.
    static func upsertVenueReview(venueId: String,
                                  rating: Int,
                                  body: String?,
                                  photoUrl: String?) -> Endpoint<VenueReview> {
        var payload: [String: Any] = ["rating": rating]
        if let body, !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["body"] = body
        }
        if let photoUrl { payload["photo_url"] = photoUrl }
        return Endpoint(method: .post,
                        path: "/api/v1/venues/\(venueId)/reviews",
                        body: encodeJSON(payload),
                        requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    /// Author-only soft-delete of a review.
    static func deleteVenueReview(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete,
                 path: "/api/v1/reviews/\(id)",
                 requiresAuth: true)
    }
}

// MARK: - Streaks agent

/// One cell in the streaks heatmap. `week_start` is the ISO Monday-anchored
/// date (UTC), and `games_count` is the number of confirmed/played
/// participations that fell inside the week. Zero-counts are included so
/// the iOS grid can render the row directly without sparse-fill logic.
struct StreaksWeek: Decodable, Equatable, Identifiable, Hashable {
    var id: String { week_start }
    let week_start: String
    let games_count: Int
}

/// Full payload from `GET /api/v1/users/:id/streaks`. The `weeks` array is
/// exactly 26 entries long, oldest first, ending at the current ISO week.
struct StreaksResponse: Decodable, Equatable {
    let current_streak_weeks: Int
    let longest_streak_weeks: Int
    let weeks: [StreaksWeek]
}

extension Endpoint where Response == StreaksResponse {
    /// Trailing 26-week play-streak heatmap + KPI counters for any user.
    /// The endpoint is auth-gated (any signed-in viewer can read any
    /// user's stats), so we always attach the bearer token.
    static func streaks(userId: String) -> Endpoint<StreaksResponse> {
        Endpoint(
            method: .get,
            path: "/api/v1/users/\(userId)/streaks",
            requiresAuth: true,
        )
    }
}

// MARK: - Medical agent
//
// Optional medical / emergency profile + tournament waiver acknowledgments.
// Profile fields are owner-only on read/write. The host-summary endpoint is
// host-gated by the backend; opt-in players appear, opted-out players are
// silently omitted. The waiver POST is idempotent — a second call on the
// same `tournament_id` returns `already_signed=true`.

struct MedicalProfile: Decodable, Equatable {
    let blood_type: String?
    let allergies: String?
    let conditions: String?
    let medications: String?
    let emergency_contact_name: String?
    let emergency_contact_phone: String?
    let share_medical_with_host: Bool
    let updated_at: String?
}

/// Body for `PUT /me/medical-profile`. Every field is optional; sending
/// `null` clears it on the server, omitting it leaves the stored value
/// untouched. Use `MedicalProfileUpdate.encode(...)` to build the JSON
/// payload — it preserves the null/omit distinction the API relies on.
struct MedicalProfileUpdate {
    var blood_type: FieldChange<String>?
    var allergies: FieldChange<String>?
    var conditions: FieldChange<String>?
    var medications: FieldChange<String>?
    var emergency_contact_name: FieldChange<String>?
    var emergency_contact_phone: FieldChange<String>?
    var share_medical_with_host: Bool?

    /// Three-state field marker. `.unchanged` omits the key (server-side
    /// passthrough); `.set(value)` writes; `.clear` sends explicit `null`.
    enum FieldChange<T: Encodable> {
        case set(T)
        case clear
    }

    func encode() -> Data? {
        var dict: [String: Any] = [:]
        func add<T: Encodable>(_ key: String, _ change: FieldChange<T>?) {
            guard let change else { return }
            switch change {
            case .set(let v):
                if let s = v as? String { dict[key] = s }
                else { dict[key] = v }
            case .clear:
                dict[key] = NSNull()
            }
        }
        add("blood_type", blood_type)
        add("allergies", allergies)
        add("conditions", conditions)
        add("medications", medications)
        add("emergency_contact_name", emergency_contact_name)
        add("emergency_contact_phone", emergency_contact_phone)
        if let share = share_medical_with_host {
            dict["share_medical_with_host"] = share
        }
        return try? JSONSerialization.data(withJSONObject: dict)
    }
}

extension Endpoint where Response == MedicalProfile {
    /// Owner read. Returns an empty profile (every text field `null`, share
    /// flag `false`, `updated_at` `null`) when the user has never set one.
    static var medicalProfile: Endpoint<MedicalProfile> {
        Endpoint(method: .get, path: "/api/v1/me/medical-profile", requiresAuth: true)
    }

    /// Owner upsert. Three-state per text field — see `MedicalProfileUpdate`.
    /// We use `.put` semantically (server route is PUT); the local
    /// `HTTPMethod` enum ships only the four standard verbs the rest of the
    /// app uses, so we piggyback on `.patch` here — both serialize identical
    /// bodies and the server route matches either verb thanks to Fastify's
    /// method-tolerant route registration in the medical module.
    static func updateMedicalProfile(_ body: MedicalProfileUpdate) -> Endpoint<MedicalProfile> {
        Endpoint(method: .put,
                 path: "/api/v1/me/medical-profile",
                 body: body.encode(),
                 requiresAuth: true)
    }
}

struct GameMedicalSummary: Decodable, Equatable {
    let game_id: String
    let items: [GameMedicalParticipant]
}

struct GameMedicalParticipant: Decodable, Equatable, Identifiable {
    var id: String { user_id }
    let user_id: String
    let display_name: String
    let blood_type: String?
    let allergies: String?
    let emergency_contact_phone: String?
}

extension Endpoint where Response == GameMedicalSummary {
    /// Host-only summary of confirmed participants' medical info for a game.
    /// 403 if the caller isn't the host; opted-out participants are omitted.
    static func gameMedicalSummary(gameId: String) -> Endpoint<GameMedicalSummary> {
        Endpoint(
            method: .get,
            path: "/api/v1/games/\(gameId)/medical-summary",
            requiresAuth: true,
        )
    }
}

struct WaiverSignResponse: Decodable, Equatable {
    let tournament_id: String
    let user_id: String
    let signed_at: String
    let already_signed: Bool
}

extension Endpoint where Response == WaiverSignResponse {
    /// Sign (or re-confirm) the tournament waiver. Idempotent.
    static func signTournamentWaiver(tournamentId: String) -> Endpoint<WaiverSignResponse> {
        Endpoint(
            method: .post,
            path: "/api/v1/tournaments/\(tournamentId)/sign-waiver",
            body: try? JSONSerialization.data(withJSONObject: [:] as [String: Any]),
            requiresAuth: true,
        )
    }
}

// MARK: - Group chat agent
//
// Mirrors `apps/api/src/modules/social/group-chat.routes.ts`. Lives side-by-side
// with the 1:1 DM endpoints above — group threads share the same `messages`
// path, so once we have a `conversation_id` we keep using the existing
// `conversationThread`/`sendMessage` endpoints to read and write.

/// Origin kind for a group conversation. Maps 1:1 to the API's `kind` param.
enum GroupChatKind: String, Codable, Equatable {
    case game, tournament
}

/// Response from POST `/api/v1/conversations/group`. `created=true` on the
/// first call for a given target, `false` on every subsequent call (the
/// endpoint is idempotent on `(kind, target_id)`).
struct GroupConversationCreatedResponse: Decodable, Equatable {
    let conversation_id: String
    let kind: String
    let title: String
    let game_id: String?
    let tournament_id: String?
    let participants_count: Int
    let created: Bool
}

/// One participant in the group roster.
struct GroupParticipant: Decodable, Equatable, Identifiable, Hashable {
    var id: String { user_id }
    let user_id: String
    let display_name: String
    let photo_url: String?
    let is_owner: Bool
    let joined_at: String?
}

/// Response from GET `/api/v1/conversations/:id/participants`. `owner_user_id`
/// is the host (for game groups) or the first captain (for tournament
/// groups) — the iOS sheet uses it to gate the "add" / "kick" buttons.
struct GroupParticipantsResponse: Decodable, Equatable {
    let conversation_id: String
    let kind: String
    let title: String
    let owner_user_id: String?
    let items: [GroupParticipant]
}

struct GroupAddParticipantResponse: Decodable, Equatable {
    let added: Bool
    let participants_count: Int
}

extension Endpoint where Response == GroupConversationCreatedResponse {
    /// Idempotent — call any time the user opens a game/tournament group
    /// chat entry-point. Returns the same `conversation_id` if the thread
    /// already exists, otherwise creates it and adds the caller as a
    /// participant.
    static func openGroupConversation(kind: GroupChatKind,
                                      targetId: String) -> Endpoint<GroupConversationCreatedResponse> {
        let body: [String: Any] = [
            "kind": kind.rawValue,
            "target_id": targetId,
        ]
        return Endpoint(method: .post,
                        path: "/api/v1/conversations/group",
                        body: try? JSONSerialization.data(withJSONObject: body),
                        requiresAuth: true)
    }
}

extension Endpoint where Response == GroupParticipantsResponse {
    static func groupParticipants(conversationId: String) -> Endpoint<GroupParticipantsResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/conversations/\(conversationId)/participants",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == GroupAddParticipantResponse {
    static func addGroupParticipant(conversationId: String,
                                    userId: String) -> Endpoint<GroupAddParticipantResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/conversations/\(conversationId)/participants",
                 body: try? JSONSerialization.data(withJSONObject: ["user_id": userId] as [String: Any]),
                 requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    /// Host/captain-only kick. Server returns 204; we model that as
    /// `EmptyResponse` for shape compatibility with the rest of the
    /// endpoint constructors.
    static func removeGroupParticipant(conversationId: String,
                                       userId: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete,
                 path: "/api/v1/conversations/\(conversationId)/participants/\(userId)",
                 requiresAuth: true)
    }
}

// MARK: - Squads agent
//
// Persistent padel partner-groups (the "regular foursome" pattern). Eight
// endpoints, kept together so the contract is legible at one glance.
// Models for these live in `Features/Squads/Squad.swift` — the wire types
// don't belong in this shared module because they're only consumed by
// the Squads feature.

extension Endpoint where Response == Squad {
    /// `POST /api/v1/squads` — create a new squad with the calling user as
    /// owner. Body fields are optional except `name` + `max_size` (clamped
    /// to 2…8 server-side). Returns the persisted summary; the caller
    /// stitches it into the in-memory list so the next render is instant.
    static func createSquad(_ body: CreateSquadBody) -> Endpoint<Squad> {
        Endpoint(method: .post,
                 path: "/api/v1/squads",
                 body: try? JSONEncoder().encode(body),
                 requiresAuth: true)
    }

    /// `PATCH /api/v1/squads/:id` — owner-only mutation. Server returns
    /// 403 for non-owners; the client hides the edit affordance from
    /// non-owner views so the 403 path is a defensive backstop.
    static func updateSquad(id: String, body: UpdateSquadBody) -> Endpoint<Squad> {
        Endpoint(method: .patch,
                 path: "/api/v1/squads/\(id)",
                 body: try? JSONEncoder().encode(body),
                 requiresAuth: true)
    }
}

extension Endpoint where Response == SquadsListResponse {
    /// `GET /api/v1/squads/me` — every squad the caller belongs to,
    /// owner or member, with the `next_game` teaser embedded when one
    /// applies. No pagination — the cap of 8 members × a handful of
    /// squads per user keeps the payload tiny.
    static func mySquads() -> Endpoint<SquadsListResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/squads/me",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == SquadWithMembers {
    /// `GET /api/v1/squads/:id` — squad header + member roster. Caller
    /// must be a member; 403 otherwise so the deep-link path is gated
    /// by the auth layer rather than the screen.
    static func squad(id: String) -> Endpoint<SquadWithMembers> {
        Endpoint(method: .get,
                 path: "/api/v1/squads/\(id)",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == SquadGamesResponse {
    /// `GET /api/v1/squads/:id/games` — upcoming + ongoing games where at
    /// least two squad members participate. The detail screen renders
    /// this under "Bu həftə oyunlar"; rows reuse the same `GameSummary`
    /// shape the discovery feed already speaks.
    static func squadGames(id: String) -> Endpoint<SquadGamesResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/squads/\(id)/games",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    /// `POST /api/v1/squads/:id/invite` — owner-only invitation. The
    /// invitee receives an in-app notification; they accept via the
    /// dedicated `accept` endpoint below. Server returns 204 on success.
    static func inviteToSquad(id: String, userId: String) -> Endpoint<EmptyResponse> {
        let body = InviteToSquadBody(user_id: userId)
        return Endpoint(method: .post,
                        path: "/api/v1/squads/\(id)/invite",
                        body: try? JSONEncoder().encode(body),
                        requiresAuth: true)
    }

    /// `POST /api/v1/squads/:id/accept` — invitee-only. Adds the calling
    /// user to the squad's roster and clears the pending invite row.
    /// Idempotent: re-accepts return 204 with no side-effects.
    static func acceptSquadInvite(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/squads/\(id)/accept",
                 requiresAuth: true)
    }

    /// `POST /api/v1/squads/:id/leave` — voluntary departure for any
    /// non-owner member. Owners cannot leave (server returns 409); they
    /// must `delete` the squad instead. Returns 204.
    static func leaveSquad(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/squads/\(id)/leave",
                 requiresAuth: true)
    }

    /// `DELETE /api/v1/squads/:id` — owner-only hard delete. Server
    /// returns 204; the row vanishes from every member's `mySquads()`
    /// list on their next fetch. There's no undo.
    static func deleteSquad(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete,
                 path: "/api/v1/squads/\(id)",
                 requiresAuth: true)
    }
}

// MARK: - Daily challenges (Wave-10)
//
// The home card surfaces 3 daily challenges per user — see
// `Features/Challenges/`. Wire shape mirrors the backend's
// `challenges.schema.ts`: the server ships the stable `code` (one of six)
// plus an AZ-localized server-side fallback `title`. iOS overrides the
// fallback via `challenges.title.<code>` xcstrings keys so translation
// stays single-sourced on the client.

/// Stable enum of the six challenge codes the backend supports. Adding
/// a new code is a coordinated change: extend this enum AND
/// `CHALLENGE_POOL` in `challenges.service.ts`.
enum ChallengeCode: String, Decodable, Equatable, Hashable, CaseIterable {
    case follow_one
    case join_a_game
    case post_a_story
    case comment_on_feed
    case invite_to_game
    case react_to_story
}

/// One row in the home card's daily-challenges rail.
///
/// `completed_at` carries the ISO-8601 stamp from `markCompleted` —
/// `nil` means the user hasn't performed the action today. The card
/// dims completed rows but keeps them in place rather than collapsing
/// (so the third item's tap target doesn't shift mid-day).
struct ChallengeItem: Decodable, Identifiable, Equatable {
    let code: ChallengeCode
    /// Server-side AZ fallback. The iOS card prefers
    /// `challenges.title.<code>` from xcstrings — keeping the wire copy
    /// means push payloads and admin tooling stay legible.
    let title: String
    /// Optional short body; currently the server ships `""` for every
    /// code. Future variants (date-aware bodies, leaderboard ties) can
    /// fill this without a wire change.
    let body: String
    let completed_at: String?
    /// SF Symbol hint from the server. The iOS card has its own per-code
    /// glyph map (`Challenges/ChallengeIcons`) — this is the fallback for
    /// non-iOS surfaces (admin, push body).
    let icon: String

    /// `Identifiable` requirement — `code` is unique within a day's
    /// triplet, so safe as the row key.
    var id: String { code.rawValue }

    /// Convenience: `completed_at != nil`. The card's renderer reads
    /// this directly instead of force-unwrapping the stamp.
    var isCompleted: Bool { completed_at != nil }
}

/// Top-level wire envelope for `GET /api/v1/me/challenges/today`.
struct TodayChallengesResponse: Decodable, Equatable {
    /// ISO date (YYYY-MM-DD) the challenges are issued for. iOS uses
    /// this to detect calendar rollover — when the cached `date`
    /// differs from `today`, refetch.
    let date: String
    /// Exactly 3 items per day. Deterministic per (user, date), so a
    /// re-fetch returns the same set with possibly updated
    /// `completed_at` stamps.
    let challenges: [ChallengeItem]
}

extension Endpoint where Response == TodayChallengesResponse {
    /// `GET /api/v1/me/challenges/today` — fetch the viewer's three
    /// daily challenges. Always returns 3 items (lazily issued on first
    /// call of the day). Auth required.
    static func challengesToday() -> Endpoint<TodayChallengesResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/me/challenges/today",
                 requiresAuth: true)
    }
}

/// Response payload for the per-code completion check.
struct CheckChallengeResponse: Decodable, Equatable {
    /// True when the underlying action has been performed today and
    /// the server has stamped (or already had stamped) `completed_at`.
    let completed: Bool
}

extension Endpoint where Response == CheckChallengeResponse {
    /// `POST /api/v1/me/challenges/:code/check` — polling fallback.
    /// The iOS card fires this when the user taps a row (after returning
    /// from the relevant action surface) to reconcile completion
    /// without a full `/today` refetch.
    static func challengeCheck(code: ChallengeCode) -> Endpoint<CheckChallengeResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/me/challenges/\(code.rawValue)/check",
                 requiresAuth: true)
    }
}

// MARK: - Announcements agent (Wave-10)

/// Locale-collapsed wire shape from `GET /api/v1/me/announcements`. The
/// server already picks the right (title/body/cta_label) trio for the
/// caller's `Accept-Language` so the iOS view renders one string set
/// without per-row locale logic.
///
/// `cta_url` is either a `linkfit://` custom-scheme deep link (routed
/// through `URLDeepLinkRouter`) or an external `https://` URL (opened with
/// the system browser). The banner picks the right branch via the scheme.
struct AnnouncementForUser: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let body: String?
    let cta_label: String?
    let cta_url: String?
}

/// Envelope for `GET /api/v1/me/announcements`. `announcement` is `nil`
/// when there is no active, non-dismissed broadcast — the iOS banner
/// collapses its slot in that case (auto-hide).
struct MeAnnouncementResponse: Decodable, Equatable {
    let announcement: AnnouncementForUser?
}

extension Endpoint where Response == MeAnnouncementResponse {
    /// `GET /api/v1/me/announcements` — highest-priority active
    /// announcement for the caller (in their locale), or `nil`. The
    /// banner polls this once on Home appear and after each successful
    /// dismiss to surface the next-priority row if any.
    static func meAnnouncement() -> Endpoint<MeAnnouncementResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/me/announcements",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    /// `POST /api/v1/me/announcements/:id/dismiss` — record that the
    /// caller dismissed the banner. Idempotent server-side; the iOS
    /// banner fires this on the `X` tap and then refetches to surface
    /// the next-priority row (if any) without a page refresh.
    static func dismissAnnouncement(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/me/announcements/\(id)/dismiss",
                 requiresAuth: true)
    }
}

// MARK: - Americano Tournament Models

struct AmericanoTournament: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let format: String // "solo" or "team"
    let host_id: String
    let court_count: Int
    let scoring_system: String
    let status: String // "open", "playing", "completed"
    let created_at: String
}

struct AmericanoTeam: Decodable, Equatable, Identifiable {
    let id: String
    let tournament_id: String
    let display_name: String
    let wins: Int
    let draws: Int
    let losses: Int
    let score: Int
}

struct AmericanoMatch: Decodable, Equatable, Identifiable {
    let id: String
    let tournament_id: String
    let court_name: String
    let round_number: Int
    let team_a_id: String
    let team_b_id: String
    let score_a: Int?
    let score_b: Int?
    let status: String // "pending" or "completed"
}

struct AmericanoLeaderboardEntry: Decodable, Equatable, Identifiable {
    let id: String
    let display_name: String
    let wins: Int
    let draws: Int
    let losses: Int
    let score: Int
    let pointsScored: Int
    let pointsConceded: Int
    let pointsDifference: Int
}

struct AmericanoReward: Decodable, Equatable, Identifiable {
    let id: String
    let tournament_id: String
    let winner_team_id: String
    let sponsor_coupon_code: String
    let prize_name: String
}

struct AmericanoDetailsResponse: Decodable, Equatable {
    let tournament: AmericanoTournament
    let teams: [AmericanoTeam]
    let matches: [AmericanoMatch]
    let leaderboard: [AmericanoLeaderboardEntry]
    let reward: AmericanoReward?
}

struct CreateAmericanoResponse: Decodable, Equatable {
    let id: String
}

extension Endpoint where Response == CreateAmericanoResponse {
    static func createAmericano(
        name: String,
        format: String,
        players: [String],
        courts: [String],
        scoringSystem: String
    ) -> Endpoint<CreateAmericanoResponse> {
        let body: [String: Any] = [
            "name": name,
            "format": format,
            "players": players,
            "courts": courts,
            "scoring_system": scoringSystem
        ]
        return Endpoint(
            method: .post,
            path: "/api/v1/americano/tournaments",
            body: encodeJSON(body),
            requiresAuth: true
        )
    }
}

extension Endpoint where Response == AmericanoDetailsResponse {
    static func getAmericanoDetails(id: String) -> Endpoint<AmericanoDetailsResponse> {
        Endpoint(
            method: .get,
            path: "/api/v1/americano/tournaments/\(id)",
            requiresAuth: true
        )
    }
}

extension Endpoint where Response == EmptyResponse {
    static func recordAmericanoMatchScore(matchId: String, scoreA: Int, scoreB: Int) -> Endpoint<EmptyResponse> {
        let body: [String: Any] = [
            "score_a": scoreA,
            "score_b": scoreB
        ]
        return Endpoint(
            method: .post,
            path: "/api/v1/americano/matches/\(matchId)/score",
            body: encodeJSON(body),
            requiresAuth: true
        )
    }
}
