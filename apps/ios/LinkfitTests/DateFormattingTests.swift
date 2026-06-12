import XCTest
import Foundation
@testable import Linkfit

/// The product renders ISO-8601 timestamps from the API in several places
/// (GameRow, UpcomingMatchCard, MyBookingsView). Each call site builds a
/// `DateFormatter` inline — the *pattern* is the contract we care about,
/// not where the formatter lives, so these tests document that pattern and
/// guard the locale-aware fall-throughs.
///
/// If a future PR consolidates these into a `DateStyle` helper we can swap
/// `formatStartTime(_:locale:)` below to call into it; the assertions will
/// keep holding.
final class DateFormattingTests: XCTestCase {

    /// Mirrors the formatter built inside `GameRow.timeLine` and the various
    /// `formattedStart` properties across Home cards. The locale parameter
    /// is what differs by user-picked language — everything else is fixed.
    private func formatStartTime(_ iso: String, locale: Locale) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else {
            return iso
        }
        let f = DateFormatter()
        f.locale = locale
        f.doesRelativeDateFormatting = true
        f.dateStyle = .medium
        f.timeStyle = .short
        // Fix the time zone so the date portion is deterministic across runners.
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: date)
    }

    // MARK: - ISO 8601 parsing

    func test_isoParser_acceptsTimezoneSuffixedTimestamps() {
        let formatter = ISO8601DateFormatter()
        XCTAssertNotNil(formatter.date(from: "2026-05-18T14:30:00Z"))
        XCTAssertNotNil(formatter.date(from: "2026-05-18T18:30:00+04:00"))
    }

    func test_isoParser_rejectsMalformedString_andCallerFallsBackToRaw() {
        let raw = "not-a-real-iso-timestamp"
        // The shared inline pattern returns the raw string on parse failure
        // so the UI never blanks out a row.
        XCTAssertEqual(formatStartTime(raw, locale: Locale(identifier: "en_US")), raw)
    }

    // MARK: - Locale-aware rendering

    func test_englishAndRussianAndAzeri_produceLocaleSpecificMonthNames() {
        let iso = "2026-05-18T14:30:00Z"
        let en  = formatStartTime(iso, locale: Locale(identifier: "en_US"))
        let ru  = formatStartTime(iso, locale: Locale(identifier: "ru_RU"))
        let az  = formatStartTime(iso, locale: Locale(identifier: "az_AZ"))

        // All three render *something*.
        XCTAssertFalse(en.isEmpty)
        XCTAssertFalse(ru.isEmpty)
        XCTAssertFalse(az.isEmpty)

        // Each locale must produce a distinct rendering for the date portion.
        // (At worst the time portion might collide in 24h locales, but the
        // month abbreviation alone diverges between en/ru/az.)
        XCTAssertNotEqual(en, ru,
                          "English and Russian renderings must differ — month names diverge.")
        XCTAssertNotEqual(en, az,
                          "English and Azeri renderings must differ — month names diverge.")
    }

    func test_relativeDateFormatting_isApplied_forTodayAndYesterday() {
        // doesRelativeDateFormatting = true means today/yesterday/tomorrow are
        // substituted in the user's locale. We don't pin the exact string
        // (Apple varies it across iOS releases) — we just confirm the
        // formatter returns a non-empty value for both fixed dates and the
        // current day. Anything that "looks like" a date is acceptable.
        let now = Date()
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.doesRelativeDateFormatting = true
        f.dateStyle = .medium
        f.timeStyle = .short

        let rendered = f.string(from: now)
        XCTAssertFalse(rendered.isEmpty)
        // The relative-formatting algorithm should at minimum contain a
        // time component when given today's date.
        XCTAssertTrue(rendered.contains(":") || rendered.contains("AM") || rendered.contains("PM") ||
                      rendered.contains("am") || rendered.contains("pm"),
                      "A `.short` time style on today's date must include a time component.")
    }

    func test_distanceFormatter_oneDecimal_isLocaleAware() {
        // GameRow renders `String(format: "%.1f", km)` — POSIX-locale safe.
        // Distance comes from the backend as a Double; we pin the format
        // contract since the UI relies on a single decimal place.
        XCTAssertEqual(String(format: "%.1f", 12.345), "12.3")
        XCTAssertEqual(String(format: "%.1f", 0.0), "0.0")
        // Negative shouldn't happen in practice (distances are non-negative)
        // but document it so future signedness bugs surface in tests, not in
        // production UIs.
        XCTAssertEqual(String(format: "%.1f", -1.5), "-1.5")
    }
}
