import SwiftUI

/// 3-up metrics row with a thin royal-blue accent strip on the leading
/// edge — the row is busier than the hero ring above it but holds the
/// page's numerical anchor (games played, wins, win-rate).
///
/// Each metric is rendered as `value` (large) over `label` (small).
/// Win-rate sits on the right and gets a tiny success/warning badge based
/// on whether it's at or above 50 %.
///
/// Empty state: when `matches == 0` we render an inviting one-line
/// composition (medallion + headline + helper) instead of `0 · 0 · 0%`,
/// which reads like broken data. The card keeps the same vertical
/// footprint so the layout below doesn't shift.
struct PremiumStatsCard: View {
    let matches: Int
    let wins: Int

    private var winRate: Int {
        matches == 0 ? 0 : Int((Double(wins) / Double(matches)) * 100)
    }

    private var isEmpty: Bool { matches == 0 }

    var body: some View {
        HStack(spacing: 0) {
            // Lime accent strip — anchors the card to the brand without
            // requiring a full-color background that would clash with
            // the surrounding glass.
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(DSColor.accent)
                .frame(width: 3)
                .padding(.vertical, DSSpacing.md)
                .accessibilityHidden(true)

            if isEmpty {
                emptyContent
                    .padding(.vertical, DSSpacing.md)
                    .padding(.horizontal, DSSpacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(spacing: 0) {
                    metric(value: "\(matches)", labelKey: "stats.matches", icon: "calendar")
                    divider
                    metric(value: "\(wins)", labelKey: "stats.wins", icon: "trophy.fill", tint: DSColor.accent)
                    divider
                    winRateBlock
                }
                .padding(.vertical, DSSpacing.md)
                .padding(.horizontal, DSSpacing.sm)
                .frame(maxWidth: .infinity)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
        )
    }

    /// Compact empty composition — a 34pt accent medallion + a two-line
    /// text block. Sits in the slot where three numeric metrics would
    /// otherwise live, so the card occupies the same height as the
    /// populated variant. No CTA button here: the quick-action tiles
    /// directly below already provide "Create game" and "Find game",
    /// so a third CTA would be redundant.
    private var emptyContent: some View {
        HStack(spacing: DSSpacing.sm) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.16))
                    .frame(width: 34, height: 34)
                Image(systemName: "sparkles")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text("home.stats.empty.title")
                    .font(.system(size: 14, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                Text("home.stats.empty.body")
                    .font(.system(size: 12, weight: .medium, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
        }
    }

    private func metric(
        value: String,
        labelKey: LocalizedStringKey,
        icon: String,
        tint: Color = DSColor.textPrimary
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(tint == DSColor.textPrimary ? DSColor.textTertiary : tint)
                Text(value)
                    .font(.system(size: 22, weight: .heavy, design: .default))
                    .foregroundStyle(tint)
                    .monospacedDigit()
                    .lineLimit(1)
            }
            Text(labelKey)
                .font(.system(size: 11, weight: .semibold, design: .default))
                .foregroundStyle(DSColor.textTertiary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var winRateBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text("\(winRate)")
                    .font(.system(size: 22, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .monospacedDigit()
                Text("%")
                    .font(.system(size: 13, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .baselineOffset(2)
                if matches > 0 {
                    Image(systemName: winRate >= 50 ? "arrow.up.right" : "arrow.down.right")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundStyle(winRate >= 50 ? DSColor.success : DSColor.warning)
                        .padding(2)
                        .background(
                            Circle()
                                .fill((winRate >= 50 ? DSColor.success : DSColor.warning).opacity(0.15))
                        )
                }
            }
            Text("stats.win_rate")
                .font(.system(size: 11, weight: .semibold, design: .default))
                .foregroundStyle(DSColor.textTertiary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var divider: some View {
        Rectangle()
            .fill(DSColor.border.opacity(0.4))
            .frame(width: 1)
            .padding(.vertical, 6)
    }
}
