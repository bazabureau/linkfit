import SwiftUI

/// Home performance summary with a quiet skill headline and compact metrics.
struct HomeStatsCard: View {
    let firstName: String
    let skillLevel: Double
    let skillTitle: LocalizedStringKey
    let matches: Int
    let wins: Int

    var winRate: Int {
        matches == 0 ? 0 : Int(round(Double(wins) / Double(matches) * 100))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack(alignment: .center, spacing: DSSpacing.sm) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("stats.skill_level")
                        .font(.system(.caption, design: .default, weight: .medium))
                        .foregroundStyle(DSColor.textSecondary)

                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(skillTitle)
                            .font(.system(.title3, design: .default, weight: .semibold))
                            .foregroundStyle(DSColor.textPrimary)

                        Text(String(format: "%.1f", skillLevel))
                            .font(.system(.subheadline, design: .default, weight: .semibold))
                            .foregroundStyle(DSColor.accent)
                            .monospacedDigit()
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(DSColor.accentMuted))
                    }
                }

                Spacer()

                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(DSColor.accentMuted))
            }

            Rectangle()
                .fill(DSColor.border.opacity(0.65))
                .frame(height: 1)
                .padding(.vertical, 2)

            HStack(spacing: 0) {
                metric(value: "\(matches)", labelKey: "stats.matches", showsDivider: true)
                metric(value: "\(wins)", labelKey: "stats.wins", showsDivider: true)
                metric(value: "\(winRate)%", labelKey: "stats.win_rate", showsDivider: false)
            }
        }
        .padding(DSSpacing.md)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.9), lineWidth: 1)
        )
    }

    private func metric(value: String, labelKey: LocalizedStringKey, showsDivider: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(.system(.title3, design: .default, weight: .semibold))
                .foregroundStyle(DSColor.textPrimary)
                .monospacedDigit()
                .lineLimit(1)
            Text(labelKey)
                .font(.system(.caption, design: .default, weight: .medium))
                .foregroundStyle(DSColor.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .trailing) {
            if showsDivider {
                Rectangle()
                    .fill(DSColor.border.opacity(0.55))
                    .frame(width: 1, height: 34)
                    .padding(.trailing, DSSpacing.sm)
            }
        }
    }
}
