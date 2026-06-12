import SwiftUI

/// Full-screen grid of every badge the player can unlock. Locked badges are
/// rendered in a desaturated state with the same silhouette as their
/// unlocked counterpart so the grid reads as one motif.
///
/// Tapping a badge opens `AchievementDetailSheet` which shows the full
/// description, lock state, and (for locked items) a "How to unlock"
/// section with a progress bar driven by the server's `progress` payload.
struct AchievementsView: View {
    @State var viewModel: AchievementsViewModel
    @State private var selected: Achievement?

    private let columns: [GridItem] = Array(
        repeating: GridItem(.flexible(), spacing: DSSpacing.md),
        count: 3
    )

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            content
                .refreshable { await viewModel.load() }
        }
        .navigationTitle(String(localized: "achievements.title"))
        .navigationBarTitleDisplayMode(.large)
        .task { await viewModel.onAppear() }
        .sheet(item: $selected) { item in
            AchievementDetailSheet(achievement: item)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Content states

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(label: String(localized: "achievements.loading"))
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
        case .loaded(let res):
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.lg) {
                    summary(res)
                    grid(res)
                    Spacer().frame(height: 120)
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.md)
            }
        }
    }

    /// Premium-glass empty card matching the design-system pattern used
    /// across Messages / Insights / Calendar — medallion + heading +
    /// supporting line. No CTA, the user lands here automatically as soon
    /// as they have something to unlock.
    private var premiumEmptyCard: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.16))
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.4), lineWidth: 1)
                    .frame(width: 72, height: 72)
                Image(systemName: "rosette")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(spacing: 4) {
                Text("achievements.empty.title")
                    .font(.system(size: 17, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                Text("achievements.empty.message")
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .padding(.horizontal, 8)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
        )
    }

    private func summary(_ res: AchievementsResponse) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text(String(localized: "achievements.summary.title"))
                .font(DSType.sectionTitle)
                .foregroundStyle(DSColor.textPrimary)
            Text(
                String.localizedStringWithFormat(
                    String(localized: "achievements.summary.count_format"),
                    res.unlocked_count, res.total_count
                )
            )
            .font(.system(.subheadline, design: .default))
            .foregroundStyle(DSColor.textSecondary)
            ProgressView(value: Double(res.unlocked_count),
                         total: max(Double(res.total_count), 1))
                .tint(DSColor.accent)
                .padding(.top, 4)
        }
        .padding(DSSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.lg)
                .fill(DSColor.surface)
        )
    }

    private func grid(_ res: AchievementsResponse) -> some View {
        LazyVGrid(columns: columns, spacing: DSSpacing.lg) {
            ForEach(res.items) { item in
                Button {
                    Haptics.soft()
                    selected = item
                } label: {
                    cell(item)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func cell(_ item: Achievement) -> some View {
        VStack(spacing: 8) {
            BadgeBubble(iconName: item.icon_name, unlocked: item.unlocked)
            Text(item.name)
                .font(DSType.metaCaption)
                .foregroundStyle(item.unlocked ? DSColor.textPrimary : DSColor.textTertiary)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Detail sheet

/// Per-badge sheet. For unlocked badges we show the description; for locked
/// ones we add a "How to unlock" section with the progress bar derived from
/// the server's `progress` triple.
struct AchievementDetailSheet: View {
    let achievement: Achievement

    var body: some View {
        ScrollView {
            VStack(spacing: DSSpacing.lg) {
                BadgeBubble(iconName: achievement.icon_name,
                            unlocked: achievement.unlocked,
                            size: 120)
                    .padding(.top, DSSpacing.lg)
                VStack(spacing: DSSpacing.xs) {
                    Text(achievement.name)
                        .font(.system(.title2, design: .default, weight: .bold))
                        .foregroundStyle(DSColor.textPrimary)
                    Text(statusLabel)
                        .font(.system(.subheadline, design: .default, weight: .semibold))
                        .foregroundStyle(achievement.unlocked ? DSColor.accent : DSColor.textTertiary)
                }
                Text(achievement.description)
                    .font(DSType.body)
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DSSpacing.lg)

                if !achievement.unlocked, let progress = achievement.progress {
                    progressCard(progress)
                        .padding(.horizontal, DSSpacing.md)
                }
                Spacer().frame(height: DSSpacing.lg)
            }
            .frame(maxWidth: .infinity)
        }
        .background(DSColor.background)
    }

    private var statusLabel: String {
        if achievement.unlocked {
            return String(localized: "achievements.status.unlocked")
        }
        return String(localized: "achievements.status.locked")
    }

    private func progressCard(_ progress: AchievementProgress) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text(String(localized: "achievements.how_to_unlock"))
                .font(DSType.sectionTitle)
                .foregroundStyle(DSColor.textPrimary)
            HStack {
                Text(formatProgressLabel(progress))
                    .font(.system(.subheadline, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                Spacer()
                Text("\(Int(progress.ratio * 100))%")
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
            }
            ProgressView(value: progress.ratio).tint(DSColor.accent)
        }
        .padding(DSSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.lg)
                .fill(DSColor.surface)
        )
    }

    private func formatProgressLabel(_ p: AchievementProgress) -> String {
        let format: String
        switch p.unit {
        case "games":   format = String(localized: "achievements.progress.games_format")
        case "elo":     format = String(localized: "achievements.progress.elo_format")
        case "wins":    format = String(localized: "achievements.progress.wins_format")
        case "percent": format = String(localized: "achievements.progress.percent_format")
        case "days":    format = String(localized: "achievements.progress.days_format")
        case "ratings": format = String(localized: "achievements.progress.ratings_format")
        default:        format = "%d / %d"
        }
        return String.localizedStringWithFormat(format,
                                                Int(p.current),
                                                Int(p.target))
    }
}
