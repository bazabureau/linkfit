import SwiftUI

/// Competitions hub ("Yarışlar"). Local header + format rail (Americano /
/// Turnir / Liqa) + featured hero + status-driven sections (Canlı /
/// Qeydiyyat / Nəticələr) in one scroll. The header is kept inside the
/// content instead of using a large navigation title because iOS 26 can
/// reserve oversized large-title space when the tab bar owns the root stack.
struct TournamentsView: View {
    var viewModel: TournamentsViewModel
    @Environment(AppContainer.self) private var container
    @State private var showAmericano = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header

                CompetitionFormatRail(onAmericano: {
                    Haptics.selection()
                    showAmericano = true
                })

                content

                Spacer().frame(height: 100)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.top, DSSpacing.md)
        }
        .background(DSColor.background.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
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

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("tournaments.title")
                .font(.system(size: 34, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.82)

            Text("tournaments.subtitle")
                .font(DSType.bodyMedium)
                .foregroundStyle(DSColor.textSecondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
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
        VStack(spacing: DSSpacing.md) {
            RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous)
                .fill(DSColor.surfaceElevated)
                .frame(height: 180)
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                    .fill(DSColor.surfaceElevated)
                    .frame(height: 96)
            }
        }
        .redacted(reason: .placeholder)
        .accessibilityHidden(true)
    }

    private var emptyState: some View {
        VStack(spacing: DSSpacing.sm) {
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
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(SpringPressStyle())
            .padding(.top, DSSpacing.xxs)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, DSSpacing.xxl)
        .padding(.horizontal, DSSpacing.lg)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: DSSpacing.sm) {
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
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(SpringPressStyle())
        }
        .frame(maxWidth: .infinity)
        .padding(.top, DSSpacing.xxl)
        .padding(.horizontal, DSSpacing.lg)
    }
}

enum TournamentRoute: Hashable {
    case detail(String)
}
