import SwiftUI

@Observable
@MainActor
final class RankingsViewModel {
    private(set) var state: ViewState<RankingsResponse> = .idle
    var sportSlug: String = "padel"

    private let apiClient: APIClient
    init(apiClient: APIClient) { self.apiClient = apiClient }

    func onAppear() async { await load() }
    func setSport(_ slug: String) async {
        sportSlug = (slug == "football_5" || slug == "football") ? "padel" : slug
        await load()
    }

    func load() async {
        if case .loaded = state {} else { state = .loading }
        do {
            let res = try await apiClient.send(.rankings(sport: sportSlug))
            state = res.items.isEmpty ? .empty : .loaded(res)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.errorDescription ?? String(localized: "rankings.error.load"))
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }
}

struct RankingsView: View {
    @State var viewModel: RankingsViewModel
    var onPickPlayer: (String) -> Void

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.md) {
                    // hero provided by parent shell
                    sportChips
                    content
                    Spacer().frame(height: 120)
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.lg)
            }
            .refreshable { await viewModel.load() }
        }
        .task { await viewModel.onAppear() }
    }

    private var sportChips: some View {
        HStack(spacing: DSSpacing.xs) {
            chip(label: String(localized: "rankings.sport.padel"), slug: "padel")
            Spacer()
        }
    }

    private func chip(label: String, slug: String) -> some View {
        let selected = viewModel.sportSlug == slug
        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
            Task { await viewModel.setSport(slug) }
        } label: {
            Text(label)
                .font(.system(.footnote, design: .default, weight: .semibold))
                .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
                .padding(.horizontal, DSSpacing.md)
                .padding(.vertical, 8)
                .background(Capsule().fill(selected ? DSColor.accent : DSColor.surface))
                .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: selected ? 0 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(label: String(localized: "rankings.loading")).frame(height: 220)
        case .loaded(let res):
            LazyVStack(spacing: DSSpacing.xs) {
                ForEach(res.items) { item in
                    Button { onPickPlayer(item.user_id) } label: {
                        RankRow(item: item)
                    }
                    .buttonStyle(.plain)
                }
            }
        case .empty:
            EmptyStateView(
                icon: "trophy",
                title: String(localized: "rankings.empty.title"),
                message: String(localized: "rankings.empty.message")
            )
            .frame(height: 280)
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
                .frame(height: 280)
        }
    }
}

private struct RankRow: View {
    let item: RankingItem

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            rankBadge
            ZStack {
                Circle().fill(LinearGradient(
                    colors: [DSColor.accent, DSColor.accentSoft],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )).frame(width: 40, height: 40)
                Text(initials(item.display_name))
                    .font(.system(.caption, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.textOnAccent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(item.display_name)
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                Text(String(format: String(localized: "rankings.games_wins_format"), item.games_played, item.games_won))
                    .font(.system(.caption, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
            }
            Spacer()
            // Word-based skill bucket replaces the raw ELO integer
            // — matches the convention now used across the app. Rank
            // number on the left preserves precise ordering for power
            // users. The redundant static "skill" caption was dropped:
            // the level word already names itself, so the second line
            // only added visual noise.
            VStack(alignment: .trailing, spacing: 2) {
                Text(SkillLevel.from(elo: item.elo_rating).labelKey)
                    .font(.system(.subheadline, design: .default, weight: .heavy))
                    .foregroundStyle(SkillLevel.from(elo: item.elo_rating).accent)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(item.rank <= 3 ? DSColor.accent.opacity(0.6) : DSColor.border, lineWidth: 1)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(.isButton)
    }

    /// Composed from a positional, localized format so screen readers get a
    /// coherent sentence in the user's language rather than disjoint labels.
    /// Order: name, rank, skill, games, wins. Mirrors `LeaderboardRow`.
    private var accessibilityLabel: String {
        String(
            format: String(localized: "rankings.row.a11y_format"),
            item.display_name,
            item.rank,
            SkillLevel.from(elo: item.elo_rating).localizedName,
            item.games_played,
            item.games_won
        )
    }

    private var rankBadge: some View {
        // Podium colors use the adaptive medal tokens (gold/silver/bronze)
        // so the medal reads consistently in light & dark mode.
        let (bg, fg): (Color, Color) = {
            switch item.rank {
            case 1: return (DSColor.medalGold.opacity(0.18), DSColor.medalGold)
            case 2: return (DSColor.medalSilver.opacity(0.22), DSColor.medalSilver)
            case 3: return (DSColor.medalBronze.opacity(0.20), DSColor.medalBronze)
            default: return (DSColor.surfaceElevated, DSColor.textSecondary)
            }
        }()
        return Text("\(item.rank)")
            .font(.system(.subheadline, design: .default, weight: .heavy))
            .foregroundStyle(fg)
            .frame(width: 36, height: 36)
            .background(Circle().fill(bg))
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "?" : parts.joined()
    }
}
