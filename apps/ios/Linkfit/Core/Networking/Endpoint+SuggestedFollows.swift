import Foundation

// MARK: - Suggested follows

/// One row in the "People you may know" carousel surfaced on PlayersView.
///
/// The payload is computed by the backend's `GET /api/v1/me/suggested-follows`
/// endpoint — it joins the viewer's recent games + mutual-follow graph to
/// produce a small (3-5) hand-picked set of users worth following. The
/// shape mirrors `PlayerSummary` only where we have to render avatar/name
/// metadata; everything else (the `reason` enum, `shared_games_count`,
/// etc.) is dropped here on the client because we only show the count
/// caption in the card. Keep this struct deliberately small so future
/// changes to the suggestion algorithm don't ripple into the iOS code
/// base — additive fields will simply be ignored by the decoder.
///
/// Kept in its own file rather than folded into the central
/// `Endpoint.swift` so the SuggestedFollows feature can evolve without
/// touching the giant shared endpoint module — same convention
/// `Endpoint+Privacy.swift` and `Endpoint+Referrals.swift` already
/// follow.
///
/// `Identifiable` so SwiftUI's `ForEach(items)` works without an
/// explicit `id:` keyPath at the call site, and `Equatable` so
/// view-model state transitions can be diffed in unit tests.
struct SuggestedFollowItem: Decodable, Identifiable, Equatable {
    let user_id: String
    let display_name: String
    let photo_url: String?
    let primary_elo: Int?
    let shared_games_count: Int
    /// Free-form reason string from the backend (`"played_together"`,
    /// `"mutual_follow"`, etc.). Not currently surfaced in UI — we only
    /// render the games-together caption — but kept on the model so
    /// future card variants can branch on it without a wire change.
    let reason: String

    /// `Identifiable` requirement. The suggestion list never contains the
    /// same user twice (server de-dupes), so `user_id` is a stable key.
    var id: String { user_id }
}

/// Top-level wire envelope for the suggested-follows endpoint.
/// The server may add metadata (pagination cursors, refresh hints, etc.)
/// alongside `items` in the future — keep this struct narrow so
/// additive fields decode silently.
struct SuggestedFollowsResponse: Decodable, Equatable {
    let items: [SuggestedFollowItem]
}

extension Endpoint where Response == SuggestedFollowsResponse {
    /// `GET /api/v1/me/suggested-follows` — fetches the viewer's
    /// hand-picked carousel of users worth following. Returns 0-5 items;
    /// when the list is empty the carousel is hidden silently rather
    /// than rendered as a stub. Requires an auth session; the server
    /// scopes the suggestions to the bearer's user id.
    static func suggestedFollows() -> Endpoint<SuggestedFollowsResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/me/suggested-follows",
                 requiresAuth: true)
    }
}
