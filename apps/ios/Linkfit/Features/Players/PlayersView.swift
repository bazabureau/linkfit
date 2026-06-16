import SwiftUI

/// Find Player — calm, list-first directory.
/// Redesigned completely from scratch in 2026-05-29 to deliver a premium,
/// high-fidelity, and fully FAZA 45-compliant discovery interface.
private enum PlayersTab: String, Hashable, CaseIterable {
    case all
    case matchmaking

    var titleKey: LocalizedStringKey {
        switch self {
        case .all:          return "players.tab.all"
        case .matchmaking:  return "players.tab.matchmaking"
        }
    }
    
    var icon: String {
        switch self {
        case .all:          return "person.3.fill"
        case .matchmaking:  return "sparkles"
        }
    }
}

struct PlayersView: View {
    @State var viewModel: PlayersViewModel
    var onPickPlayer: (PlayerSummary) -> Void

    @Environment(AppContainer.self) private var container
    @FocusState private var searchFocused: Bool
    @State private var followsSheet: FollowsListSheetPayload?

    /// Active tab. Lives on the view because the segmented control is a
    /// view-local affordance — only the matchmaking VM cares about the
    /// switch, and only via `.task(id:)` re-triggering its load.
    @State private var activeTab: PlayersTab = .all
    @Namespace private var tabNamespace

    /// Lazily-built matchmaking view-model. Constructed inside `task` once
    /// we have the container so we don't create one for users who never
    /// open the tab. `@State` keeps the same instance across tab switches.
    @State private var matchmakingVM: MatchmakingViewModel?

    /// Tracks which keyed FollowStore edges have changed since last paint.
    @State private var followStore = FollowStore.shared

    var body: some View {
        ZStack {
            AppGlassBackground()
            
            VStack(spacing: 0) {
                tabSwitcher
                
                switch activeTab {
                case .all:
                    content
                case .matchmaking:
                    matchmakingContent
                }
            }
        }
        .navigationTitle(Text("players.nav.title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if viewModel.activeFilterCount > 0 {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        Task { await viewModel.resetFilters() }
                    } label: {
                        Text("common.reset")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(DSColor.accent)
                    }
                }
            }
        }
        .task {
            // Seed both the viewer's id (drives self-filter) and the
            // location (powers nearby filter) before the first load.
            viewModel.viewerUserId = container.currentUser?.id
            if let me = container.currentUser, let lat = me.home_lat, let lng = me.home_lng {
                viewModel.viewerHome = (lat, lng)
            }
            await viewModel.onAppear()
        }
        .alert(
            Text("players.follow.error.title"),
            isPresented: Binding(
                get: { viewModel.actionError != nil },
                set: { if !$0 { viewModel.clearActionError() } }
            ),
            presenting: viewModel.actionError
        ) { _ in
            Button("common.ok", role: .cancel) { viewModel.clearActionError() }
        } message: { message in
            Text(message)
        }
        .sheet(item: $followsSheet) { payload in
            NavigationStack {
                FollowListView(
                    viewModel: FollowListViewModel(
                        apiClient: container.apiClient,
                        userId: payload.userId,
                        kind: payload.kind,
                        viewerUserId: container.currentUser?.id
                    )
                ) { tappedUserId in
                    followsSheet = nil
                    Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 250_000_000)
                        onPickPlayer(PlayerSummary.placeholder(id: tappedUserId))
                    }
                }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .presentationBackground(.ultraThinMaterial)
        }
    }

    // MARK: - Tab switcher

    /// Standardized premium Segmented Control tab switcher — "Hamısı" / "Sənə uyğun".
    private var tabSwitcher: some View {
        SegmentedPicker(
            segments: [
                (PlayersTab.all, String(localized: "players.tab.all" as String.LocalizationValue), Optional("person.3.fill")),
                (PlayersTab.matchmaking, String(localized: "players.tab.matchmaking" as String.LocalizationValue), Optional("sparkles"))
            ],
            selection: Binding(
                get: { activeTab },
                set: { tab in
                    UISelectionFeedbackGenerator().selectionChanged()
                    withAnimation(.spring(response: 0.30, dampingFraction: 0.78)) {
                        activeTab = tab
                    }
                }
            )
        )
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }

    // MARK: - Matchmaking tab

    @ViewBuilder
    private var matchmakingContent: some View {
        ScrollView {
            VStack(spacing: 24) {
                if let vm = matchmakingVM {
                    matchmakingStateView(vm: vm)
                } else {
                    matchmakingSkeleton
                }
                Spacer().frame(height: 32)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
        .scrollIndicators(.hidden)
        .refreshable {
            await matchmakingVM?.refresh()
        }
        .task(id: activeTab) {
            guard activeTab == .matchmaking else { return }
            if matchmakingVM == nil {
                matchmakingVM = MatchmakingViewModel(
                    apiClient: container.apiClient,
                    container: container,
                    mode: .forMe,
                    playersOnly: true
                )
            }
            await matchmakingVM?.load()
        }
    }

    @ViewBuilder
    private func matchmakingStateView(vm: MatchmakingViewModel) -> some View {
        switch vm.players {
        case .idle, .loading:
            matchmakingSkeleton
        case .error(let message):
            ErrorStateView(message: message) {
                Task { await vm.refresh() }
            }
        case .empty:
            matchmakingEmptyState
        case .loaded(let items):
            LazyVStack(spacing: 12) {
                ForEach(items) { player in
                    MatchmakerPlayerCard(
                        player: player,
                        onTap: { onPickPlayer(PlayerSummary.placeholder(id: player.user_id)) },
                        onFollow: { Task { await vm.toggleFollow(player) } }
                    )
                }
            }
        }
    }

    private var matchmakingEmptyState: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.06))
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(
                        LinearGradient(
                            colors: [DSColor.accent.opacity(0.2), DSColor.accent.opacity(0.02)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
                    .frame(width: 72, height: 72)
                Image(systemName: "sparkles")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(DSColor.accent)
            }
            .padding(.top, 10)
            
            VStack(spacing: 4) {
                Text("players.matchmaking.empty.title")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                Text("players.matchmaking.empty.message")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .padding(.horizontal, 12)
            }
            .padding(.bottom, 6)
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.textPrimary.opacity(0.02))
                .background(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.textPrimary.opacity(0.04), lineWidth: 1)
        )
        .padding(.top, 12)
    }

    private var matchmakingSkeleton: some View {
        VStack(spacing: 12) {
            ForEach(0..<4, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(DSColor.textPrimary.opacity(0.02))
                    .frame(height: 108)
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(DSColor.textPrimary.opacity(0.04), lineWidth: 1)
                    )
            }
        }
    }

    // MARK: - Body

    @ViewBuilder
    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                searchBar
                    .padding(.top, 6)
                filtersStrip
                SuggestedFollowsHook.makeCarousel(container: container) { userId in
                    onPickPlayer(PlayerSummary.placeholder(id: userId))
                }
                resultMeta
                stateView
                Spacer().frame(height: 32)
            }
            .padding(.horizontal, 16)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await viewModel.load() }
    }

    // MARK: - Search

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(searchFocused ? DSColor.accent : DSColor.textTertiary)
                .scaleEffect(searchFocused ? 1.05 : 1.0)
                .animation(.spring(response: 0.2, dampingFraction: 0.7), value: searchFocused)
            
            TextField(
                String(localized: "players.search.placeholder"),
                text: Binding(
                    get: { viewModel.query },
                    set: { viewModel.setQuery($0) }
                )
            )
            .focused($searchFocused)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(DSColor.textPrimary)
            .submitLabel(.search)

            if !viewModel.query.isEmpty {
                Button {
                    viewModel.setQuery("")
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(DSColor.textTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("common.clear"))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(DSColor.textPrimary.opacity(0.02))
                .background(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(
                    searchFocused ? DSColor.accent.opacity(0.4) : DSColor.textPrimary.opacity(0.06),
                    lineWidth: 1
                )
        )
        .animation(.snappy(duration: 0.15), value: searchFocused)
    }

    // MARK: - Filters

    private var filtersStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if viewModel.viewerHome != nil {
                    filterChip(
                        titleKey: "players.filter.nearby",
                        icon: "location.fill",
                        selected: viewModel.nearbyOnly
                    ) {
                        Task { await viewModel.setNearbyOnly(!viewModel.nearbyOnly) }
                    }
                }
                filterChip(
                    titleKey: "players.filter.following",
                    icon: "checkmark.seal.fill",
                    selected: viewModel.followingOnly
                ) {
                    viewModel.setFollowingOnly(!viewModel.followingOnly)
                }
                ForEach(PlayerSkillBand.allCases) { band in
                    filterChip(
                        titleKey: LocalString(band.titleKey),
                        icon: bandSymbol(for: band),
                        selected: viewModel.skill == band
                    ) {
                        Task {
                            await viewModel.setSkill(viewModel.skill == band ? nil : band)
                        }
                    }
                }
            }
            .padding(.horizontal, 2)
            .padding(.vertical, 2)
        }
    }

    private func bandSymbol(for band: PlayerSkillBand) -> String {
        switch band {
        case .beginner:     return "leaf.fill"
        case .intermediate: return "figure.tennis"
        case .advanced:     return "flame.fill"
        case .expert:       return "trophy.fill"
        }
    }

    private func LocalString(_ val: String.LocalizationValue) -> LocalizedStringKey {
        LocalizedStringKey(String(localized: val))
    }

    private func filterChip(
        titleKey: LocalizedStringKey,
        icon: String?,
        selected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            action()
        } label: {
            HStack(spacing: 4) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 10, weight: .bold))
                }
                Text(titleKey)
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(selected ? DSColor.accent : DSColor.textPrimary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background {
                Capsule()
                    .fill(selected ? DSColor.accent.opacity(0.10) : DSColor.textPrimary.opacity(0.03))
                    .background {
                        if !selected {
                            Capsule().fill(.ultraThinMaterial)
                        }
                    }
            }
            .overlay(
                Capsule().strokeBorder(
                    selected ? DSColor.accent.opacity(0.4) : DSColor.textPrimary.opacity(0.06),
                    lineWidth: 1
                )
            )
        }
        .buttonStyle(SpringPressStyle())
    }

    // MARK: - Result meta

    @ViewBuilder
    private var resultMeta: some View {
        if case .loaded(let players) = viewModel.state {
            Text(String.localizedStringWithFormat(
                NSLocalizedString("players.count_format", comment: ""),
                players.count
            ))
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(DSColor.textTertiary)
            .padding(.horizontal, 2)
        }
    }

    // MARK: - State

    @ViewBuilder
    private var stateView: some View {
        switch viewModel.state {
        case .idle, .loading:
            loadingSkeleton
        case .empty:
            emptyState
        case .error(let message):
            ErrorStateView(message: message) {
                Task { await viewModel.load() }
            }
        case .loaded(let players):
            LazyVStack(spacing: 12) {
                ForEach(players) { player in
                    PlayerRowCard(
                        player: player,
                        onTap: { onPickPlayer(player) },
                        onFollowChange: { _ in
                            Task { await viewModel.toggleFollow(player) }
                        }
                    )
                }
            }
        }
    }

    // MARK: - Empty / loading

    private var emptyState: some View {
        let filtered = viewModel.activeFilterCount > 0
        return VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.06))
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(
                        LinearGradient(
                            colors: [DSColor.accent.opacity(0.2), DSColor.accent.opacity(0.02)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
                    .frame(width: 72, height: 72)
                Image(systemName: filtered ? "person.2.slash.fill" : "person.2.fill")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(DSColor.accent)
            }
            .padding(.top, 10)
            
            VStack(spacing: 4) {
                Text(emptyTitleKey)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                Text(emptyMessageKey)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .padding(.horizontal, 12)
            }
            
            if filtered {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    Task { await viewModel.resetFilters() }
                } label: {
                    Text("empty.players.cta")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(DSColor.textOnAccent)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(
                            Capsule().fill(
                                LinearGradient(
                                    colors: [DSColor.accent, DSColor.accentSoft],
                                    startPoint: .topLeading, endPoint: .bottomTrailing
                                )
                            )
                        )
                        .shadow(color: DSColor.accent.opacity(0.15), radius: 4, y: 2)
                }
                .buttonStyle(SpringPressStyle())
                .padding(.top, 6)
                .padding(.bottom, 6)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.textPrimary.opacity(0.02))
                .background(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.textPrimary.opacity(0.04), lineWidth: 1)
        )
        .padding(.top, 8)
    }

    private var emptyTitleKey: LocalizedStringKey {
        viewModel.activeFilterCount > 0
            ? "empty.players.title"
            : "players.empty.title"
    }
    private var emptyMessageKey: LocalizedStringKey {
        viewModel.activeFilterCount > 0
            ? "empty.players.body"
            : "players.empty.message"
    }

    private var loadingSkeleton: some View {
        SkeletonView(shape: .row, count: 6)
    }
}

// MARK: - Player row card

private struct PlayerRowCard: View {
    let player: PlayerSummary
    var onTap: () -> Void
    var onFollowChange: (Bool) -> Void

    private var isFollowing: Bool {
        FollowStore.shared.followingByUserId[player.id] ?? (player.is_followed_by_me ?? false)
    }

    private var isActiveNow: Bool {
        guard let iso = player.last_seen_at else { return false }
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: iso) else { return false }
        return Date().timeIntervalSince(date) < 300 // 5 minutes
    }

    private var lastSeenText: String? {
        guard let iso = player.last_seen_at else { return nil }
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: iso) else { return nil }
        
        let diff = Date().timeIntervalSince(date)
        if diff < 300 {
            return "• " + String(localized: "players.status.active_now")
        } else {
            let relFormatter = RelativeDateTimeFormatter()
            relFormatter.unitsStyle = .short
            return "• " + relFormatter.localizedString(for: date, relativeTo: Date())
        }
    }

    var body: some View {
        Button(action: tap) {
            HStack(spacing: 14) {
                avatar
                    .accessibilityHidden(true)
                
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(player.display_name)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(DSColor.textPrimary)
                            .lineLimit(1)
                        
                        if let lastSeen = lastSeenText {
                            Text(lastSeen)
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(DSColor.textTertiary)
                        }
                        
                        // VIP reliability status sparkle badge
                        if let r = player.reliability_score, r >= 90 {
                            Image(systemName: "sparkles")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(DSColor.accent)
                        }
                    }
                    
                    metaPillsRow
                }
                Spacer()
                
                followButton
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(DSColor.textPrimary.opacity(0.015))
                    .background(
                        RadialGradient(
                            colors: [
                                SkillLevel.from(elo: player.primary_elo).accent.opacity(0.03),
                                Color.clear
                            ],
                            center: .topLeading,
                            startRadius: 8,
                            endRadius: 96
                        )
                    )
                    .background(.ultraThinMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [DSColor.textPrimary.opacity(0.08), DSColor.textPrimary.opacity(0.02)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(SpringPressStyle())
        .accessibilityElement(children: .contain)
        .accessibilityHint(Text("a11y.player_card.hint"))
    }

    private var avatar: some View {
        let url: URL? = {
            guard let raw = player.photo_url, !raw.hasPrefix("data:") else { return nil }
            return URL(string: raw)
        }()
        
        return ZStack(alignment: .bottomTrailing) {
            ZStack {
                if let url {
                    CachedAsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        initialsCircle
                    }
                } else {
                    initialsCircle
                }
            }
            .frame(width: 44, height: 44)
            .clipShape(Circle())
            .overlay(
                Circle()
                    .stroke(
                        LinearGradient(
                            colors: [DSColor.accent.opacity(0.8), DSColor.info.opacity(0.8), DSColor.accent.opacity(0.2)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        ),
                        lineWidth: 1.5
                    )
                    .frame(width: 49, height: 49)
            )
            .padding(2)

            if isActiveNow {
                Circle()
                    .fill(DSColor.success)
                    .frame(width: 9, height: 9)
                    .overlay(
                        Circle().stroke(DSColor.surfaceElevated, lineWidth: 1.2)
                    )
                    .shadow(color: DSColor.success.opacity(0.3), radius: 1.5)
                    .offset(x: -1, y: -1)
            }
        }
    }

    private var initialsCircle: some View {
        ZStack {
            Circle()
                .fill(LinearGradient(
                    colors: [DSColor.accent.opacity(0.5), DSColor.accent.opacity(0.2)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                ))
            Text(initials)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(DSColor.textOnAccent)
        }
    }

    private var metaPillsRow: some View {
        HStack(spacing: 6) {
            let eloLevel = SkillLevel.from(elo: player.primary_elo)
            
            // ELO Pill
            HStack(spacing: 4) {
                Image(systemName: eloLevel.systemImage)
                    .font(.system(size: 8, weight: .bold))
                Text(eloLevel.localizedName)
                    .font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(eloLevel.accent)
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .background(eloLevel.accent.opacity(0.06))
            .overlay(
                Capsule()
                    .strokeBorder(eloLevel.accent.opacity(0.15), lineWidth: 0.6)
            )
            .clipShape(Capsule())

            // Distance Pill
            if let km = player.distance_km {
                HStack(spacing: 2) {
                    Image(systemName: "location.fill")
                        .font(.system(size: 8))
                    Text(distanceLabel(km: km))
                        .font(.system(size: 9, weight: .semibold))
                }
                .foregroundStyle(DSColor.textSecondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .background(DSColor.textPrimary.opacity(0.03))
                .overlay(
                    Capsule()
                        .strokeBorder(DSColor.textPrimary.opacity(0.06), lineWidth: 0.6)
                )
                .clipShape(Capsule())
                .monospacedDigit()
            }

            // Reliability Pill
            if let r = player.reliability_score, r >= 80 {
                HStack(spacing: 2) {
                    Image(systemName: "checkmark.shield.fill")
                        .font(.system(size: 8))
                    Text("\(r)%")
                        .font(.system(size: 9, weight: .semibold))
                }
                .foregroundStyle(r >= 90 ? DSColor.success : DSColor.textSecondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .background(r >= 90 ? DSColor.success.opacity(0.06) : DSColor.textPrimary.opacity(0.03))
                .overlay(
                    Capsule()
                        .strokeBorder(r >= 90 ? DSColor.success.opacity(0.15) : DSColor.textPrimary.opacity(0.06), lineWidth: 0.6)
                )
                .clipShape(Capsule())
                .monospacedDigit()
            }
        }
    }

    @ViewBuilder
    private var followButton: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            onFollowChange(!isFollowing)
        } label: {
            HStack(spacing: 4) {
                if isFollowing {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .bold))
                }
                Text(isFollowing ? "players.action.following" : "players.action.follow")
                    .font(.system(size: 10, weight: .bold))
            }
            .foregroundStyle(isFollowing ? DSColor.textSecondary : DSColor.textPrimary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                Capsule().fill(
                    isFollowing
                        ? DSColor.textPrimary.opacity(0.03)
                        : DSColor.textPrimary.opacity(0.05)
                )
            )
            .overlay(
                Capsule().strokeBorder(
                    isFollowing ? DSColor.textPrimary.opacity(0.08) : DSColor.textPrimary.opacity(0.12),
                    lineWidth: 1
                )
            )
        }
        .buttonStyle(SpringButtonStyle())
        .accessibilityLabel(Text(isFollowing ? "a11y.follow_toggle.unfollow" : "a11y.follow_toggle.follow"))
        .accessibilityAddTraits(isFollowing ? .isSelected : [])
    }

    private func tap() {
        UISelectionFeedbackGenerator().selectionChanged()
        onTap()
    }

    private var initials: String {
        let parts = player.display_name.split(separator: " ").prefix(2)
        let res = parts.map { $0.prefix(1).uppercased() }.joined()
        return res.isEmpty ? "?" : res
    }
}

// MARK: - Sheet payload

struct FollowsListSheetPayload: Identifiable, Equatable {
    let userId: String
    let kind: FollowListKind
    var id: String { "\(kind.rawValue)-\(userId)" }
}

// MARK: - Matchmaker player card

private struct MatchmakerPlayerCard: View {
    let player: RecommendedPlayer
    var onTap: () -> Void
    var onFollow: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    private var isFollowing: Bool {
        FollowStore.shared.isFollowing(userId: player.user_id)
    }

    var body: some View {
        Button(action: { UISelectionFeedbackGenerator().selectionChanged(); onTap() }) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 14) {
                    avatar
                    
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(player.display_name)
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(DSColor.textPrimary)
                                .lineLimit(1)
                            
                            // Glowing Matchmaker VIP badge tag — sentence case, SF Default, tiny lime spark icon
                            HStack(spacing: 2) {
                                Image(systemName: "sparkles")
                                    .font(.system(size: 7, weight: .bold))
                                    .foregroundStyle(DSColor.accent)
                                Text("players.badge.vip")
                                    .font(.system(size: 8, weight: .bold))
                                    .foregroundStyle(DSColor.textPrimary)
                            }
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(
                                Capsule().fill(DSColor.textPrimary.opacity(0.04))
                            )
                            .overlay(
                                Capsule().strokeBorder(DSColor.accent.opacity(0.25), lineWidth: 0.6)
                            )
                        }
                        
                        skillLine
                    }
                    Spacer()
                    
                    followButton
                }
                
                if !decodedReasons.isEmpty {
                    reasonsChips
                }
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(DSColor.textPrimary.opacity(0.015))
                    .background(.ultraThinMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [DSColor.textPrimary.opacity(0.08), DSColor.textPrimary.opacity(0.02)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(SpringPressStyle())
        .accessibilityElement(children: .contain)
    }

    private var skillLine: some View {
        let level = SkillLevel.from(elo: player.elo_rating)
        return HStack(spacing: 6) {
            // ELO Pill
            HStack(spacing: 4) {
                Image(systemName: level.systemImage)
                    .font(.system(size: 8, weight: .bold))
                Text(level.labelKey)
                    .font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(level.accent)
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .background(level.accent.opacity(0.06))
            .overlay(
                Capsule().strokeBorder(level.accent.opacity(0.15), lineWidth: 0.6)
            )
            .clipShape(Capsule())
            
            if let km = player.distance_km {
                HStack(spacing: 2) {
                    Image(systemName: "location.fill")
                        .font(.system(size: 8))
                    Text(distanceLabel(km: km))
                        .font(.system(size: 9, weight: .semibold))
                }
                .foregroundStyle(DSColor.textSecondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .background(DSColor.textPrimary.opacity(0.03))
                .overlay(
                    Capsule().strokeBorder(DSColor.textPrimary.opacity(0.06), lineWidth: 0.6)
                )
                .clipShape(Capsule())
                .monospacedDigit()
            }
        }
    }

    private var avatar: some View {
        let url: URL? = {
            guard let raw = player.photo_url, !raw.hasPrefix("data:") else { return nil }
            return URL(string: raw)
        }()
        return ZStack {
            if let url {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initialsCircle
                }
            } else {
                initialsCircle
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(Circle())
        .overlay(
            Circle()
                .stroke(
                    LinearGradient(
                        colors: [DSColor.accent.opacity(0.8), DSColor.info.opacity(0.8), DSColor.accent.opacity(0.2)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    ),
                    lineWidth: 1.5
                )
                .frame(width: 49, height: 49)
        )
        .padding(2)
    }

    private var initialsCircle: some View {
        ZStack {
            Circle().fill(
                LinearGradient(
                    colors: [DSColor.accent.opacity(0.5), DSColor.accent.opacity(0.2)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
            )
            Text(initials)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(DSColor.textOnAccent)
        }
    }

    private var initials: String {
        let parts = player.display_name.split(separator: " ").prefix(2)
        let joined = parts.map { $0.prefix(1).uppercased() }.joined()
        return joined.isEmpty ? "?" : joined
    }

    private var decodedReasons: [RecommendedPlayerReason] {
        guard let codes = player.reason_codes else { return [] }
        return codes.compactMap { RecommendedPlayerReason(rawValue: $0) }
    }

    private var reasonsChips: some View {
        let visible = Array(decodedReasons.prefix(3))
        return HStack(spacing: 6) {
            ForEach(Array(visible.enumerated()), id: \.offset) { _, reason in
                HStack(spacing: 4) {
                    Circle()
                        .fill(reason.accent)
                        .frame(width: 4, height: 4)
                    
                    Text(reason.labelKey)
                        .font(.system(size: 9, weight: .semibold))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(reason.accent.opacity(0.05))
                .foregroundStyle(reason.accent)
                .clipShape(Capsule())
                .overlay(
                    Capsule().strokeBorder(reason.accent.opacity(0.12), lineWidth: 0.6)
                )
                .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var followButton: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            onFollow()
        } label: {
            HStack(spacing: 4) {
                if isFollowing {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .bold))
                }
                Text(isFollowing ? "players.action.following" : "players.action.follow")
                    .font(.system(size: 10, weight: .bold))
            }
            .foregroundStyle(isFollowing ? DSColor.textSecondary : DSColor.textPrimary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                Capsule().fill(
                    isFollowing
                        ? DSColor.textPrimary.opacity(0.03)
                        : DSColor.textPrimary.opacity(0.05)
                )
            )
            .overlay(
                Capsule().strokeBorder(
                    isFollowing ? DSColor.textPrimary.opacity(0.08) : DSColor.textPrimary.opacity(0.12),
                    lineWidth: 1
                )
            )
        }
        .buttonStyle(SpringButtonStyle())
        .accessibilityLabel(Text(isFollowing ? "a11y.follow_toggle.unfollow" : "a11y.follow_toggle.follow"))
        .accessibilityAddTraits(isFollowing ? .isSelected : [])
    }
}

// MARK: - Distance formatting

/// Renders a distance pill label using the localized unit format
/// (`common.distance.km_format`, e.g. "%@ km" / "%@ км"). The numeric
/// part is formatted locale-aware with one fraction digit so the
/// decimal separator and digits respect the user's locale, and only the
/// unit/order lives in the string catalog — never hardcoded in the view.
private func distanceLabel(km: Double) -> String {
    let number = km.formatted(.number.precision(.fractionLength(1)))
    return String(
        format: String(localized: "common.distance.km_format"),
        number
    )
}

// MARK: - PlayerSummary Extensions

extension PlayerSummary {
    static func placeholder(id: String) -> PlayerSummary {
        PlayerSummary(
            id: id,
            display_name: "",
            photo_url: nil,
            primary_sport: nil,
            primary_elo: nil,
            reliability_score: nil,
            distance_km: nil,
            is_followed_by_me: nil,
            followers_count: nil,
            last_seen_at: nil
        )
    }
}

// MARK: - Active filter count

extension PlayersViewModel {
    var activeFilterCount: Int {
        var c = 0
        if sportSlug != nil { c += 1 }
        if skill != nil { c += 1 }
        if nearbyOnly { c += 1 }
        if followingOnly { c += 1 }
        return c
    }
}

