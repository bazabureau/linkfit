import Foundation

// =============================================================================
// ANALYTICS EVENT TAXONOMY
// -----------------------------------------------------------------------------
// Typed enum of every product-funnel event the iOS client ships to PostHog.
// Each case carries the properties that event needs as associated values —
// this is the only place where the property schema is defined, so a typo at
// the call site fails to compile rather than landing as a malformed event in
// the dashboard.
//
// Why an enum and not a free-form `[String: Any]`?
//   1. Schema-stable. Adding a property is a deliberate widening of the case;
//      renaming one becomes a compile error in every call site at once.
//   2. PII-safe. The conversion to `[String: Any]` (see `payload`) is the
//      one place we could leak email/phone — keep it audit-able and lean.
//   3. Cheap to extend. New events go through `static let name` + a
//      `payload` branch.
//
// Add a new case alongside an existing one, run the build, and let the
// compiler walk you through the call-site updates.
// =============================================================================

/// Closed enum of every PostHog event the iOS client emits. The `name` of
/// the event is the snake-cased string sent on the wire; `properties` is
/// the typed payload. Both come out of `payload()` ready to hand to the
/// PostHog SDK (or any other vendor with a `capture(event:properties:)`
/// shape).
enum AnalyticsEvent: Sendable, Equatable {
    /// Fired exactly once after a registration call returns 201. Captures
    /// the locale the user signed up in so we can split funnels by market,
    /// and a bool for whether they pasted a referral code (we don't ship
    /// the code itself — the server already keyed the join on its own
    /// table and we want this property in PostHog to be a high-cardinality
    /// boolean, not a free-form string).
    case signupCompleted(locale: String, referralCodeUsed: Bool)

    /// Fired the first time a given device successfully joins any game.
    /// Subsequent joins are intentionally NOT instrumented here — the
    /// "first" qualifier is what makes this useful as an activation
    /// metric. The flag is stored in `UserDefaults` (see
    /// `AnalyticsEvent.markFirstGameJoinIfNeeded`) so a re-install does
    /// not re-emit, and a logout/login as the same person on the same
    /// device does not re-emit either. The trade-off (cross-device the
    /// event fires once per device) is acceptable for an activation
    /// metric.
    case firstGameJoined(gameId: String)

    /// Fired on every successful `POST /users/:id/follow` from the iOS
    /// client. The `source` says which screen the action originated from
    /// — closed set so the dashboard can stack-rank UI surfaces by
    /// follow-conversion.
    case followUser(targetUserId: String, source: FollowSource)

    /// Fired on every successful story post. We deliberately do NOT ship
    /// the media URL or caption text — both can contain identifying
    /// information.
    case storyPosted(hasCaption: Bool)

    /// Fired when a squad is created. `memberCount` starts at 1 (the
    /// creator) — we keep it as a property so a later "invited friends
    /// at creation time" feature can ship a value > 1 without renaming
    /// the event.
    case squadCreated(memberCount: Int)

    /// Closed set of UI surfaces a follow action can originate from.
    /// Adding a value here means another screen has been instrumented;
    /// the dashboard's stack-rank slice depends on this enum being
    /// exhaustive.
    enum FollowSource: String, Sendable, Equatable {
        case profile
        case matchmaking
        case suggested
        case feed
    }

    // MARK: - Wire format

    /// Event name in `snake_case` form as it lands in PostHog. Keep these
    /// stable — renaming breaks every downstream funnel / dashboard.
    var name: String {
        switch self {
        case .signupCompleted:    return "signup_completed"
        case .firstGameJoined:    return "first_game_joined"
        case .followUser:         return "follow_user"
        case .storyPosted:        return "story_posted"
        case .squadCreated:       return "squad_created"
        }
    }

    /// Flatten the associated values into a property bag the PostHog SDK
    /// can serialize. We deliberately limit the value space to scalars
    /// (`String`, `Int`, `Bool`) — nested dictionaries and arrays make
    /// dashboards hard to query in PostHog, and the schema-by-enum
    /// guarantee evaporates if we permit arbitrary nesting.
    var properties: [String: Any] {
        switch self {
        case .signupCompleted(let locale, let referralCodeUsed):
            return [
                "locale": locale,
                "referral_code_used": referralCodeUsed,
            ]
        case .firstGameJoined(let gameId):
            return [
                "game_id": gameId,
            ]
        case .followUser(let targetUserId, let source):
            return [
                "target_user_id": targetUserId,
                "source": source.rawValue,
            ]
        case .storyPosted(let hasCaption):
            return [
                "has_caption": hasCaption,
            ]
        case .squadCreated(let memberCount):
            return [
                "member_count": memberCount,
            ]
        }
    }

    // MARK: - First-game gating

    /// UserDefaults key flipped once the device has emitted
    /// `first_game_joined`. Public so tests can clear it.
    static let firstGameJoinedDefaultsKey = "az.linkfit.analytics.firstGameJoined"

    /// Idempotent helper for the "first game joined" case. Call this
    /// from the call site right after a successful join — if this is
    /// the FIRST successful join on the device, the event is emitted
    /// and the flag is set; subsequent calls are no-ops.
    ///
    /// Returns true when the event was emitted, false when it was
    /// already recorded.
    @MainActor
    @discardableResult
    static func markFirstGameJoinIfNeeded(
        gameId: String,
        defaults: UserDefaults = .standard,
        emit: (AnalyticsEvent) -> Void
    ) -> Bool {
        if defaults.bool(forKey: firstGameJoinedDefaultsKey) {
            return false
        }
        defaults.set(true, forKey: firstGameJoinedDefaultsKey)
        emit(.firstGameJoined(gameId: gameId))
        return true
    }
}
