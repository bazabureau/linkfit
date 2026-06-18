import SwiftUI

/// Global Search screen. Reachable from the magnifying-glass entry on Home;
/// see the doc comment on `SearchView` for the integration contract.
///
/// ## Wiring (for hosting screens)
/// The screen is fully callback-driven: it never pushes onto another
/// navigation stack itself. The owning screen (Home / Discover / Profile
/// shells) is responsible for handling taps by appending to its own
/// `NavigationPath`:
///
/// ```swift
/// SearchView(
///     viewModel: SearchViewModel(apiClient: container.apiClient),
///     onPickPlayer:    { p in path.append(HomeRoute.profile(p.id)) },
///     onPickGame:      { g in path.append(HomeRoute.game(g.id)) },
///     onPickTournament:{ t in /* route to tournaments tab/detail */ },
///     onPickVenue:     { v in /* route to venue detail */ }
/// )
/// ```
///
/// To reach the screen from Home, push a new `HomeRoute.search` case (a
/// separate change owned by the Home agent) and resolve it to a
/// `SearchView` instance. This file intentionally does NOT modify Home.
struct SearchView: View {
    @State var viewModel: SearchViewModel
    var onPickPlayer: (SearchPlayerResult) -> Void
    var onPickGame: (SearchGameResult) -> Void
    var onPickTournament: (SearchTournamentResult) -> Void
    var onPickVenue: (SearchVenueResult) -> Void

    /// Section the user is "drilled into" via Show all. `nil` means the
    /// unified overview is on screen. Driven as a `NavigationDestination`
    /// so the back arrow works without the caller having to wire it up.
    @State private var seeAllType: SearchResultType?

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: DSSpacing.md) {
                        SearchField(
                            text: Binding(
                                get: { viewModel.query },
                                set: { viewModel.setQuery($0) }
                            ),
                            placeholderKey: "search.placeholder",
                            autofocus: true
                        )

                        typePicker

                        content
                        Spacer().frame(height: 120)
                    }
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.top, DSSpacing.md)
                }
                .refreshable {
                    // Re-run the active query. With an empty query the VM
                    // short-circuits to `.idle` without hitting the server,
                    // which still feels right as a "reset" gesture.
                    viewModel.runQueryImmediately(viewModel.query)
                    // Brief yield so the refresh spinner doesn't snap shut
                    // before the fanned-out fetch begins streaming.
                    try? await Task.sleep(nanoseconds: 250_000_000)
                }
            }
            .navigationTitle(Text("search.title"))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(item: $seeAllType) { type in
                SearchSectionListView(
                    type: type,
                    viewModel: viewModel,
                    onPickPlayer: onPickPlayer,
                    onPickGame: onPickGame,
                    onPickTournament: onPickTournament,
                    onPickVenue: onPickVenue
                )
            }
        }
    }

    // MARK: - Type picker

    private var typePicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(titleKey: "search.filter.all", icon: "square.grid.2x2.fill", type: nil)
                ForEach(SearchResultType.allCases) { t in
                    chip(titleKey: titleKey(for: t), icon: searchTabIcon(for: t), type: t)
                }
            }
            .padding(.horizontal, 2)
            .padding(.vertical, 4)
        }
    }

    private func searchTabIcon(for type: SearchResultType) -> String {
        switch type {
        case .players:     return "person.fill"
        case .games:       return "sportscourt.fill"
        case .tournaments: return "trophy.fill"
        case .venues:      return "building.2.fill"
        }
    }

    private func chip(titleKey: LocalizedStringKey, icon: String, type: SearchResultType?) -> some View {
        let selected = viewModel.typeFilter == type
        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
            withAnimation(.snappy(duration: 0.2)) {
                viewModel.setTypeFilter(type)
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .bold))
                Text(titleKey)
                    .font(.system(size: 12, weight: .bold, design: .default))
            }
            .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                Capsule()
                    .fill(selected ? DSColor.accent : DSColor.surfaceElevated)
            )
            .overlay(
                Capsule().strokeBorder(
                    selected ? DSColor.accent : DSColor.textPrimary.opacity(0.08),
                    lineWidth: 1
                )
            )
            .shadow(color: selected ? DSColor.accent.opacity(0.18) : .clear, radius: 4)
        }
        .buttonStyle(SpringPressStyle())
    }

    private func titleKey(for type: SearchResultType) -> LocalizedStringKey {
        switch type {
        case .players:     return "search.filter.players"
        case .games:       return "search.filter.games"
        case .tournaments: return "search.filter.tournaments"
        case .venues:      return "search.filter.venues"
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle:
            idleState
        case .loading:
            LoadingView().frame(height: 200)
        case .empty:
            EmptyStateView(
                icon: "magnifyingglass.circle",
                title: String(localized: "search.empty.title"),
                message: String(localized: "search.empty.message")
            )
            .frame(height: 280)
        case .loaded(let response):
            resultSections(response)
        case .error(let m):
            ErrorStateView(message: m) {
                viewModel.setQuery(viewModel.query)
            }
            .frame(height: 240)
        }
    }

    // MARK: - Idle (recent searches + samples)

    @ViewBuilder
    private var idleState: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            if !viewModel.recents.isEmpty {
                HStack {
                    Text("search.recents.title")
                        .font(.system(.subheadline, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary)
                    Spacer()
                    Button("search.recents.clear") {
                        viewModel.clearRecents()
                    }
                    .font(.system(.footnote, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
                }
                FlowChips(items: viewModel.recents) { q in
                    viewModel.runQueryImmediately(q)
                }
            } else {
                discoveryHint
            }

            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                Text("search.samples.title")
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                FlowChips(items: viewModel.sampleQueries) { q in
                    viewModel.runQueryImmediately(q)
                }
            }
        }
    }

    /// Inviting hint on a fresh search (no recents) so the empty screen
    /// reads as intentional rather than blank.
    private var discoveryHint: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(DSColor.accentMuted).frame(width: 72, height: 72)
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            Text("search.discover.title")
                .font(DSType.sectionTitle)
                .foregroundStyle(DSColor.textPrimary)
                .multilineTextAlignment(.center)
            Text("search.discover.subtitle")
                .font(DSType.bodyMedium)
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 28)
        .padding(.bottom, 4)
    }

    // MARK: - Result sections

    @ViewBuilder
    private func resultSections(_ response: SearchResponse) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            if !response.players.isEmpty {
                section(
                    type: .players,
                    titleKey: "search.section.players",
                    count: response.players.count
                ) {
                    ForEach(response.players.prefix(5)) { p in
                        SearchResultRow.Player(result: p) { onPickPlayer(p) }
                    }
                }
            }
            if !response.games.isEmpty {
                section(
                    type: .games,
                    titleKey: "search.section.games",
                    count: response.games.count
                ) {
                    ForEach(response.games.prefix(5)) { g in
                        SearchResultRow.Game(result: g) { onPickGame(g) }
                    }
                }
            }
            if !response.tournaments.isEmpty {
                section(
                    type: .tournaments,
                    titleKey: "search.section.tournaments",
                    count: response.tournaments.count
                ) {
                    ForEach(response.tournaments.prefix(5)) { t in
                        SearchResultRow.Tournament(result: t) { onPickTournament(t) }
                    }
                }
            }
            if !response.venues.isEmpty {
                section(
                    type: .venues,
                    titleKey: "search.section.venues",
                    count: response.venues.count
                ) {
                    ForEach(response.venues.prefix(5)) { v in
                        SearchResultRow.Venue(result: v) { onPickVenue(v) }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func section<Content: View>(
        type: SearchResultType,
        titleKey: LocalizedStringKey,
        count: Int,
        @ViewBuilder rows: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack {
                Text(titleKey)
                    .font(.system(.headline, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                Spacer()
                if count > 5 {
                    Button {
                        seeAllType = type
                    } label: {
                        Text("search.see_all")
                            .font(.system(.footnote, design: .default, weight: .semibold))
                            .foregroundStyle(DSColor.accent)
                    }
                    .buttonStyle(.plain)
                }
            }
            LazyVStack(spacing: DSSpacing.sm) {
                rows()
            }
        }
    }
}

// MARK: - Suggestion chips

/// Horizontally wrapping chip cluster — used for the recent / sample queries
/// in the idle state. A `LazyVGrid` with adaptive sizing keeps this honest
/// without dragging in a third-party flow layout.
private struct FlowChips: View {
    let items: [String]
    let onTap: (String) -> Void

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 100), spacing: DSSpacing.xs)],
            alignment: .leading,
            spacing: DSSpacing.xs
        ) {
            ForEach(items, id: \.self) { item in
                Button {
                    onTap(item)
                } label: {
                    Text(item)
                        .font(.system(.footnote, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary)
                        .padding(.horizontal, DSSpacing.md)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(DSColor.surface))
                        .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Section drilldown

/// "See all" target — flat list of just one entity type. We rebind to the
/// same view model so the search query stays sticky as the user navigates.
struct SearchSectionListView: View {
    let type: SearchResultType
    var viewModel: SearchViewModel
    var onPickPlayer: (SearchPlayerResult) -> Void
    var onPickGame: (SearchGameResult) -> Void
    var onPickTournament: (SearchTournamentResult) -> Void
    var onPickVenue: (SearchVenueResult) -> Void

    var body: some View {
        ZStack {
            AppGlassBackground()
            ScrollView {
                LazyVStack(spacing: DSSpacing.sm) {
                    content
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.md)
            }
        }
        .navigationTitle(Text(titleKey))
        .navigationBarTitleDisplayMode(.inline)
    }

    private var titleKey: LocalizedStringKey {
        switch type {
        case .players:     return "search.section.players"
        case .games:       return "search.section.games"
        case .tournaments: return "search.section.tournaments"
        case .venues:      return "search.section.venues"
        }
    }

    @ViewBuilder
    private var content: some View {
        if case .loaded(let r) = viewModel.state {
            switch type {
            case .players:
                ForEach(r.players) { p in
                    SearchResultRow.Player(result: p) { onPickPlayer(p) }
                }
            case .games:
                ForEach(r.games) { g in
                    SearchResultRow.Game(result: g) { onPickGame(g) }
                }
            case .tournaments:
                ForEach(r.tournaments) { t in
                    SearchResultRow.Tournament(result: t) { onPickTournament(t) }
                }
            case .venues:
                ForEach(r.venues) { v in
                    SearchResultRow.Venue(result: v) { onPickVenue(v) }
                }
            }
        } else {
            EmptyStateView(
                icon: "magnifyingglass.circle",
                title: String(localized: "search.empty.title"),
                message: String(localized: "search.empty.message")
            )
            .frame(minHeight: 240)
        }
    }
}
