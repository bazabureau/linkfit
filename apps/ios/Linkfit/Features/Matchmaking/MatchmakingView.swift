import SwiftUI

/// "For You" matchmaking — two horizontal carousels stacked vertically:
///   1. Best games for you
///   2. Best players for you
///
/// Each card surfaces a short `reasons` chip strip (lime accents) so the
/// scoring is explainable at a glance. Tap callbacks bubble up to the
/// host so this view stays navigation-agnostic — the Home shell decides
/// where a tap goes.
struct MatchmakingView: View {
    @State var viewModel: MatchmakingViewModel
    /// Tapped a game card. The host decides where to route — typically
    /// `HomeRoute.game(id)`.
    var onTapGame: (RecommendedGame) -> Void = { _ in }
    /// Tapped a player card. The host decides where to route — typically
    /// `HomeRoute.profile(id)`.
    var onTapPlayer: (RecommendedPlayer) -> Void = { _ in }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.lg) {
                gamesSection
                playersSection
                Spacer().frame(height: DSSpacing.xl)
            }
            .padding(.top, DSSpacing.sm)
        }
        .background(DSColor.background)
        .refreshable { await viewModel.refresh() }
        .task { await viewModel.load() }
    }

    // MARK: - Games lane

    @ViewBuilder
    private var gamesSection: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            sectionHeader(titleKey: "matchmaking.games.title",
                          subtitleKey: "matchmaking.games.subtitle")
            switch viewModel.games {
            case .idle, .loading:
                horizontalSkeleton()
            case .empty:
                emptyChip(messageKey: "matchmaking.games.empty")
            case .error(let m):
                inlineError(message: m)
            case .loaded(let items):
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: DSSpacing.sm) {
                        ForEach(items) { g in
                            Button { onTapGame(g) } label: { gameCard(g) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, DSSpacing.md)
                }
            }
        }
    }

    private func gameCard(_ g: RecommendedGame) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            HStack(alignment: .top, spacing: DSSpacing.xs) {
                Text(verbatim: sportLabel(g.sport_slug))
                    .font(.system(.caption2, design: .default, weight: .heavy))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(DSColor.accentMuted)
                    .foregroundStyle(DSColor.accent)
                    .clipShape(Capsule())
                Spacer()
                scoreBadge(g.score)
            }
            Text(verbatim: g.venue_name ?? String(localized: "matchmaking.card.no_venue"))
                .font(.system(.subheadline, design: .default, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
                .lineLimit(1)
            Text(formatStart(g.starts_at))
                .font(.system(.caption, design: .default))
                .foregroundStyle(DSColor.textSecondary)
                .lineLimit(1)
            Text(String(format: String(localized: "matchmaking.card.host_format"),
                        g.host_display_name))
                .font(.system(.caption2, design: .default))
                .foregroundStyle(DSColor.textTertiary)
                .lineLimit(1)

            reasonsChips(g.reasons)
                .padding(.top, DSSpacing.xxs)
        }
        .padding(DSSpacing.md)
        .frame(width: 240, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface),
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1),
        )
    }

    // MARK: - Players lane

    @ViewBuilder
    private var playersSection: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            sectionHeader(titleKey: "matchmaking.players.title",
                          subtitleKey: "matchmaking.players.subtitle")
            switch viewModel.players {
            case .idle, .loading:
                horizontalSkeleton()
            case .empty:
                emptyChip(messageKey: "matchmaking.players.empty")
            case .error(let m):
                inlineError(message: m)
            case .loaded(let items):
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: DSSpacing.sm) {
                        ForEach(items) { p in
                            Button { onTapPlayer(p) } label: { playerCard(p) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, DSSpacing.md)
                }
            }
        }
    }

    private func playerCard(_ p: RecommendedPlayer) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            HStack(alignment: .center, spacing: DSSpacing.xs) {
                ZStack {
                    Circle().fill(DSColor.accent.opacity(0.16))
                        .frame(width: 44, height: 44)
                    Text(initials(p.display_name))
                        .font(.system(size: 14, weight: .heavy, design: .default))
                        .foregroundStyle(DSColor.accent)
                }
                Spacer()
                scoreBadge(p.score)
            }
            Text(verbatim: p.display_name)
                .font(.system(.subheadline, design: .default, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
                .lineLimit(1)
            if p.elo_rating != nil {
                // Word-based skill replaces "ELO 1450" — matches the
                // app-wide convention. `matchmaking.card.elo_format`
                // localization key kept for back-compat but no longer
                // referenced from here.
                let level = SkillLevel.from(elo: p.elo_rating)
                Text(level.labelKey)
                    .font(.system(.caption, design: .default, weight: .semibold))
                    .foregroundStyle(level.accent)
                    .lineLimit(1)
            } else {
                Text("matchmaking.card.new_player")
                    .font(.system(.caption, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
            }

            reasonsChips(p.reasons)
                .padding(.top, DSSpacing.xxs)
        }
        .padding(DSSpacing.md)
        .frame(width: 200, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface),
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1),
        )
    }

    // MARK: - Shared chrome

    private func sectionHeader(
        titleKey: LocalizedStringKey,
        subtitleKey: LocalizedStringKey,
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(titleKey)
                .font(.system(.title3, design: .default, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
            Text(subtitleKey)
                .font(.system(.caption, design: .default))
                .foregroundStyle(DSColor.textSecondary)
        }
        .padding(.horizontal, DSSpacing.md)
    }

    private func scoreBadge(_ score: Double) -> some View {
        // Score is 0..1 — render as a 0..100 number that's easier to grok.
        let pct = Int((score * 100).rounded())
        return Text("\(pct)")
            .font(.system(.caption2, design: .default, weight: .heavy))
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .background(DSColor.accentMuted)
            .foregroundStyle(DSColor.accent)
            .clipShape(Capsule())
            .accessibilityLabel(String(format: String(localized: "matchmaking.score.voice_format"), pct))
    }

    /// Flow layout simulation — SwiftUI doesn't ship one before iOS 16, but
    /// the cards are width-bound so we wrap with two HStacks max. Keeps
    /// the chip strip readable without truncation.
    private func reasonsChips(_ reasons: [String]) -> some View {
        // Limit to 3 visible chips so cards don't stretch unpredictably.
        let visible = Array(reasons.prefix(3))
        return VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(visible.enumerated()), id: \.offset) { _, reason in
                Text(verbatim: reason)
                    .font(.system(.caption2, design: .default, weight: .semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(DSColor.accent.opacity(0.18))
                    .foregroundStyle(DSColor.accent)
                    .clipShape(Capsule())
                    .lineLimit(1)
            }
        }
    }

    private func horizontalSkeleton() -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DSSpacing.sm) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(DSColor.surface)
                        .frame(width: 220, height: 140)
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .strokeBorder(DSColor.border, lineWidth: 1),
                        )
                        .opacity(0.6)
                }
            }
            .padding(.horizontal, DSSpacing.md)
        }
    }

    private func emptyChip(messageKey: LocalizedStringKey) -> some View {
        Text(messageKey)
            .font(.system(.subheadline, design: .default))
            .foregroundStyle(DSColor.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, DSSpacing.md)
    }

    private func inlineError(message: String) -> some View {
        HStack(spacing: DSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(DSColor.warning)
            Text(verbatim: message)
                .font(.system(.caption, design: .default))
                .foregroundStyle(DSColor.textSecondary)
                .lineLimit(2)
        }
        .padding(.horizontal, DSSpacing.md)
    }

    // MARK: - Helpers

    private func sportLabel(_ slug: String) -> String {
        switch slug {
        case "padel":      return String(localized: "profile.sport.padel")
        case "football_5": return String(localized: "profile.sport.football_5")
        default:           return slug.capitalized
        }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        let joined = parts.joined()
        return joined.isEmpty ? "?" : joined
    }

    private func formatStart(_ iso: String) -> String {
        let inFmt = ISO8601DateFormatter()
        inFmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = inFmt.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return iso }
        let out = DateFormatter()
        out.locale = Locale.current
        out.dateStyle = .medium
        out.timeStyle = .short
        return out.string(from: date)
    }
}
