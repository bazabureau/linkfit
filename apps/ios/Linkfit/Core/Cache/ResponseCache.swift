import Foundation

/// Lightweight on-disk cache of decoded API payloads, keyed by an
/// app-controlled string. Sits in front of the network for the most-
/// frequented "list" endpoints (home games, players, venues, last-opened
/// ProfileView) so a launch with no internet still paints real data.
///
/// Storage backend is `UserDefaults` — payloads here are small (single
/// list of summaries) and `UserDefaults` gives us atomic, sync-safe
/// reads on app launch without spinning up a CoreData / SQLite stack
/// just for this purpose. If a single payload ever balloons past
/// ~256 KB, switch to a file-backed store; for now the trade-off
/// favours simplicity.
///
/// API shape — `save(_:forKey:)` / `load(_:forKey:)` — mirrors what the
/// spec asked for. NOTE: the spec phrased the generics as `T: Codable`
/// but the app's wire-models (`GameSummary`, `PlayerSummary`, `Venue`,
/// …) are `Decodable`-only. Promoting them to `Codable` would touch
/// `Endpoint.swift`, which is out of scope here, so the public surface
/// requires only the conformance each operation actually needs:
/// `Encodable` to save, `Decodable` to load. Callers don't need to
/// know about the split.
///
/// Cache freshness — every entry stamps a `cachedAt` date alongside the
/// payload. `load(_:forKey:)` returns `nil` for entries older than
/// `maxAge` (24h) so the UI never falls back to week-stale data
/// without the user explicitly pulling-to-refresh.
///
/// Eviction — entries are dropped on the 24h TTL above and on logout
/// via `reset()`. AppContainer.clearSession() should call `reset()`
/// when sessions change; that wiring is currently a TODO (AppContainer
/// is intentionally not modified in this change).
///
/// Concurrency — `@MainActor` because the view-models that read it run
/// on the main actor; `UserDefaults` is itself thread-safe so this is
/// belt-and-suspenders.
@MainActor
final class ResponseCache {

    static let shared = ResponseCache()

    /// Anything older than this is treated as a miss. 24h matches the
    /// "show cached data on launch + always fire network" policy — the
    /// user gets at most one day of staleness before we refuse to paint
    /// from cache.
    static let maxAge: TimeInterval = 60 * 60 * 24

    // Well-known keys so callers (and any future ProfileView wiring)
    // don't sprinkle stringly-typed keys across the codebase.
    enum Key {
        static let homeGames = "linkfit.cache.home.games.v1"
        static let players   = "linkfit.cache.players.v1"
        static let venues    = "linkfit.cache.venues.v1"
        /// Suffix with the user id at the call site, e.g.
        /// `"\(ResponseCache.Key.profilePrefix)\(userId)"`.
        static let profilePrefix = "linkfit.cache.profile.v1."
    }

    private let defaults: UserDefaults

    /// Tracks the namespace of cache keys we own so `reset()` can purge
    /// them without nuking unrelated `UserDefaults` content. Populated
    /// at every `save(...)`; persisted across launches so a logout
    /// after a fresh start still finds entries from earlier sessions.
    private static let indexKey = "linkfit.cache.index.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: - Save

    /// Persist a fresh payload under `key`. Failures (encoder throw,
    /// disk full, …) are swallowed silently — this cache is a
    /// best-effort speedup; a save miss just means the next launch
    /// hits the network as usual.
    func save<T: Encodable & Sendable>(_ value: T, forKey key: String) async {
        guard let data = await Task.detached(priority: .background, operation: {
            let envelope = WriteEnvelope(cachedAt: Date(), payload: value)
            let encoder = JSONEncoder()
            return try? encoder.encode(envelope)
        }).value else { return }
        defaults.set(data, forKey: key)
        registerKey(key)
    }

    // MARK: - Load

    /// Returns the cached payload + its capture timestamp, or `nil` if
    /// nothing is cached, the stored bytes can't be decoded into `T`
    /// (schema drift across app versions), or the entry is older than
    /// `maxAge`.
    ///
    /// The timestamp lets callers render "Last updated 5m ago" copy
    /// without a second store lookup.
    func load<T: Decodable & Sendable>(
        _ type: T.Type,
        forKey key: String
    ) async -> (value: T, cachedAt: Date)? {
        guard let data = defaults.data(forKey: key) else { return nil }
        guard let envelope = await Task.detached(priority: .background, operation: {
            let decoder = JSONDecoder()
            return try? decoder.decode(ReadEnvelope<T>.self, from: data)
        }).value else {
            // Schema drift — old payload no longer decodes into the
            // current `T`. Drop the entry so we don't keep paying the
            // decode cost on every launch.
            defaults.removeObject(forKey: key)
            return nil
        }
        let age = Date().timeIntervalSince(envelope.cachedAt)
        guard age >= 0, age <= Self.maxAge else {
            // Expired (or future-dated due to clock skew). Drop it.
            defaults.removeObject(forKey: key)
            return nil
        }
        return (envelope.payload, envelope.cachedAt)
    }

    // MARK: - Reset

    /// Drop every key this cache owns. Call from
    /// `AppContainer.clearSession()` on logout so the next user doesn't
    /// see the previous user's cached lists. Currently a TODO at the
    /// AppContainer call-site — left here for that wiring.
    func reset() {
        for key in trackedKeys() {
            defaults.removeObject(forKey: key)
        }
        defaults.removeObject(forKey: Self.indexKey)
    }

    // MARK: - Private

    // Two single-direction envelopes instead of one bidirectional
    // `Codable` envelope — the wire models the cache wraps are
    // `Decodable`-only, so we can't constrain a shared generic to
    // `T: Codable`. The two structs share the same JSON shape
    // (`{ "cachedAt": …, "payload": … }`) so a save and a later load
    // round-trip cleanly.
    private struct WriteEnvelope<T: Encodable & Sendable>: Encodable, Sendable {
        let cachedAt: Date
        let payload: T
    }

    private struct ReadEnvelope<T: Decodable & Sendable>: Decodable, Sendable {
        let cachedAt: Date
        let payload: T
    }

    private func registerKey(_ key: String) {
        var keys = trackedKeys()
        guard !keys.contains(key) else { return }
        keys.append(key)
        defaults.set(keys, forKey: Self.indexKey)
    }

    private func trackedKeys() -> [String] {
        defaults.stringArray(forKey: Self.indexKey) ?? []
    }
}
