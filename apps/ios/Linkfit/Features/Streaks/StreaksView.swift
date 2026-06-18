import SwiftUI

/// Per-user play-streak screen. Surfaces:
///   - A "Current / Longest" KPI strip at the top
///   - The 26-week heatmap with tap-to-inspect tooltip
///   - A small legend explaining the lime saturation scale
///
/// The same heatmap component (`StreaksHeatmap`) is meant to be embeddable
/// in `ProfileView` — the Profile agent imports `StreaksHook.makeEmbed` to
/// drop a compact version directly on the profile screen.
struct StreaksView: View {
    @State var viewModel: StreaksViewModel
    @State private var selectedWeek: StreaksWeek?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            content
                .refreshable { await viewModel.load() }
        }
        .task { await viewModel.load() }
        .navigationTitle(Text("streaks.title"))
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(DSColor.background, for: .navigationBar)
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            VStack { LoadingView(); Spacer() }
        case .empty:
            ScrollView {
                VStack {
                    premiumEmptyCard
                        .padding(.horizontal, DSSpacing.md)
                        .padding(.top, DSSpacing.lg)
                    Spacer()
                }
            }
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
        case .loaded(let resp):
            ScrollView {
                VStack(spacing: DSSpacing.lg) {
                    kpiStrip(resp)
                    heatmapCard(resp)
                    legendCard
                    Spacer().frame(height: DSSpacing.xl)
                }
                .padding(.horizontal, DSSpacing.md)
            }
        }
    }

    // MARK: - Empty state

    /// Empty card shown when the user has never logged a game yet (the
    /// server returns 26 zero-count weeks). Mirrors the motif used across
    /// feature screens.
    private var premiumEmptyCard: some View {
        VStack(spacing: DSSpacing.sm) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.16))
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.4), lineWidth: 1)
                    .frame(width: 72, height: 72)
                Image(systemName: "flame.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
                    .accessibilityHidden(true)
            }
            VStack(spacing: DSSpacing.xxs) {
                Text("streaks.empty.title")
                    .font(DSType.sectionTitle)
                    .foregroundStyle(DSColor.textPrimary)
                Text("streaks.empty.message")
                    .font(DSType.body)
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .padding(.horizontal, DSSpacing.xs)
            }
        }
        .padding(DSSpacing.lg)
        .frame(maxWidth: .infinity)
        .dsSurfaceCard(radius: 18)
        .accessibilityElement(children: .combine)
    }

    // MARK: - KPI strip

    private func kpiStrip(_ resp: StreaksResponse) -> some View {
        HStack(spacing: DSSpacing.sm) {
            kpi(
                titleKey: "streaks.kpi.current",
                value: "\(resp.current_streak_weeks)",
                unitKey: "streaks.kpi.weeks",
                icon: "flame.fill",
                accent: resp.current_streak_weeks > 0 ? DSColor.accent : DSColor.textTertiary,
            )
            kpi(
                titleKey: "streaks.kpi.longest",
                value: "\(resp.longest_streak_weeks)",
                unitKey: "streaks.kpi.weeks",
                icon: "trophy.fill",
                accent: DSColor.accent,
            )
        }
    }

    private func kpi(
        titleKey: LocalizedStringKey,
        value: String,
        unitKey: LocalizedStringKey,
        icon: String,
        accent: Color,
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(accent)
                Text(titleKey)
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textSecondary)
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value)
                    .font(DSType.statValue)
                    .foregroundStyle(DSColor.textPrimary)
                Text(unitKey)
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textTertiary)
            }
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface),
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1),
        )
        .accessibilityElement(children: .combine)
    }

    // MARK: - Heatmap

    private func heatmapCard(_ resp: StreaksResponse) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text("streaks.heatmap.title")
                    .font(DSType.sectionTitle)
                    .foregroundStyle(DSColor.textPrimary)
                Text("streaks.heatmap.subtitle")
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textSecondary)
            }

            StreaksHeatmap(
                weeks: resp.weeks,
                cellSize: 20,
                cellSpacing: 4,
                onTap: { week in
                    // Toggle off when the same cell is tapped twice.
                    if selectedWeek?.week_start == week.week_start {
                        selectedWeek = nil
                    } else {
                        selectedWeek = week
                    }
                },
                selected: selectedWeek,
            )
            .padding(.vertical, DSSpacing.xs)

            if let selectedWeek {
                tooltip(for: selectedWeek)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale))
            } else {
                Text("streaks.heatmap.tap_hint")
                    .font(DSType.metaCaption)
                    .foregroundStyle(DSColor.textTertiary)
            }
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface),
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1),
        )
        .animation(
            reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.85),
            value: selectedWeek,
        )
    }

    /// Inline tooltip — the week label + a games count summary. We render
    /// inside the card rather than as a floating bubble so the layout
    /// doesn't jump when the user toggles between cells.
    private func tooltip(for week: StreaksWeek) -> some View {
        HStack(spacing: DSSpacing.xs) {
            Image(systemName: week.games_count > 0 ? "calendar.badge.checkmark" : "calendar")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(week.games_count > 0 ? DSColor.accent : DSColor.textTertiary)
            VStack(alignment: .leading, spacing: 1) {
                Text(weekRangeLabel(week.week_start))
                    .font(DSType.metaCaption)
                    .foregroundStyle(DSColor.textPrimary)
                Text(String(format: String(localized: "streaks.heatmap.games_count_format"),
                            week.games_count))
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textSecondary)
            }
            Spacer()
        }
        .padding(DSSpacing.xs)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(DSColor.background.opacity(0.6)),
        )
    }

    // MARK: - Legend

    private var legendCard: some View {
        HStack(spacing: DSSpacing.sm) {
            Text("streaks.legend.less")
                .font(DSType.metaCaption)
                .foregroundStyle(DSColor.textTertiary)
            ForEach([0, 1, 2, 3, 4], id: \.self) { tier in
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(legendFill(tier))
                    .frame(width: 14, height: 14)
                    .overlay(
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .strokeBorder(DSColor.border.opacity(0.3), lineWidth: 0.5),
                    )
                    .accessibilityHidden(true)
            }
            Text("streaks.legend.more")
                .font(DSType.metaCaption)
                .foregroundStyle(DSColor.textTertiary)
            Spacer()
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DSColor.surface),
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1),
        )
    }

    private func legendFill(_ tier: Int) -> Color {
        switch tier {
        case 0:  return DSColor.border.opacity(0.35)
        case 1:  return DSColor.accent.opacity(0.35)
        case 2:  return DSColor.accent.opacity(0.55)
        case 3:  return DSColor.accent.opacity(0.75)
        default: return DSColor.accent
        }
    }

    // MARK: - Helpers

    /// Format a Monday `YYYY-MM-DD` date as `MMM d` for the tooltip. Falls
    /// back to the raw string if parsing fails.
    private func weekRangeLabel(_ ymd: String) -> String {
        let inFmt = DateFormatter()
        inFmt.locale = Locale(identifier: "en_US_POSIX")
        inFmt.timeZone = TimeZone(identifier: "UTC")
        inFmt.dateFormat = "yyyy-MM-dd"
        guard let start = inFmt.date(from: ymd) else { return ymd }
        let end = start.addingTimeInterval(6 * 24 * 60 * 60)

        let outFmt = DateFormatter()
        outFmt.locale = appLocale
        outFmt.timeZone = TimeZone.current
        outFmt.setLocalizedDateFormatFromTemplate("MMMd")
        return "\(outFmt.string(from: start)) – \(outFmt.string(from: end))"
    }

    /// Locale that follows the in-app language override (az/en/ru) rather
    /// than the device locale, so month names in the tooltip match the rest
    /// of the UI's language. Falls back to the device locale if no override
    /// has been stored yet.
    private var appLocale: Locale {
        if let raw = UserDefaults.standard.string(forKey: LanguageManager.storageKey),
           let lang = AppLanguage(rawValue: raw) {
            return lang.locale
        }
        return Locale.current
    }
}
