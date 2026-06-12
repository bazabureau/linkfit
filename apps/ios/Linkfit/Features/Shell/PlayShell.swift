import SwiftUI

/// Discovery shell: bundles Players · Venues · Tournaments · Rankings.
/// Hero header morphs per subtab; segmented picker stays sticky below it.
struct PlayShell: View {
    enum Sub: Hashable, CaseIterable {
        case players, venues, tournaments, rankings

        var icon: String {
            switch self {
            case .players: return "person.2.fill"
            case .venues: return "building.2.fill"
            case .tournaments: return "trophy.fill"
            case .rankings: return "chart.bar.fill"
            }
        }
        var titleKey: LocalizedStringKey {
            switch self {
            case .players: return "play.sub.players"
            case .venues: return "play.sub.venues"
            case .tournaments: return "play.sub.tournaments"
            case .rankings: return "play.sub.rankings"
            }
        }
        var heroTitleKey: LocalizedStringKey {
            switch self {
            case .players: return "play.hero.players"
            case .venues: return "play.hero.venues"
            case .tournaments: return "play.hero.tournaments"
            case .rankings: return "play.hero.rankings"
            }
        }
        var heroSubtitleKey: LocalizedStringKey {
            switch self {
            case .players: return "play.hero.players.sub"
            case .venues: return "play.hero.venues.sub"
            case .tournaments: return "play.hero.tournaments.sub"
            case .rankings: return "play.hero.rankings.sub"
            }
        }
    }

    @State private var sub: Sub = .players
    let onPickPlayer: (PlayerSummary) -> Void
    let onPickPlayerProfile: (String) -> Void
    let apiClient: APIClient

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            VStack(spacing: 0) {
                hero
                picker
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.top, DSSpacing.sm)
                content
            }
        }
    }

    // MARK: - Hero
    // Anchor content to the bottom; let the gradient background extend up
    // beneath the safe area via `.background(...).ignoresSafeArea(edges: .top)`.
    // No GeometryReader, no manual top-inset math.

    private var hero: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Spacer(minLength: 0)
            // FAZA 45 §13.1: hero is 28pt heavy default design, no mixing rounded + default.
            Text(sub.heroTitleKey)
                .font(DSType.heroTitle)
                .foregroundStyle(DSColor.textOnAccent)
                .lineSpacing(1)
                .fixedSize(horizontal: false, vertical: true)
            Text(sub.heroSubtitleKey)
                .font(DSType.bodyMedium)
                .foregroundStyle(DSColor.textOnAccent.opacity(0.78))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            Spacer().frame(height: DSSpacing.md)
        }
        .padding(.horizontal, DSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 140)
        .background(
            LinearGradient(
                colors: [
                    DSColor.success,
                    DSColor.success.opacity(0.85),
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            .ignoresSafeArea(edges: .top)
        )
        .overlay(alignment: .topTrailing) {
            Image(systemName: sub.icon)
                .font(.system(size: 90, weight: .bold))
                .foregroundStyle(DSColor.textOnAccent.opacity(0.12))
                .rotationEffect(.degrees(-10))
                .offset(x: 30, y: 10)
                .allowsHitTesting(false)
        }
    }

    // MARK: - Picker

    private var picker: some View {
        let segments: [(value: Sub, label: String, systemImage: String?)] =
            Sub.allCases.map { s in
                let key: String.LocalizationValue
                switch s {
                case .players:     key = "play.sub.players"
                case .venues:      key = "play.sub.venues"
                case .tournaments: key = "play.sub.tournaments"
                case .rankings:    key = "play.sub.rankings"
                }
                return (s, String(localized: key), Optional(s.icon))
            }
        return SegmentedPicker(segments: segments, selection: $sub)
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        Group {
            switch sub {
            case .players:
                PlayersView(viewModel: PlayersViewModel(apiClient: apiClient),
                            onPickPlayer: onPickPlayer)
            case .venues:
                VenuesView(viewModel: VenuesViewModel(apiClient: apiClient))
            case .tournaments:
                TournamentsView(viewModel: TournamentsViewModel(apiClient: apiClient))
            case .rankings:
                RankingsView(viewModel: RankingsViewModel(apiClient: apiClient),
                             onPickPlayer: onPickPlayerProfile)
            }
        }
        .transition(.opacity)
    }
}
