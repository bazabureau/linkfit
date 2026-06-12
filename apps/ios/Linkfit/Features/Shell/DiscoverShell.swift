import SwiftUI

/// Replaces the old PlayShell. Discover bundles Players + Venues +
/// Tournaments. Rankings is now its own top-level tab.
struct DiscoverShell: View {
    enum Sub: Hashable, CaseIterable {
        case players, venues, tournaments

        var icon: String {
            switch self {
            case .players:     return "person.2.fill"
            case .venues:      return "building.2.fill"
            case .tournaments: return "trophy.fill"
            }
        }
        var titleKey: LocalizedStringKey {
            switch self {
            case .players:     return "play.sub.players"
            case .venues:      return "play.sub.venues"
            case .tournaments: return "play.sub.tournaments"
            }
        }
        var heroTitleKey: LocalizedStringKey {
            switch self {
            case .players:     return "play.hero.players"
            case .venues:      return "play.hero.venues"
            case .tournaments: return "play.hero.tournaments"
            }
        }
        var heroSubtitleKey: LocalizedStringKey {
            switch self {
            case .players:     return "play.hero.players.sub"
            case .venues:      return "play.hero.venues.sub"
            case .tournaments: return "play.hero.tournaments.sub"
            }
        }
    }

    @State private var sub: Sub = .players
    let onPickPlayer: (PlayerSummary) -> Void
    let apiClient: APIClient

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            VStack(spacing: 0) {
                heroBanner
                picker
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.top, DSSpacing.sm)
                content
            }
        }
    }

    private var heroBanner: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            Spacer(minLength: 0)
            // FAZA 45 §13.1: hero is 28pt heavy default design, no mixing rounded + default.
            Text(sub.heroTitleKey)
                .font(DSType.heroTitle)
                .foregroundStyle(.white)
                .lineSpacing(1)
                .fixedSize(horizontal: false, vertical: true)
            Text(sub.heroSubtitleKey)
                .font(DSType.bodyMedium)
                .foregroundStyle(.white.opacity(0.78))
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
                    Color(red: 0.04, green: 0.32, blue: 0.20),
                    Color(red: 0.08, green: 0.55, blue: 0.32),
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            .ignoresSafeArea(edges: .top)
        )
        .overlay(alignment: .topTrailing) {
            Image(systemName: sub.icon)
                .font(.system(size: 84, weight: .bold))
                .foregroundStyle(.white.opacity(0.12))
                .rotationEffect(.degrees(-10))
                .padding(.trailing, DSSpacing.md)
                .padding(.top, DSSpacing.sm)
                .allowsHitTesting(false)
        }
    }

    private var picker: some View {
        let segments: [(value: Sub, label: String, systemImage: String?)] =
            Sub.allCases.map { s in
                let key: String.LocalizationValue
                switch s {
                case .players:     key = "play.sub.players"
                case .venues:      key = "play.sub.venues"
                case .tournaments: key = "play.sub.tournaments"
                }
                return (s, String(localized: key), Optional(s.icon))
            }
        return SegmentedPicker(segments: segments, selection: $sub)
    }

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
            }
        }
        .transition(.opacity)
    }
}
