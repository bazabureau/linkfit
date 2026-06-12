//
//  SharedDefaults.swift
//  Linkfit + LinkfitWidgets (shared)
//
//  App Group bridge between the main app and the WidgetKit extension. The
//  widget cannot reach the network, the keychain, or any in-memory store the
//  app owns — it can only read from a sandbox that both processes can see.
//  That sandbox is the App Group `group.az.linkfit.app`, which we expose as a
//  `UserDefaults(suiteName:)`. The main app writes; the widget reads.
//
//  Why a single file in both targets:
//    The schema must match exactly on both sides. Sharing one source file is
//    the safest way to keep the Codable contract in lockstep — if you rename
//    a property here, both Compiles re-fail until you migrate both sides.
//
//  Persistence strategy:
//    We JSON-encode each value object into a single Data blob per key, rather
//    than scatter primitive keys. That gives us cheap atomic snapshots and
//    lets us evolve the schema (add a field, default it on decode) without
//    touching UserDefaults migration code.
//
//  Threading:
//    UserDefaults is process-safe; the widget timeline provider reads on its
//    own queue. We don't lock — last writer wins, which is fine for a cache.

import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

// MARK: - Shared models

/// Minimal projection of a game suitable for the lock-screen widget. We
/// deliberately keep this small: the widget renders text, not an entity graph.
public struct WidgetGame: Codable, Hashable, Sendable {
    public let id: String
    public let sport: String
    public let startsAt: Date
    public let venueName: String

    public init(id: String, sport: String, startsAt: Date, venueName: String) {
        self.id = id
        self.sport = sport
        self.startsAt = startsAt
        self.venueName = venueName
    }
}

/// Snapshot consumed by `NextMatchWidget`. Distinct from `WidgetGame` because
/// the next-match widget needs an *opponent* name (the host's display name on
/// the API, since the API currently doesn't model "partner vs opponent" — for
/// a 1v1 the host is the other player you're scheduled against) which the
/// legacy `WidgetGame` doesn't carry. Keeping the two value types lets each
/// widget surface evolve without breaking the other's stored payload.
public struct WidgetMatchSnapshot: Codable, Hashable, Sendable {
    public let game_id: String
    public let starts_at: Date
    public let venue_name: String
    public let opponent_name: String

    public init(game_id: String, starts_at: Date, venue_name: String, opponent_name: String) {
        self.game_id = game_id
        self.starts_at = starts_at
        self.venue_name = venue_name
        self.opponent_name = opponent_name
    }
}

// MARK: - SharedContainer

/// Lightweight namespace around the App Group `UserDefaults` for the
/// `NextMatchWidget` snapshot. Layered on top of (not replacing) `WidgetCache`
/// so the existing `LinkfitWidget` keeps reading from its own keys without
/// migration. Both writers funnel through the same suite, so atomicity across
/// processes is whatever UserDefaults already gives us.
public enum SharedContainer {

    /// Matches `WidgetCache.appGroupID` — single source of truth for the
    /// App Group identifier used by every widget we ship.
    public static let appGroupID = WidgetCache.appGroupID

    /// `NextMatchWidget`'s reload identifier. Kept here (not in the extension)
    /// so the app can call `WidgetCenter.shared.reloadTimelines(ofKind:)`
    /// without importing the widget module.
    public static let nextMatchWidgetKind = "az.linkfit.next-match"

    private enum Key {
        static let nextMatchSnapshot = "widget.nextMatchSnapshot.v1"
    }

    private static var defaults: UserDefaults {
        // Mirror `WidgetCache`'s fallback so snapshot writes never crash a
        // simulator run that's missing the entitlement.
        UserDefaults(suiteName: appGroupID) ?? .standard
    }

    private static var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }

    private static var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }

    /// Persists the next-match snapshot for `NextMatchWidget` and asks
    /// WidgetKit to reload its timeline. Passing `nil` clears the slot —
    /// the widget will fall back to its empty state on next render.
    public static func saveSnapshot(_ snapshot: WidgetMatchSnapshot?) {
        guard let snapshot else {
            defaults.removeObject(forKey: Key.nextMatchSnapshot)
            reloadNextMatchTimelines()
            return
        }
        if let data = try? encoder.encode(snapshot) {
            defaults.set(data, forKey: Key.nextMatchSnapshot)
        }
        reloadNextMatchTimelines()
    }

    /// Read the most recently persisted snapshot. Returns `nil` if the slot
    /// is empty or the stored payload no longer decodes (schema drift).
    public static func loadSnapshot() -> WidgetMatchSnapshot? {
        guard let data = defaults.data(forKey: Key.nextMatchSnapshot) else { return nil }
        return try? decoder.decode(WidgetMatchSnapshot.self, from: data)
    }

    /// Nudge WidgetKit to reload `NextMatchWidget`. Guarded by `canImport`
    /// so unit tests don't link WidgetKit just to call this.
    public static func reloadNextMatchTimelines() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadTimelines(ofKind: nextMatchWidgetKind)
        #endif
    }
}

// MARK: - WidgetCache

/// Type-safe wrapper around the App Group UserDefaults suite. All keys are
/// declared here so a typo in the widget can't silently miss a write from
/// the app. Optional values clear themselves on `nil` assignment.
public final class WidgetCache: @unchecked Sendable {

    /// The App Group identifier. Must match the `com.apple.security.application-groups`
    /// entitlement on both the Linkfit app target and the LinkfitWidgets target.
    public static let appGroupID = "group.az.linkfit.app"

    /// Shared instance — cheap because UserDefaults is itself a cached singleton.
    public static let shared = WidgetCache()

    /// The widget kind reload identifier. Exposed here (not in the widget
    /// module) so the main app can call `WidgetCenter.shared.reloadTimelines(ofKind:)`
    /// without importing WidgetKit-specific symbols from the extension.
    public static let widgetKind = "az.linkfit.next-game"

    private let defaults: UserDefaults

    public init(suiteName: String = WidgetCache.appGroupID) {
        // Fall back to .standard so unit tests and the simulator (without an
        // entitlement) don't crash. The real device path always succeeds.
        self.defaults = UserDefaults(suiteName: suiteName) ?? .standard
    }

    // MARK: Keys

    private enum Key {
        static let nextGame = "widget.nextGame.v1"
        static let currentStreak = "widget.currentStreak.v1"
        static let unreadConversations = "widget.unreadConversations.v1"
        static let lastUpdated = "widget.lastUpdated.v1"
    }

    // MARK: - nextGame

    /// The next scheduled game for the signed-in user. `nil` means the user
    /// has nothing on the calendar — the widget shows its empty state.
    public var nextGame: WidgetGame? {
        get { decode(WidgetGame.self, key: Key.nextGame) }
        set { encode(newValue, key: Key.nextGame) }
    }

    // MARK: - currentStreak

    /// Consecutive-week activity streak surfaced from the Streaks feature.
    /// Stored as a primitive because `Int` already round-trips cleanly.
    public var currentStreak: Int {
        get { defaults.integer(forKey: Key.currentStreak) }
        set { defaults.set(newValue, forKey: Key.currentStreak) }
    }

    // MARK: - unreadConversations

    /// Used by future widget variants (and by accessibility hints today).
    public var unreadConversations: Int {
        get { defaults.integer(forKey: Key.unreadConversations) }
        set { defaults.set(newValue, forKey: Key.unreadConversations) }
    }

    /// Wall-clock timestamp of the most recent write. The widget uses this
    /// to decide whether the cached snapshot is fresh enough to trust on
    /// first render before the next timeline reload fires.
    public var lastUpdated: Date? {
        get { defaults.object(forKey: Key.lastUpdated) as? Date }
        set { defaults.set(newValue, forKey: Key.lastUpdated) }
    }

    // MARK: - Convenience write

    /// Atomic-feeling update used by `HomeViewModel` / `MyBookingsViewModel`
    /// after a successful network refresh. Touching `lastUpdated` and asking
    /// WidgetKit to reload in one shot keeps the widget in sync with the
    /// canonical app state.
    public func update(
        nextGame: WidgetGame?,
        currentStreak: Int,
        unreadConversations: Int
    ) {
        self.nextGame = nextGame
        self.currentStreak = currentStreak
        self.unreadConversations = unreadConversations
        self.lastUpdated = Date()
        reloadWidgetTimelines()
    }

    /// Asks WidgetKit to reload our timeline. Safe to call from the app even
    /// if WidgetKit isn't linked at runtime — guarded by `#if canImport`.
    public func reloadWidgetTimelines() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetCache.widgetKind)
        #endif
    }

    // MARK: - Private

    private func encode<T: Encodable>(_ value: T?, key: String) {
        guard let value else {
            defaults.removeObject(forKey: key)
            return
        }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(value) {
            defaults.set(data, forKey: key)
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(T.self, from: data)
    }
}
