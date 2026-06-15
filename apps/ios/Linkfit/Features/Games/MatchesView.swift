import SwiftUI

/// Games hub ("Oyunlar"). Rebuilt from scratch as a Play destination centred
/// on the social hook — finding & joining open games — with your own games
/// below. Replaces the old "search + Period/Role/Result filter + list".
struct MatchesView: View {
    @State var viewModel: MatchesViewModel
    var onTapGame: (GameSummary) -> Void
    var onTapCreate: () -> Void

    @Environment(AppContainer.self) private var container
    @State private var showRecurring = false
    @State private var showAmericano = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                GameFilterChips(selection: viewModel.dateFilter) { value in
                    viewModel.setDateFilter(value)
                }
                content
                Spacer().frame(height: 100)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.top, DSSpacing.xs)
        }
        .background(DSColor.background.ignoresSafeArea())
        .navigationTitle("games.nav.title")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await viewModel.load() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        onTapCreate()
                    } label: {
                        Label("matches.create", systemImage: "figure.tennis")
                    }
                    Button {
                        Haptics.selection()
                        showRecurring = true
                    } label: {
                        Label("recurring.title", systemImage: "repeat")
                    }
                    Button {
                        Haptics.selection()
                        showAmericano = true
                    } label: {
                        Label("americano.hero.title", systemImage: "trophy")
                    }
                } label: {
                    Image(systemName: "plus").fontWeight(.semibold)
                }
                .accessibilityLabel(Text("matches.create"))
            }
        }
        .task {
            if let me = container.currentUser, let lat = me.home_lat, let lng = me.home_lng {
                viewModel.viewerHome = .init(latitude: lat, longitude: lng)
            }
            await viewModel.onAppear()
        }
        .sheet(isPresented: $showRecurring) {
            RecurringGameSheet(
                viewModel: RecurringGameViewModel(apiClient: container.apiClient)
            ) { _ in Task { await viewModel.load() } }
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
        case .loaded(let hub):
            loadedContent(hub)
        }
    }

    @ViewBuilder
    private func loadedContent(_ hub: GamesHub) -> some View {
        if !hub.openGames.isEmpty {
            section(titleKey: "games.section.open") {
                ForEach(Array(hub.openGames.enumerated()), id: \.element.id) { index, game in
                    Button { onTapGame(game) } label: { OpenGameCard(game: game) }
                        .buttonStyle(SpringPressStyle())
                        .appearStagger(index)
                }
            }
        }
        if !hub.myGames.isEmpty {
            section(titleKey: "games.section.mine") {
                ForEach(Array(hub.myGames.enumerated()), id: \.element.id) { index, game in
                    Button { onTapGame(game) } label: { MyGameRow(game: game) }
                        .buttonStyle(SpringPressStyle())
                        .appearStagger(index)
                }
            }
        }
        // Open list can be empty under a date filter while my-games isn't.
        if hub.openGames.isEmpty && !hub.myGames.isEmpty {
            filteredOpenEmpty
        }
    }

    @ViewBuilder
    private func section<Content: View>(titleKey: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(titleKey).font(DSType.sectionTitle).foregroundStyle(DSColor.textPrimary)
            content()
        }
    }

    // MARK: - States

    private var loadingSkeleton: some View {
        VStack(spacing: 14) {
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(DSColor.surfaceElevated)
                    .frame(height: 150)
            }
        }
        .redacted(reason: .placeholder)
        .accessibilityHidden(true)
    }

    private var filteredOpenEmpty: some View {
        Text("matches.empty.title")
            .font(DSType.bodyMedium)
            .foregroundStyle(DSColor.textTertiary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(DSColor.accentMuted).frame(width: 64, height: 64)
                Image(systemName: "figure.tennis")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            Text("matches.empty.title").font(DSType.sectionTitle).foregroundStyle(DSColor.textPrimary)
            Text("matches.empty.message")
                .font(DSType.bodyMedium).foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
            Button {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                onTapCreate()
            } label: {
                Text("matches.empty.create_cta").font(DSType.button).foregroundStyle(DSColor.textOnAccent)
                    .padding(.horizontal, 22).padding(.vertical, 11)
                    .background(Capsule().fill(DSColor.accent))
            }
            .buttonStyle(SpringPressStyle())
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
        .padding(.horizontal, 24)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(DSColor.danger)
            Text(message)
                .font(DSType.bodyMedium).foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
            Button { Task { await viewModel.load() } } label: {
                Text("tournaments.empty.refresh").font(DSType.bodyStrong).foregroundStyle(DSColor.accent)
            }
            .buttonStyle(SpringPressStyle())
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 48)
        .padding(.horizontal, 24)
    }
}
