import SwiftUI

/// Stacked checklist rendered inside a tier card.
///
/// The server emits each benefit as `{ key, label }`. The `label` is the
/// authoritative localized string for the *current user's* tier — for
/// the other tier cards we render statically-localized strings indexed by
/// `key` (`benefitsCopy`) so the cards have meaningful copy before the
/// network responds.
///
/// `key` maps to an SF Symbol via `iconFor(key:)` — the icon is the
/// visual anchor for each benefit row.
struct BenefitsList: View {
    let benefits: [MembershipBenefit]
    /// Override icon tint — used by the "current" tier card so checkmarks
    /// pop against the accent-tinted card surface.
    var tint: Color = DSColor.accent

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(benefits) { benefit in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: BenefitsList.iconFor(key: benefit.key))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(tint)
                        .frame(width: 18)
                    Text(benefit.label)
                        .font(.system(.subheadline, design: .rounded))
                        .foregroundStyle(DSColor.textPrimary)
                    Spacer(minLength: 0)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Static fallback copy

    /// Returns localized benefit rows for `tier`. Used by `MembershipView`
    /// when rendering tier cards that AREN'T the user's current tier
    /// (the server only sends the current tier's benefits). Keeping the
    /// keys + copy in lock-step with the server matrix is a maintenance
    /// burden, but the alternative (hitting `/membership` for each tier)
    /// is worse.
    static func staticBenefits(for tier: MembershipTier) -> [MembershipBenefit] {
        switch tier {
        case .free:
            return [
                .init(key: "basic_booking", label: String(localized: "membership.benefit.basic_booking")),
                .init(key: "join_games",    label: String(localized: "membership.benefit.join_games")),
            ]
        case .plus:
            return [
                .init(key: "unlimited_bookings",     label: String(localized: "membership.benefit.unlimited_bookings")),
                .init(key: "ad_free",                label: String(localized: "membership.benefit.ad_free")),
                .init(key: "early_tournament_access", label: String(localized: "membership.benefit.early_tournament_access")),
                .init(key: "join_games",             label: String(localized: "membership.benefit.join_games")),
            ]
        case .premium:
            return [
                .init(key: "unlimited_bookings",     label: String(localized: "membership.benefit.unlimited_bookings")),
                .init(key: "ad_free",                label: String(localized: "membership.benefit.ad_free")),
                .init(key: "early_tournament_access", label: String(localized: "membership.benefit.early_tournament_access")),
                .init(key: "coach_on_demand",        label: String(localized: "membership.benefit.coach_on_demand")),
                .init(key: "custom_badge",           label: String(localized: "membership.benefit.custom_badge")),
            ]
        }
    }

    /// Map a benefit `key` to an SF Symbol. Unknown keys fall back to a
    /// generic checkmark so a future server-side benefit row still renders.
    static func iconFor(key: String) -> String {
        switch key {
        case "basic_booking":           return "calendar"
        case "join_games":              return "person.2.fill"
        case "unlimited_bookings":      return "infinity"
        case "ad_free":                 return "eye.slash.fill"
        case "early_tournament_access": return "trophy.fill"
        case "coach_on_demand":         return "figure.tennis"
        case "custom_badge":            return "rosette"
        default:                        return "checkmark.seal.fill"
        }
    }
}
