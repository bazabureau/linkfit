import SwiftUI

/// Single-row stats strip: ELO · Matches · Win-rate. The hierarchy is
/// inverted from the previous `PremiumStatsCard` (3-up with a lime
/// accent strip on the leading edge):
///
///   - That card commanded too much vertical real estate for what is
///     ultimately *summary metadata*, not a primary action.
///   - On home, the primary action (Create / Find game) should be the
///     visual anchor. Stats are a one-line "by the way, here's your
///     pulse" — not the headline.
///
/// Each metric collapses gracefully when the user has no games: ELO
/// shows the player's actual rating (computed by the backend even at 0
/// matches), but matches and win-rate both render as "—" instead of
/// the literal `0` / `0%`, which reads as broken data rather than
/// no-data-yet.
struct HomePulseStrip: View {
    let elo: Int?
    let matches: Int
    let wins: Int

    private var winRate: Int? {
        guard matches > 0 else { return nil }
        return Int((Double(wins) / Double(matches)) * 100)
    }

    var body: some View {
        HStack(spacing: 0) {
            metric(
                valueText: elo.map(String.init) ?? "—",
                labelKey: "stats.elo.compact",
                tint: DSColor.accent
            )
            divider
            metric(
                valueText: matches == 0 ? "—" : "\(matches)",
                labelKey: "stats.matches.compact",
                tint: DSColor.textPrimary
            )
            divider
            metric(
                valueText: winRate.map { "\($0)%" } ?? "—",
                labelKey: "stats.win_rate.compact",
                tint: DSColor.textPrimary,
                accessory: winRateAccessory
            )
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
        )
    }

    // MARK: - Subviews

    private func metric(
        valueText: String,
        labelKey: LocalizedStringKey,
        tint: Color,
        accessory: AnyView? = nil
    ) -> some View {
        VStack(spacing: 3) {
            HStack(spacing: 4) {
                Text(valueText)
                    .font(.system(size: 18, weight: .heavy, design: .default))
                    .foregroundStyle(tint)
                    .monospacedDigit()
                    .lineLimit(1)
                if let accessory { accessory }
            }
            Text(labelKey)
                .font(.system(size: 10, weight: .semibold, design: .default))
                .tracking(0.6)
                .foregroundStyle(DSColor.textTertiary)
                .textCase(.uppercase)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity)
    }

    /// Small up/down arrow next to the win-rate when the user has any
    /// games. Visual cue: green when ≥50%, warning when below. Hidden
    /// entirely when the user has no matches so the strip doesn't
    /// suggest a (false) trajectory at zero data.
    private var winRateAccessory: AnyView? {
        guard let rate = winRate else { return nil }
        let positive = rate >= 50
        return AnyView(
            Image(systemName: positive ? "arrow.up.right" : "arrow.down.right")
                .font(.system(size: 9, weight: .heavy))
                .foregroundStyle(positive ? DSColor.success : DSColor.warning)
                .padding(2)
                .background(
                    Circle()
                        .fill((positive ? DSColor.success : DSColor.warning).opacity(0.15))
                )
        )
    }

    private var divider: some View {
        Rectangle()
            .fill(DSColor.border.opacity(0.35))
            .frame(width: 1, height: 24)
    }
}
