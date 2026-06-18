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
    @State private var followsSheet: FollowsListSheetPayload?

    /// Active tab. Lives on the view because the segmented control is a
    /// view-local affordance — only the matchmaking VM cares about the
    /// switch, and only via `.task(id:)` re-triggering its load.
    @State private var activeTab: PlayersTab = .all

    /// Lazily-built matchmaking view-model. Constructed inside `task` once
    /// we have the container so we don't create one for users who never
    /// open the tab. `@State` keeps the same instance across tab switches.
    @State private var matchmakingVM: MatchmakingViewModel?

    /// Tracks which keyed FollowStore edges have changed since last paint.
    @State private var followStore = FollowStore.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                tabSwitcher

                switch activeTab {
                case .all:
                    content
                case .matchmaking:
                    matchmakingContent
                }

                Spacer().frame(height: 100)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.top, DSSpacing.xs)
        }
        .background(DSColor.background.ignoresSafeArea())
        .navigationTitle(Text("players.nav.title"))
        .navigationBarTitleDisplayMode(.large)
        .scrollDismissesKeyboard(.interactively)
        .refreshable {
            switch activeTab {
            case .all:
                await viewModel.load()
            case .matchmaking:
                await matchmakingVM?.refresh()
            }
        }
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

    // MARK: - Tab switcher

    /// Standardized premium Segmented Control tab switcher — "Hamısı" / "Sənə uyğun".
    private var tabSwitcher: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                tabChip(.all)
                tabChip(.matchmaking)
            }
        }
    }

    private func tabChip(_ tab: PlayersTab) -> some View {
        let isOn = activeTab == tab
        return Button {
            Haptics.selection()
            activeTab = tab
        } label: {
            Text(tab.titleKey)
                .font(DSType.metaCaption)
                .foregroundStyle(isOn ? DSColor.textOnAccent : DSColor.textSecondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(Capsule().fill(isOn ? DSColor.accent : DSColor.surfaceElevated))
        }
        .buttonStyle(SpringPressStyle())
    }

    // MARK: - Matchmaking tab

    @ViewBuilder
    private var matchmakingContent: some View {
        if let vm = matchmakingVM {
            matchmakingStateView(vm: vm)
        } else {
            loadingSkeleton
        }
    }

    @ViewBuilder
    private func matchmakingStateView(vm: MatchmakingViewModel) -> some View {
        switch vm.players {
        case .idle, .loading:
            loadingSkeleton
        case .error(let message):
            errorState(message) {
                Task { await vm.refresh() }
            }
        case .empty:
            emptyShell(
                icon: "sparkles",
                title: "players.matchmaking.empty.title",
                message: "players.matchmaking.empty.message"
            )
        case .loaded(let items):
            section(title: countTitle(items.count)) {
                ForEach(items) { player in
                    RecommendedPlayerNativeRow(
                        player: player,
                        followStore: followStore,
                        onTap: { onPickPlayer(PlayerSummary.placeholder(id: player.user_id)) },
                        onFollow: { await vm.toggleFollow(player) }
                    )
                }
            }
        }
    }

    // MARK: - Body

    @ViewBuilder
    private var content: some View {
        playerSearchField
        playerFilterChips

        if viewModel.query.isEmpty && viewModel.activeFilterCount == 0 {
            SuggestedFollowsHook.makeCarousel(container: container) { userId in
                onPickPlayer(PlayerSummary.placeholder(id: userId))
            }
        }

        playerStateContent
    }

    private var playerSearchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(DSColor.textTertiary)

            TextField(
                "players.search.placeholder",
                text: Binding(
                    get: { viewModel.query },
                    set: { viewModel.setQuery($0) }
                )
            )
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .font(DSType.bodyMedium)
            .foregroundStyle(DSColor.textPrimary)
            .submitLabel(.search)

            if !viewModel.query.isEmpty {
                Button {
                    viewModel.setQuery("")
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(DSColor.textTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("common.clear"))
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 44)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
    }

    private var playerFilterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                Menu {
                    Button {
                        Task { await viewModel.setSkill(nil) }
                    } label: {
                        if viewModel.skill == nil {
                            Label("players.filter.skill.any", systemImage: "checkmark")
                        } else {
                            Text("players.filter.skill.any")
                        }
                    }

                    ForEach(PlayerSkillBand.allCases) { band in
                        Button {
                            Task { await viewModel.setSkill(band) }
                        } label: {
                            Label(
                                LocalizedStringKey(String(localized: band.titleKey)),
                                systemImage: viewModel.skill == band ? "checkmark" : bandSymbol(for: band)
                            )
                        }
                    }
                } label: {
                    filterChip(selectedSkillTitle, isSelected: viewModel.skill != nil)
                }

                if viewModel.viewerHome != nil {
                    filterChipButton("players.filter.nearby", isSelected: viewModel.nearbyOnly) {
                        Task { await viewModel.setNearbyOnly(!viewModel.nearbyOnly) }
                    }
                }

                filterChipButton("players.filter.following", isSelected: viewModel.followingOnly) {
                    viewModel.setFollowingOnly(!viewModel.followingOnly)
                }

                if viewModel.activeFilterCount > 0 {
                    filterChipButton("players.filters.reset", isSelected: false) {
                        Task { await viewModel.resetFilters() }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var playerStateContent: some View {
        switch viewModel.state {
        case .idle, .loading:
            loadingSkeleton
        case .empty:
            nativeEmptyState
        case .error(let message):
            errorState(message) {
                Task { await viewModel.load() }
            }
        case .loaded(let players):
            section(title: countTitle(players.count)) {
                ForEach(players) { player in
                    PlayerNativeRow(
                        player: player,
                        followStore: followStore,
                        onTap: { onPickPlayer(player) },
                        onFollow: { await viewModel.toggleFollow(player) }
                    )
                }
            }
        }
    }

    private var nativeEmptyState: some View {
        emptyShell(icon: emptySystemImage, title: emptyTitleKey, message: emptyMessageKey) {
            if viewModel.activeFilterCount > 0 {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    Task { await viewModel.resetFilters() }
                } label: {
                    Text("players.empty.reset_cta")
                        .font(DSType.button)
                        .foregroundStyle(DSColor.textOnAccent)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 11)
                        .background(Capsule().fill(DSColor.accent))
                }
                .buttonStyle(SpringPressStyle())
                .padding(.top, 4)
            }
        }
    }

    @ViewBuilder
    private func section<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(DSType.sectionTitle)
                .foregroundStyle(DSColor.textPrimary)
            content()
        }
    }

    private var loadingSkeleton: some View {
        VStack(spacing: 14) {
            ForEach(0..<5, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(DSColor.surfaceElevated)
                    .frame(height: 74)
            }
        }
        .redacted(reason: .placeholder)
        .accessibilityHidden(true)
    }

    private func errorState(_ message: String, retry: @escaping () -> Void) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(DSColor.danger)
            Text(message)
                .font(DSType.bodyMedium)
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
            Button(action: retry) {
                Text("matches.error.retry")
                    .font(DSType.bodyStrong)
                    .foregroundStyle(DSColor.accent)
            }
            .buttonStyle(SpringPressStyle())
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 48)
        .padding(.horizontal, 24)
    }

    private func emptyShell<Actions: View>(
        icon: String,
        title: LocalizedStringKey,
        message: LocalizedStringKey,
        @ViewBuilder actions: () -> Actions
    ) -> some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(DSColor.accentMuted).frame(width: 64, height: 64)
                Image(systemName: icon)
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            Text(title)
                .font(DSType.sectionTitle)
                .foregroundStyle(DSColor.textPrimary)
            Text(message)
                .font(DSType.bodyMedium)
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
            actions()
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
        .padding(.horizontal, 24)
    }

    private func emptyShell(icon: String, title: LocalizedStringKey, message: LocalizedStringKey) -> some View {
        emptyShell(icon: icon, title: title, message: message) {
            EmptyView()
        }
    }

    private func filterChipButton(
        _ titleKey: LocalizedStringKey,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            filterChip(Text(titleKey), isSelected: isSelected)
        }
        .buttonStyle(SpringPressStyle())
    }

    private func filterChip(_ title: Text, isSelected: Bool) -> some View {
        title
            .font(DSType.metaCaption)
            .foregroundStyle(isSelected ? DSColor.textOnAccent : DSColor.textSecondary)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(Capsule().fill(isSelected ? DSColor.accent : DSColor.surfaceElevated))
    }

    private var selectedSkillTitle: Text {
        if let skill = viewModel.skill {
            Text(LocalizedStringKey(String(localized: skill.titleKey)))
        } else {
            Text("players.filter.skill.any")
        }
    }

    private func countTitle(_ count: Int) -> String {
        String.localizedStringWithFormat(
            NSLocalizedString("players.count_format", comment: ""),
            count
        )
    }

    private var emptySystemImage: String {
        if !viewModel.query.isEmpty { return "magnifyingglass" }
        if viewModel.followingOnly { return "person.badge.plus" }
        return viewModel.activeFilterCount > 0 ? "line.3.horizontal.decrease.circle" : "person.2"
    }

    // MARK: - Symbols

    private func bandSymbol(for band: PlayerSkillBand) -> String {
        switch band {
        case .beginner:     return "leaf.fill"
        case .intermediate: return "figure.tennis"
        case .advanced:     return "flame.fill"
        case .expert:       return "trophy.fill"
        }
    }

    private var emptyTitleKey: LocalizedStringKey {
        if !viewModel.query.isEmpty { return "players.empty.search.title" }
        if viewModel.followingOnly { return "players.empty.following.title" }
        if viewModel.activeFilterCount > 0 { return "players.empty.filtered.title" }
        return "players.empty.title"
    }
    private var emptyMessageKey: LocalizedStringKey {
        if !viewModel.query.isEmpty { return "players.empty.search.message" }
        if viewModel.followingOnly { return "players.empty.following.message" }
        if viewModel.activeFilterCount > 0 { return "players.empty.filtered.message" }
        return "players.empty.message"
    }
}

// MARK: - Native player row

private struct PlayerNativeRow: View {
    let player: PlayerSummary
    let followStore: FollowStore
    var onTap: () -> Void
    var onFollow: () async -> Void

    private var isFollowing: Bool {
        followStore.followingByUserId[player.id] ?? (player.is_followed_by_me ?? false)
    }

    private var isActiveNow: Bool {
        guard let iso = player.last_seen_at else { return false }
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: iso) else { return false }
        return Date().timeIntervalSince(date) < 300
    }

    var body: some View {
        HStack(spacing: 12) {
            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                onTap()
            } label: {
                HStack(spacing: 12) {
                    avatar

                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(player.display_name)
                                .font(.system(.headline, design: .default, weight: .semibold))
                                .foregroundStyle(DSColor.textPrimary)
                                .lineLimit(1)

                            if isActiveNow {
                                Circle()
                                    .fill(DSColor.success)
                                    .frame(width: 7, height: 7)
                                    .accessibilityLabel(Text("players.status.active_now"))
                            }
                        }

                        metaLine
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Spacer(minLength: 8)

            FollowButton(
                isFollowing: Binding(
                    get: { isFollowing },
                    set: { _ in }
                ),
                size: .compact
            ) { _ in
                await onFollow()
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityHint(Text("a11y.player_card.hint"))
    }

    private var avatar: some View {
        let url: URL? = {
            guard let raw = player.photo_url, !raw.hasPrefix("data:") else { return nil }
            return URL(string: raw)
        }()

        return ZStack(alignment: .bottomTrailing) {
            if let url {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initialsCircle
                }
            } else {
                initialsCircle
            }

            if isActiveNow {
                Circle()
                    .fill(DSColor.success)
                    .frame(width: 11, height: 11)
                    .overlay(Circle().strokeBorder(DSColor.surfaceElevated, lineWidth: 2))
            }
        }
        .frame(width: 48, height: 48)
        .clipShape(Circle())
        .overlay {
            Circle().strokeBorder(DSColor.accent.opacity(0.45), lineWidth: 1)
        }
    }

    private var initialsCircle: some View {
        ZStack {
            Circle().fill(DSColor.accent.opacity(0.16))
            Text(initials)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(DSColor.accent)
        }
    }

    private var metaLine: some View {
        Text(metaParts.joined(separator: " · "))
        .font(.system(.caption, design: .default))
        .foregroundStyle(DSColor.textSecondary)
        .lineLimit(1)
    }

    private var metaParts: [String] {
        var parts: [String] = [SkillLevel.from(elo: player.primary_elo).localizedName]

        if let km = player.distance_km {
            parts.append(distanceLabel(km: km))
        }

        if isActiveNow {
            parts.append(String(localized: "players.status.active_now"))
        }

        if let reliability = player.reliability_score, reliability >= 80 {
            parts.append("\(reliability)%")
        }

        if let followers = player.followers_count, followers > 0 {
            parts.append(String.localizedStringWithFormat(
                NSLocalizedString("players.followers_count", comment: ""),
                followers
            ))
        }

        return parts
    }

    private var initials: String {
        let parts = player.display_name.split(separator: " ").prefix(2)
        let joined = parts.map { $0.prefix(1).uppercased() }.joined()
        return joined.isEmpty ? "?" : joined
    }
}

private struct RecommendedPlayerNativeRow: View {
    let player: RecommendedPlayer
    let followStore: FollowStore
    var onTap: () -> Void
    var onFollow: () async -> Void

    private var isFollowing: Bool {
        followStore.isFollowing(userId: player.user_id)
    }

    var body: some View {
        HStack(spacing: 12) {
            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                onTap()
            } label: {
                HStack(spacing: 12) {
                    avatar

                    VStack(alignment: .leading, spacing: 6) {
                        Text(player.display_name)
                            .font(.system(.headline, design: .default, weight: .semibold))
                            .foregroundStyle(DSColor.textPrimary)
                            .lineLimit(1)

                        Text(metaParts.joined(separator: " · "))
                            .font(.system(.caption, design: .default))
                            .foregroundStyle(DSColor.textSecondary)
                            .lineLimit(1)

                        if !decodedReasons.isEmpty {
                            reasonChips
                        }
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Spacer(minLength: 8)

            FollowButton(
                isFollowing: Binding(
                    get: { isFollowing },
                    set: { _ in }
                ),
                size: .compact
            ) { _ in
                await onFollow()
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityHint(Text("a11y.player_card.hint"))
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
        .frame(width: 48, height: 48)
        .clipShape(Circle())
        .overlay {
            Circle().strokeBorder(DSColor.accent.opacity(0.45), lineWidth: 1)
        }
    }

    private var initialsCircle: some View {
        ZStack {
            Circle().fill(DSColor.accent.opacity(0.16))
            Text(initials)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(DSColor.accent)
        }
    }

    private var metaParts: [String] {
        var parts = [SkillLevel.from(elo: player.elo_rating).localizedName]
        if let km = player.distance_km {
            parts.append(distanceLabel(km: km))
        }
        return parts
    }

    private var decodedReasons: [RecommendedPlayerReason] {
        guard let codes = player.reason_codes else { return [] }
        return codes.compactMap { RecommendedPlayerReason(rawValue: $0) }
    }

    private var reasonChips: some View {
        HStack(spacing: 6) {
            ForEach(Array(decodedReasons.prefix(2).enumerated()), id: \.offset) { _, reason in
                Text(reason.labelKey)
                    .font(.system(size: 10, weight: .semibold, design: .default))
                    .foregroundStyle(reason.accent)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(reason.accent.opacity(0.08)))
            }
        }
        .lineLimit(1)
    }

    private var initials: String {
        let parts = player.display_name.split(separator: " ").prefix(2)
        let joined = parts.map { $0.prefix(1).uppercased() }.joined()
        return joined.isEmpty ? "?" : joined
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
                    .fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(
                        DSColor.border,
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
                    .fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(
                        DSColor.border,
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
