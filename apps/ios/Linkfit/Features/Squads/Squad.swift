import Foundation

// =============================================================================
// SQUAD MODELS
// -----------------------------------------------------------------------------
// Wire types for the Squads feature.
//
// A Squad is the padel-specific concept of "my regular foursome" — the 2-8
// partners a user habitually plays with. Squads persist across games and
// give the community its long-lived team identity, which a one-off `Game`
// can't express on its own.
//
// Three response shapes here:
//   - `Squad`             : summary row (used in the list / detail header).
//   - `SquadMember`       : one person attached to a squad.
//   - `SquadWithMembers`  : detail payload (squad + members[]).
//
// Endpoints live in `Core/Networking/Endpoint.swift` per the locked API
// contract; the constructors are added there alongside the rest of the
// app's REST surface so callers stay uniform.
// =============================================================================

/// One squad row. Server returns this as a stand-alone object on
/// create / patch / list-mine. `member_count` is denormalised so the list
/// card can render "5 üzv" without fetching the full roster.
///
/// `Codable` (not just Decodable) so the create flow can echo the same
/// shape back in a unit-test fixture if we ever add offline drafts. The
/// `next_game` teaser is optional — the server only ships it when at
/// least two squad members are confirmed on an upcoming game.
struct Squad: Codable, Equatable, Identifiable, Hashable {
    let id: String
    let owner_user_id: String
    let name: String
    let description: String?
    let photo_url: String?
    let max_size: Int
    let member_count: Int
    let created_at: String
    /// Teaser for the next upcoming game where 2+ squad members are
    /// joined. Nil when no such game is on the horizon.
    let next_game: SquadNextGame?

    /// Manual decoder so older payloads — pre-`next_game` rollout — still
    /// decode cleanly. Matches the tolerant style used elsewhere in the
    /// endpoint module (see `PublicUser`).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(String.self, forKey: .id)
        self.owner_user_id = try c.decode(String.self, forKey: .owner_user_id)
        self.name = try c.decode(String.self, forKey: .name)
        self.description = try c.decodeIfPresent(String.self, forKey: .description)
        self.photo_url = try c.decodeIfPresent(String.self, forKey: .photo_url)
        self.max_size = try c.decode(Int.self, forKey: .max_size)
        self.member_count = try c.decode(Int.self, forKey: .member_count)
        self.created_at = try c.decode(String.self, forKey: .created_at)
        self.next_game = try c.decodeIfPresent(SquadNextGame.self, forKey: .next_game)
    }

    /// Memberwise initializer preserved so the view-model can synthesise
    /// optimistic rows (e.g. an empty placeholder after creation while we
    /// wait for `GET /squads/me` to refresh).
    init(
        id: String,
        owner_user_id: String,
        name: String,
        description: String?,
        photo_url: String?,
        max_size: Int,
        member_count: Int,
        created_at: String,
        next_game: SquadNextGame? = nil
    ) {
        self.id = id
        self.owner_user_id = owner_user_id
        self.name = name
        self.description = description
        self.photo_url = photo_url
        self.max_size = max_size
        self.member_count = member_count
        self.created_at = created_at
        self.next_game = next_game
    }

    private enum CodingKeys: String, CodingKey {
        case id, owner_user_id, name, description, photo_url
        case max_size, member_count, created_at, next_game
    }
}

/// Compact teaser the squad-list card uses to surface "Next: tomorrow,
/// 19:00 — Padel Klub" without pulling the full game detail. The server
/// trims this from the GameSummary it already owns.
struct SquadNextGame: Codable, Equatable, Hashable {
    let game_id: String
    let starts_at: String
    let venue_name: String?
    /// Number of squad members already confirmed for this game (always 2+
    /// when surfaced — the server suppresses the teaser otherwise).
    let members_joined: Int
}

/// One person inside a squad. `is_owner` flags the captain — only owners
/// can patch / delete / invite. `joined_at` may be `nil` for the owner's
/// own membership row on some backends, depending on whether they're
/// stored as a join row at creation time; the UI tolerates this.
struct SquadMember: Decodable, Equatable, Identifiable, Hashable {
    var id: String { user_id }
    let user_id: String
    let display_name: String
    let photo_url: String?
    let is_owner: Bool
    let joined_at: String?
}

/// Detail payload from `GET /api/v1/squads/:id`. Combines the squad
/// header (same fields as the list row) with the member roster the
/// detail screen renders as chips. Members include the owner.
struct SquadWithMembers: Decodable, Equatable {
    let id: String
    let owner_user_id: String
    let name: String
    let description: String?
    let photo_url: String?
    let max_size: Int
    let created_at: String
    let members: [SquadMember]

    /// Convenience: rebuild a `Squad` summary from the detail payload so
    /// the list cache can be primed after a fresh detail fetch.
    func toSquad() -> Squad {
        Squad(
            id: id,
            owner_user_id: owner_user_id,
            name: name,
            description: description,
            photo_url: photo_url,
            max_size: max_size,
            member_count: members.count,
            created_at: created_at,
            next_game: nil
        )
    }
}

/// Top-level envelope from `GET /api/v1/squads/me`. Server returns an
/// `items` array under the `squads` key — keep the wrapper struct so an
/// additive change (e.g. pagination cursors) is non-breaking.
struct SquadsListResponse: Decodable, Equatable {
    let squads: [Squad]
}

/// Top-level envelope from `GET /api/v1/squads/:id/games`. Wraps the
/// existing `GameSummary` shape so the detail "this week" section can
/// render the same MatchRowCard the discovery list uses.
struct SquadGamesResponse: Decodable, Equatable {
    let games: [GameSummary]
}

/// Body for `POST /api/v1/squads`. `description` and `photo_url` are
/// optional — the form makes both skippable. `max_size` is server-clamped
/// to [2, 8]; client validation mirrors that so the API call only fires
/// once the form is valid.
struct CreateSquadBody: Encodable {
    let name: String
    let description: String?
    let photo_url: String?
    let max_size: Int
}

/// Body for `PATCH /api/v1/squads/:id`. Every field optional — the server
/// only mutates what's present. We always send the trimmed string when
/// non-nil; for explicit clearing (e.g. removing a description) callers
/// would need a sentinel — out of scope for the v1 surface.
struct UpdateSquadBody: Encodable {
    let name: String?
    let description: String?
    let photo_url: String?
}

/// Body for `POST /api/v1/squads/:id/invite`. The only field is the
/// invitee's user id — owner identity comes from the auth token.
struct InviteToSquadBody: Encodable {
    let user_id: String
}
