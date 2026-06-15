import SwiftUI

/// Competitions hub ("Yarışlar"). Rebuilt from scratch as a destination —
/// native large title + format rail (Americano / Turnir / Liqa) + an
/// immersive featured hero + status-driven sections (Canlı / Qeydiyyat /
/// Nəticələr) in one scroll. Replaces the old generic
/// "PremiumPageHero + Upcoming/Live/Past segmented list".
struct TournamentsView: View {
    var viewModel: TournamentsViewModel
    @Environment(AppContainer.self) private var container
    @State private var showAmericano = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                CompetitionFormatRail(onAmericano: {
                    Haptics.selection()
                    showAmericano = true
                })

                content

                Spacer().frame(height: 100)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.top, DSSpacing.xs)
        }
        .background(DSColor.background.ignoresSafeArea())
        .navigationTitle("tournaments.title")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await viewModel.load() }
        .task { await viewModel.load() }
        .navigationDestination(for: TournamentRoute.self) { route in
            switch route {
            case .detail(let id):
                TournamentDetailView(
                    viewModel: TournamentDetailViewModel(
                        apiClient: container.apiClient,
                        tournamentId: id
                    )
                )
            }
        }
        .sheet(isPresented: $showAmericano) {
            AmericanoTournamentView()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            loadingSkeleton
        case .empty:
            emptyState
        case .error(let message):
            errorState(message)
        case .loaded(let sections):
            loadedContent(sections)
        }
    }

    @ViewBuilder
    private func loadedContent(_ sections: TournamentSections) -> some View {
        if let featured = sections.featured {
            NavigationLink(value: TournamentRoute.detail(featured.id)) {
                FeaturedTournamentHero(tournament: featured)
            }
            .buttonStyle(SpringPressStyle())
        }

        if !sections.live.isEmpty {
            CompetitionSection(titleKey: "tournaments.bucket.live") {
                ForEach(sections.live) { row($0) }
            }
        }
        if !sections.registration.isEmpty {
            CompetitionSection(titleKey: "tournaments.section.registration") {
                ForEach(sections.registration) { row($0) }
            }
        }
        if !sections.past.isEmpty {
            CompetitionSection(titleKey: "tournaments.section.results") {
                ForEach(sections.past) { row($0) }
            }
        }
    }

    private func row(_ tournament: Tournament) -> some View {
        NavigationLink(value: TournamentRoute.detail(tournament.id)) {
            CompetitionCard(tournament: tournament)
        }
        .buttonStyle(SpringPressStyle())
    }

    // MARK: - States

    private var loadingSkeleton: some View {
        VStack(spacing: 16) {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(DSColor.surfaceElevated)
                .frame(height: 180)
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(DSColor.surfaceElevated)
                    .frame(height: 96)
            }
        }
        .redacted(reason: .placeholder)
        .accessibilityHidden(true)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(DSColor.accentMuted).frame(width: 64, height: 64)
                Image(systemName: "trophy")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            Text("tournaments.empty.title")
                .font(DSType.sectionTitle)
                .foregroundStyle(DSColor.textPrimary)
            Text("tournaments.empty.message")
                .font(DSType.bodyMedium)
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
            Button { Task { await viewModel.load() } } label: {
                Text("tournaments.empty.refresh")
                    .font(DSType.bodyStrong)
                    .foregroundStyle(DSColor.accent)
            }
            .buttonStyle(SpringPressStyle())
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 48)
        .padding(.horizontal, 24)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(DSColor.danger.opacity(0.12)).frame(width: 64, height: 64)
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(DSColor.danger)
            }
            Text(message)
                .font(DSType.bodyMedium)
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
            Button { Task { await viewModel.load() } } label: {
                Text("tournaments.empty.refresh")
                    .font(DSType.bodyStrong)
                    .foregroundStyle(DSColor.accent)
            }
            .buttonStyle(SpringPressStyle())
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 48)
        .padding(.horizontal, 24)
    }
}

enum TournamentRoute: Hashable {
    case detail(String)
}
