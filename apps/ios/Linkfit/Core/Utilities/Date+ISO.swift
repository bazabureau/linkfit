import Foundation

/// Centralised ISO 8601 parsing for the dates the backend produces.
///
/// Why this exists: `Foundation.ISO8601DateFormatter` by default only
/// accepts the bare form (`2026-05-20T19:00:00Z`). Our API emits the
/// fractional-seconds variant (`2026-05-20T19:00:00.000Z`), so the
/// default formatter returns `nil` for *every* timestamp we ship. The
/// result is the raw ISO string leaking into the UI — exactly the
/// "2026-05-20T19:00:00.000Z" the user reported on the game detail
/// screen.
///
/// Each call site that does `ISO8601DateFormatter().date(from: s)`
/// has the same bug. Rather than fixing 28 individual sites and
/// hoping the next contributor remembers, we centralise here.
///
/// Strategy: try the fractional-seconds formatter first (the common
/// case), fall back to the strict formatter (in case the backend ever
/// trims trailing zeros), and finally bail out. Two formatters are
/// cached as static lets so we don't pay the (non-trivial) construction
/// cost on every cell render.
extension Date {

    /// Parse an ISO 8601 timestamp produced by the Linkfit API.
    /// Returns `nil` only if the input is genuinely unparseable.
    static func fromISO(_ string: String) -> Date? {
        if let d = isoWithFractional.date(from: string) { return d }
        if let d = isoStrict.date(from: string) { return d }
        return nil
    }

    /// Encode a `Date` to the ISO 8601 form the backend produces and
    /// expects on writes — including fractional seconds, since the
    /// rest of the codebase is calibrated for that shape. Using this
    /// helper for outbound timestamps keeps the wire format symmetric
    /// with `fromISO`, so a round-trip (encode → API → decode) is
    /// guaranteed to produce the same `Date`.
    func toISO() -> String {
        Self.isoWithFractional.string(from: self)
    }

    // `ISO8601DateFormatter` is documented thread-safe (see Apple's
    // Foundation reference, "Thread Safety"), but it's not `Sendable`
    // in Swift 6, so we mark the cached instances `nonisolated(unsafe)`
    // to opt out of the concurrency check while keeping the cache.
    nonisolated(unsafe) private static let isoWithFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    nonisolated(unsafe) private static let isoStrict: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
