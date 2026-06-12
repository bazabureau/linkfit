import Foundation

/// Locale-aware distance formatter.
///
/// Why this exists: rendering distance as `String(format: "%.1f km", km)`
/// hardcodes the C-locale decimal point ("5.2 km"). Azerbaijani users
/// should see "5,2 km" — the comma is the canonical decimal separator
/// across the European locales Linkfit ships in (`az`, `tr`, `ru`, etc.).
/// Twenty-odd cell renderers each calling `String(format:)` reproduce
/// the same bug, so we centralise here.
///
/// Why `.providedUnit`: by default `MeasurementFormatter` honours the
/// user's region — a US user with their iPhone set to "United States"
/// would see "3.2 mi" even though Linkfit's coverage is Baku-first and
/// the backend speaks kilometres. We pin the unit so the number that
/// leaves the formatter is the same number the API returned, and only
/// the *formatting* (separator, digit grouping) is localised. If we
/// ever ship to a mile-native market we'll add an opt-in path here.
///
/// Why `@MainActor`: `MeasurementFormatter` is not `Sendable`, and every
/// caller is a SwiftUI view body that already runs on the main actor.
/// Pinning the helper to `@MainActor` lets us cache the formatter as a
/// plain `static var` without the `nonisolated(unsafe)` escape hatch.
@MainActor
enum DistanceFormatter {

    /// Format a kilometre value as a localised "<n> km" string.
    /// Always renders one fractional digit, matching the legacy
    /// `String(format: "%.1f km", km)` call sites this replaces.
    static func km(_ value: Double) -> String {
        cached.string(from: Measurement(value: value, unit: UnitLength.kilometers))
    }

    // A single formatter is reused across calls. `MeasurementFormatter`
    // is moderately expensive to construct (it spins up an internal
    // `NumberFormatter` and resolves the current locale), and distance
    // labels render inside lists where the same row redraws on every
    // scroll tick. Caching keeps that overhead off the main thread's
    // budget.
    private static let cached: MeasurementFormatter = {
        let f = MeasurementFormatter()
        f.unitOptions = .providedUnit
        f.numberFormatter.maximumFractionDigits = 1
        f.numberFormatter.minimumFractionDigits = 1
        return f
    }()
}
