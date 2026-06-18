import Foundation

/// Story-reaction primitives — the Instagram-style emoji bar at the
/// bottom of `StoryViewer`. The `Story` wire-model itself (and the
/// rail/feed endpoints) live in `Core/Networking/Endpoint+Stories.swift`
/// alongside the other story endpoint definitions; this file scopes the
/// extension types that are specific to reactions and keeps the
/// concerns separable from the basic stack/playback model.
///
/// Wire contract (locked):
///   POST   /api/v1/stories/:id/react   {"emoji": "heart"}   → ReactionResponse
///   DELETE /api/v1/stories/:id/react                        → ReactionResponse
///   Story payload now includes `reactions: {emoji: count}` and
///   `my_reaction: emoji | null`.

/// The five emojis we surface in the reaction bar.
///
/// The raw value is the wire identifier the server uses (`"heart"`,
/// `"fire"`, …) — we keep an enum rather than freeform strings so the
/// network call site is type-safe and we can iterate the cases in the
/// bar's display order without duplicating the list. `.padel` is the
/// brand-specific addition; the closest emoji is `🎾` (tennis ball)
/// since there's no first-class padel emoji.
///
/// Display order in the bar matches `allCases` — heart first because
/// it's the dominant action (matches Instagram's like-first emphasis).
enum StoryReactionEmoji: String, CaseIterable, Hashable, Codable {
    case heart
    case fire
    case oneHundred = "100"
    case clap
    case padel

    /// Unicode glyph rendered in the bar button.
    var glyph: String {
        switch self {
        case .heart: return "\u{2764}\u{FE0F}"   // ❤️
        case .fire: return "\u{1F525}"            // 🔥
        case .oneHundred: return "\u{1F4AF}"      // 💯
        case .clap: return "\u{1F44F}"            // 👏
        case .padel: return "\u{1F3BE}"           // 🎾 (closest stand-in for padel)
        }
    }
}

/// Server response for both `POST /react` and `DELETE /react`. Carries
/// the full reaction tally (so the client doesn't have to merge deltas
/// against its local snapshot) plus the viewer's own current selection
/// — `nil` after a DELETE, the freshly-set emoji after a POST.
///
/// `reactions` is a dictionary keyed by the wire identifier (e.g.
/// `"heart"`) → count. Unknown keys are ignored at the UI layer (we
/// only render `StoryReactionEmoji.allCases`).
struct StoryReactionResponse: Decodable, Equatable {
    let reactions: [String: Int]
    let my_reaction: String?
}

/// Body for `POST /api/v1/stories/:id/react`. Server validates the
/// `emoji` against the allow-list — sending an unknown value yields a
/// 400 which we surface as a generic error toast (silently reverting
/// the optimistic update).
struct StoryReactRequest: Encodable {
    let emoji: String
}

// MARK: - Lifetime and local mutations

extension Story {
    /// Stories are visible for 24 hours. The backend may ship an
    /// explicit `expires_at`; older payloads only have `created_at`, so
    /// the client enforces the same lifetime locally as a fallback.
    static let visibleLifetime: TimeInterval = 24 * 60 * 60

    var createdAtDate: Date? {
        Date.fromISO(created_at)
    }

    var expirationDate: Date? {
        if let expires_at, let expires = Date.fromISO(expires_at) {
            return expires
        }
        return createdAtDate?.addingTimeInterval(Self.visibleLifetime)
    }

    func isActive(referenceDate: Date = Date()) -> Bool {
        guard let expirationDate else {
            // Keep unparseable legacy payloads visible rather than
            // accidentally deleting real content because of a date
            // shape mismatch.
            return true
        }
        return expirationDate > referenceDate
    }

    func replacingViewedByMe(_ viewedByMe: Bool) -> Story {
        Story(
            id: id,
            media_url: media_url,
            media_type: media_type,
            caption: caption,
            created_at: created_at,
            expires_at: expires_at,
            viewed_by_me: viewedByMe,
            reactions: reactions,
            my_reaction: my_reaction,
            overlays: overlays,
            mentions: mentions
        )
    }

    func replacingReactions(_ reactions: [String: Int], myReaction: String?) -> Story {
        Story(
            id: id,
            media_url: media_url,
            media_type: media_type,
            caption: caption,
            created_at: created_at,
            expires_at: expires_at,
            viewed_by_me: viewed_by_me,
            reactions: reactions,
            my_reaction: myReaction,
            overlays: overlays,
            mentions: mentions
        )
    }
}

extension StoryGroup {
    func removingExpiredStories(referenceDate: Date = Date()) -> StoryGroup? {
        let activeStories = stories.filter { $0.isActive(referenceDate: referenceDate) }
        guard !activeStories.isEmpty else { return nil }
        return StoryGroup(
            user_id: user_id,
            display_name: display_name,
            photo_url: photo_url,
            has_unviewed: activeStories.contains { !$0.viewed_by_me },
            latest_story_at: activeStories.last?.created_at ?? latest_story_at,
            stories: activeStories
        )
    }

    static func removingExpiredStories(
        from groups: [StoryGroup],
        referenceDate: Date = Date()
    ) -> [StoryGroup] {
        groups.compactMap { $0.removingExpiredStories(referenceDate: referenceDate) }
    }

    static func expiredStoryIds(
        in groups: [StoryGroup],
        referenceDate: Date = Date()
    ) -> [String] {
        groups.flatMap { group in
            group.stories.compactMap { story in
                story.isActive(referenceDate: referenceDate) ? nil : story.id
            }
        }
    }

    static func nextExpirationDate(
        in groups: [StoryGroup],
        referenceDate: Date = Date()
    ) -> Date? {
        groups
            .flatMap(\.stories)
            .compactMap(\.expirationDate)
            .filter { $0 > referenceDate }
            .min()
    }
}
