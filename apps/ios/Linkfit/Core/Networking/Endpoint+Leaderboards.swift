import Foundation

// MARK: - Models
//
// The Leaderboards endpoint is a separate, paginated surface (top-N by ELO)
// that is intentionally distinct from `/api/v1/rankings` — that one is a
// fixed snapshot scoped to a sport and doesn't expose offset pagination
// or `total_count`. Keeping the model types separate avoids muddling the
// two contracts when either side evolves.

/// One row in the ELO leaderboard. Mirrors the API's `LeaderboardEntry`
/// schema verbatim (snake_case stays so we can decode straight through
/// without a custom CodingKeys block).
struct LeaderboardEntry: Decodable, Equatable, Identifiable {
    var id: String { user_id }
    let rank: Int
    let user_id: String
    let display_name: String
    let photo_url: String?
    let elo_rating: Int
    /// Word-based bucket derived server-side from `elo_rating`. iOS surfaces
    /// the localized label via `SkillLevel(rawValue:)`. Optional in the
    /// decoder so older payloads (pre-Wave-9) still parse — we fall back
    /// to deriving locally from `elo_rating`.
    let skill_level: String?
    let games_played: Int
    /// Total confirmed wins — drives the "N qələbə" trailing cell.
    /// Optional so older payloads decode; defaults to 0 in views that
    /// need the raw integer.
    let games_won: Int?
    /// 0...1, e.g. 0.61 = 61% win rate.
    let win_rate: Double
}

/// One page of the leaderboard. The server returns the global
/// `total_count` alongside the page so we can show "X of Y" hints and
/// stop scrolling when we've fetched everything.
struct LeaderboardPage: Decodable, Equatable {
    let items: [LeaderboardEntry]
    let total_count: Int
}

// MARK: - Filters (Wave-9)
//
// The Leaderboards screen surfaces three filter axes that the user can flip
// independently. We model them as Swift enums (raw values match the server
// contract exactly) so the call site never builds bare strings.

/// Geographic scope. `city` filters to the viewer's local players once the
/// venue→city mapping ships server-side; today both behave the same but the
/// client passes it so the API change is invisible when it lands.
enum LeaderboardScope: String, CaseIterable, Identifiable, Sendable {
    case city
    case global
    var id: String { rawValue }
}

/// Skill bucket filter. `all` skips the filter entirely. Cases match the
/// server enum and `SkillLevel.rawValue` so a single string round-trips
/// between persisted state, the URL, and the rendered label.
enum LeaderboardSkillFilter: String, CaseIterable, Identifiable, Sendable {
    case all
    case beginner
    case intermediate
    case advanced
    case expert
    var id: String { rawValue }
}

/// Time-window filter. `week` and `month` apply `pss.updated_at >= NOW() -
/// INTERVAL` server-side; `all` skips the recency filter.
enum LeaderboardPeriod: String, CaseIterable, Identifiable, Sendable {
    case week
    case month
    case all
    var id: String { rawValue }
}

// MARK: - Endpoint

extension Endpoint where Response == LeaderboardPage {
    /// Top-N players by ELO for a given sport. The list is server-sorted
    /// (highest ELO first) and `offset`-paginated. `limit` is clamped
    /// server-side; we leave the caller to pass a sensible page size
    /// (50 is the default per the spec).
    ///
    /// Wave-9 — accepts the three retention filters surfaced on the iOS
    /// Leaderboards screen. Passing `nil` for any axis omits the query
    /// param entirely so the server treats it as "no filter" rather than
    /// "filter to the empty set".
    static func leaderboardElo(sport: String = "padel",
                               limit: Int = 50,
                               offset: Int = 0,
                               scope: LeaderboardScope? = nil,
                               skill: LeaderboardSkillFilter? = nil,
                               period: LeaderboardPeriod? = nil) -> Endpoint<LeaderboardPage> {
        var items: [URLQueryItem] = [
            .init(name: "sport", value: sport),
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)")
        ]
        if let scope { items.append(.init(name: "scope", value: scope.rawValue)) }
        if let skill { items.append(.init(name: "skill", value: skill.rawValue)) }
        if let period { items.append(.init(name: "period", value: period.rawValue)) }
        return Endpoint(
            method: .get,
            path: "/api/v1/leaderboards/elo",
            query: items
        )
    }
}
