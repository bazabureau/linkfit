import Foundation

/// Single source of truth for rendering money across the app.
///
/// The backend stores amounts in MINOR units (qəpik) plus an ISO currency code.
/// Everything must render through this so that:
///   - manat always shows as the `₼` symbol (never the raw "AZN" code),
///   - qəpik are never truncated by integer division (1550 → "15,50 ₼", not "15 ₼"),
///   - the decimal separator follows the in-app language (comma in az/ru, dot in en).
///
/// Replaces the scattered, divergent formatters (BookingPriceFormatter,
/// TournamentDisplay.fee, TournamentFormatting.formatMinor, MembershipView's
/// inline `%.2f`) that each rendered manat a different way.
enum Money {
    /// Render `minor` units of `currency` as a localized amount + symbol.
    /// e.g. 5000 AZN → "50 ₼", 1550 AZN → "15,50 ₼" (az), "15.50 ₼" (en).
    static func format(minor: Int, currency: String = "AZN") -> String {
        let amount = Double(minor) / 100.0
        let f = NumberFormatter()
        f.locale = locale
        f.numberStyle = .decimal
        f.minimumFractionDigits = minor % 100 == 0 ? 0 : 2
        f.maximumFractionDigits = 2
        let number = f.string(from: NSNumber(value: amount)) ?? String(format: "%.2f", amount)
        return "\(number) \(symbol(for: currency))"
    }

    /// Symbol for a currency code; manat collapses to `₼`, anything else keeps
    /// its uppercased ISO code.
    static func symbol(for currency: String) -> String {
        currency.uppercased() == "AZN" ? "₼" : currency.uppercased()
    }

    /// Locale that drives the decimal separator, derived from the in-app
    /// language. Read straight from `UserDefaults` (the same key `LocaleManager`
    /// writes) so this stays nonisolated and callable from any context. `az`
    /// (and the system-follow default) map to the Azerbaijan market, which uses
    /// a comma decimal separator.
    private static var locale: Locale {
        switch UserDefaults.standard.string(forKey: "LinkfitPreferredLanguage") {
        case "en": return Locale(identifier: "en_US")
        case "ru": return Locale(identifier: "ru_RU")
        default:   return Locale(identifier: "az_AZ")
        }
    }
}
