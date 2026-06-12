import SwiftUI

/// Find a game — premium, startup-grade discovery screen.
/// Rebuilt from scratch to offer an extremely clean, modern, and uncluttered
/// design. Advanced filters are moved into a beautiful half-sheet, leaving the
/// main screen spacious with a search bar, active filter pills, and premium
/// social match cards featuring circular avatar stacks.
struct MatchesView: View {
    @State var viewModel: MatchesViewModel
    var onTapGame: (GameSummary) -> Void
    var onTapCreate: () -> Void

    @Environment(AppContainer.self) private var container
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    // SceneStorage to restore the user's last filter choice
    @SceneStorage("matches.period") private var storedPeriod: String = MatchesViewModel.Period.active.rawValue
    @SceneStorage("matches.role")   private var storedRole:   String = MatchesViewModel.Role.any.rawValue
    @SceneStorage("matches.result") private var storedResult: String = MatchesViewModel.Result.any.rawValue

    @State private var showFiltersSheet = false
    @State private var searchText = ""

    /// Active list of games filtered locally by search text to be super responsive
    private var filteredGames: [GameSummary] {
        guard case .loaded(let games) = viewModel.state else { return [] }
        if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return games }
        return games.filter { game in
            game.venue_name?.localizedCaseInsensitiveContains(searchText) == true ||
            game.host_display_name.localizedCaseInsensitiveContains(searchText) == true
        }
    }

    var body: some View {
        ZStack {
            PremiumAuthBackground()
            
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.md) {
                    // Modern search bar and filter trigger
                    searchAndFilterHeader
                        .padding(.top, 12)
                    
                    // Active filters row (horizontal scroll of chips)
                    if viewModel.activeFilterCount > 0 {
                        activeFiltersScrollView
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                    
                    resultMeta
                    
                    content
                }
                .padding(.horizontal, DSSpacing.md)
            }
            .safeAreaPadding(.bottom, 32)
            .scrollIndicators(.hidden)
            .refreshable { await viewModel.load() }
        }
        .navigationTitle(Text("matches.hero.title"))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    onTapCreate()
                } label: {
                    Image(systemName: "plus")
                        .fontWeight(.semibold)
                }
                .accessibilityLabel(Text("matches.create"))
            }
        }
        .sheet(isPresented: $showFiltersSheet) {
            FilterSheetView(viewModel: viewModel, showFiltersSheet: $showFiltersSheet)
                .presentationDetents([.medium])
                .presentationBackground(.ultraThinMaterial)
                .presentationDragIndicator(.visible)
        }
        .task {
            if let me = container.currentUser, let lat = me.home_lat, let lng = me.home_lng {
                viewModel.viewerHome = .init(latitude: lat, longitude: lng)
            }
            // Restore last-used filters from scene storage before the first load
            if let p = MatchesViewModel.Period(rawValue: storedPeriod) { viewModel.period = p }
            if let r = MatchesViewModel.Role(rawValue: storedRole)     { viewModel.role = r }
            if let res = MatchesViewModel.Result(rawValue: storedResult) { viewModel.result = res }
            await viewModel.onAppear()
        }
        .onChange(of: viewModel.period) { _, newValue in storedPeriod = newValue.rawValue }
        .onChange(of: viewModel.role) { _, newValue in storedRole = newValue.rawValue }
        .onChange(of: viewModel.result) { _, newValue in storedResult = newValue.rawValue }
    }

    // MARK: - Header Search & Filter Bar

    private var searchAndFilterHeader: some View {
        HStack(spacing: 12) {
            // Sleek startup search bar
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(DSColor.textSecondary)
                TextField(String(localized: "search.placeholder"), text: $searchText)
                    .font(.system(size: 14, weight: .medium))
                    .textFieldStyle(.plain)
                    .foregroundStyle(DSColor.textPrimary)
                    .autocorrectionDisabled()
                if !searchText.isEmpty {
                    Button { searchText = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(DSColor.textSecondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DSColor.surfaceElevated))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(DSColor.border.opacity(0.35), lineWidth: 1))
            
            // Clean glass filter button with dynamic count badge
            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                showFiltersSheet = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 14, weight: .bold))
                    if viewModel.activeFilterCount > 0 {
                        Text("\(viewModel.activeFilterCount)")
                            .font(.system(size: 10, weight: .heavy))
                            .foregroundStyle(DSColor.inkSurface)
                            .frame(width: 18, height: 18)
                            .background(Circle().fill(DSColor.accent))
                    }
                }
                .foregroundStyle(DSColor.textPrimary)
                .frame(width: 54, height: 44)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DSColor.surfaceElevated))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(DSColor.border.opacity(0.35), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("matches.filter.label"))
        }
    }

    // MARK: - Active Filter Pills Row

    private var activeFiltersScrollView: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if viewModel.skill != .any {
                    activeFilterChip(label: skillTitle(viewModel.skill)) {
                        Task { await viewModel.setSkill(.any) }
                    }
                }
                if viewModel.role != .any {
                    activeFilterChip(label: roleTitle(viewModel.role)) {
                        Task { await viewModel.setRole(.any) }
                    }
                }
                if viewModel.result != .any {
                    activeFilterChip(label: resultTitle(viewModel.result)) {
                        Task { await viewModel.setResult(.any) }
                    }
                }
            }
            .padding(.horizontal, 2)
        }
    }

    private func activeFilterChip(label: String, onClear: @escaping () -> Void) -> some View {
        HStack(spacing: 6) {
            Text(label)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(DSColor.accent)
            Button(action: onClear) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .heavy))
                    .foregroundStyle(DSColor.accent.opacity(0.7))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Capsule().fill(DSColor.accent.opacity(0.12)))
        .overlay(Capsule().strokeBorder(DSColor.accent.opacity(0.3), lineWidth: 1))
    }

    // MARK: - Helpers

    private func skillTitle(_ band: MatchesViewModel.SkillFilter) -> String {
        switch band {
        case .any:  return String(localized: "matches.skill.any")
        case .easy: return String(localized: "matches.skill.easy")
        case .mid:  return String(localized: "matches.skill.mid")
        case .hard: return String(localized: "matches.skill.hard")
        }
    }

    private func roleTitle(_ role: MatchesViewModel.Role) -> String {
        switch role {
        case .any:    return String(localized: "matches.filter.period.all")
        case .host:   return String(localized: "matches.filter.role.host")
        case .player: return String(localized: "matches.filter.role.player")
        }
    }

    private func resultTitle(_ res: MatchesViewModel.Result) -> String {
        switch res {
        case .any:  return String(localized: "matches.filter.period.all")
        case .win:  return String(localized: "matches.filter.result.win")
        case .loss: return String(localized: "matches.filter.result.loss")
        }
    }

    // MARK: - Meta Result Count

    @ViewBuilder
    private var resultMeta: some View {
        if case .loaded = viewModel.state {
            Text(String.localizedStringWithFormat(
                NSLocalizedString("matches.count_format", comment: ""),
                filteredGames.count
            ))
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(DSColor.textTertiary)
        }
    }

    // MARK: - Main Feed Content

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            SkeletonView(shape: .card, count: 4)
        case .empty:
            emptyState
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
        case .loaded:
            if filteredGames.isEmpty {
                emptyState
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(filteredGames) { game in
                        MatchRowCard(
                            game: game,
                            isHost: game.host_user_id == container.currentUser?.id,
                            onTap: { onTapGame(game) }
                        )
                        .transition(.opacity.combined(with: .move(edge: .leading)))
                    }
                }
                .animation(.spring(response: 0.4, dampingFraction: 0.85), value: filteredGames.map(\.id))
            }
        }
    }

    // MARK: - Premium Empty State

    private var emptyState: some View {
        let filtered = viewModel.activeFilterCount > 0 || !searchText.isEmpty
        return VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.16))
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.40), lineWidth: 1)
                    .frame(width: 72, height: 72)
                Image(systemName: emptyIcon)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(spacing: 6) {
                Text(emptyTitleKey)
                    .font(.system(size: 16, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                Text(emptyMessageKey)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .padding(.horizontal, 16)
            }
            if filtered {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    searchText = ""
                    storedRole = MatchesViewModel.Role.any.rawValue
                    storedResult = MatchesViewModel.Result.any.rawValue
                    Task { await viewModel.resetFilters() }
                } label: {
                    Text("matches.filter.reset")
                        .font(.system(size: 13, weight: .heavy))
                        .foregroundStyle(DSColor.textOnAccent)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(DSColor.accent))
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            } else {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    onTapCreate()
                } label: {
                    Text("empty.matches.cta.create")
                        .font(.system(size: 13, weight: .heavy))
                        .foregroundStyle(DSColor.textOnAccent)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(DSColor.accent))
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.xxl, style: .continuous)
                .fill(DSColor.surface)
                .shadow(color: Color.black.opacity(0.02), radius: 10, x: 0, y: 5)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.xxl, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .padding(.top, 12)
    }

    private var emptyIcon: String {
        if viewModel.activeFilterCount > 0 || !searchText.isEmpty {
            return "line.3.horizontal.decrease.circle"
        }
        return "figure.tennis.circle"
    }

    private var emptyTitleKey: LocalizedStringKey {
        if viewModel.activeFilterCount > 0 || !searchText.isEmpty { return "matches.empty.filtered.title" }
        return "empty.matches.title"
    }
    
    private var emptyMessageKey: LocalizedStringKey {
        if viewModel.activeFilterCount > 0 || !searchText.isEmpty { return "matches.empty.filtered.combo.message" }
        return "empty.matches.body"
    }
}

// MARK: - Premium Bottom Filter Sheet

private struct FilterSheetView: View {
    @Bindable var viewModel: MatchesViewModel
    @Binding var showFiltersSheet: Bool

    var body: some View {
        VStack(spacing: 24) {
            // Premium Header with custom minimalist xmark
            HStack {
                Text("matches.filter.label")
                    .font(.system(size: 20, weight: .black, design: .rounded))
                    .foregroundStyle(DSColor.textPrimary)
                Spacer()
                Button {
                    showFiltersSheet = false
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(DSColor.textSecondary)
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(DSColor.surfaceElevated))
                        .overlay(Circle().strokeBorder(DSColor.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.top, 24)

            ScrollView {
                VStack(spacing: 24) {
                    periodSection
                    roleSection
                    if viewModel.period == .past {
                        resultSection
                    }
                    skillSection
                }
                .padding(.vertical, 8)
            }
            .scrollIndicators(.hidden)

            // Dynamic Custom-Pill CTAs
            HStack(spacing: 12) {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    Task {
                        await viewModel.resetFilters()
                        showFiltersSheet = false
                    }
                } label: {
                    Text("matches.filter.reset")
                        .font(.system(size: 14, weight: .black, design: .rounded))
                        .foregroundStyle(DSColor.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(Capsule().fill(DSColor.surfaceElevated))
                        .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: 1))
                }
                .buttonStyle(.plain)

                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    showFiltersSheet = false
                } label: {
                    Text("common.done")
                        .font(.system(size: 14, weight: .black, design: .rounded))
                        .foregroundStyle(DSColor.textOnAccent)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(Capsule().fill(DSColor.accent))
                        .shadow(color: DSColor.accent.opacity(0.15), radius: 6, y: 3)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
    }

    private var periodSection: some View {
        let options: [(MatchesViewModel.Period, LocalizedStringKey)] = [
            (.active, "matches.filter.period.active"),
            (.past,   "matches.filter.period.past"),
            (.all,    "matches.filter.period.all"),
        ]
        return filterRowAxis(
            labelKey: "matches.filter.period.label",
            options: options,
            isSelected: { viewModel.period == $0 },
            onTap: { val in Task { await viewModel.setPeriod(val) } }
        )
    }

    private var roleSection: some View {
        let options: [(MatchesViewModel.Role, LocalizedStringKey)] = [
            (.any,    "matches.filter.period.all"),
            (.host,   "matches.filter.role.host"),
            (.player, "matches.filter.role.player"),
        ]
        return filterRowAxis(
            labelKey: "matches.filter.role.label",
            options: options,
            isSelected: { viewModel.role == $0 },
            onTap: { val in Task { await viewModel.setRole(val) } }
        )
    }

    private var resultSection: some View {
        let options: [(MatchesViewModel.Result, LocalizedStringKey)] = [
            (.any,  "matches.filter.period.all"),
            (.win,  "matches.filter.result.win"),
            (.loss, "matches.filter.result.loss"),
        ]
        return filterRowAxis(
            labelKey: "matches.filter.result.label",
            options: options,
            isSelected: { viewModel.result == $0 },
            onTap: { val in Task { await viewModel.setResult(val) } }
        )
    }

    private var skillSection: some View {
        let options: [(MatchesViewModel.SkillFilter, LocalizedStringKey)] = [
            (.any,  "matches.skill.any"),
            (.easy, "matches.skill.easy"),
            (.mid,  "matches.skill.mid"),
            (.hard, "matches.skill.hard"),
        ]
        return filterRowAxis(
            labelKey: "skill.label",
            options: options,
            isSelected: { viewModel.skill == $0 },
            onTap: { val in Task { await viewModel.setSkill(val) } }
        )
    }

    private func filterRowAxis<T: Hashable & Identifiable>(
        labelKey: LocalizedStringKey,
        options: [(T, LocalizedStringKey)],
        isSelected: @escaping (T) -> Bool,
        onTap: @escaping (T) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(labelKey)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(DSColor.textSecondary)
                .padding(.horizontal, 20)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(options, id: \.0.id) { option in
                        let selected = isSelected(option.0)
                        Button {
                            UISelectionFeedbackGenerator().selectionChanged()
                            onTap(option.0)
                        } label: {
                            Text(option.1)
                                .font(.system(size: 13, weight: .semibold, design: .rounded))
                                .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .background(selected ? DSColor.accent : DSColor.surfaceElevated)
                                .clipShape(Capsule())
                                .overlay(
                                    Capsule()
                                        .strokeBorder(selected ? Color.clear : DSColor.border, lineWidth: 1)
                                )
                                .shadow(color: selected ? DSColor.accent.opacity(0.15) : Color.clear, radius: 4, y: 2)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }
}

// MARK: - Redesigned Social Match Card

private struct MatchRowCard: View {
    let game: GameSummary
    let isHost: Bool
    var onTap: () -> Void

    var body: some View {
        Button(action: tap) {
            VStack(alignment: .leading, spacing: 12) {
                // Header (Sport badge + Time + Host badge)
                HStack(spacing: 8) {
                    sportBadge
                    
                    timeHeadlineView
                    
                    Spacer()
                    
                    if isHost {
                        Text("match.host_badge.you")
                            .font(.system(size: 9, weight: .heavy, design: .rounded))
                            .foregroundStyle(DSColor.accent) // Royal Blue
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Capsule().fill(DSColor.secondary)) // Lime-Yellow
                    }
                }
                
                // Body (Venue + ELO range)
                VStack(alignment: .leading, spacing: 4) {
                    Text(venueText)
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    
                    HStack(spacing: 8) {
                        // ELO Badge
                        HStack(spacing: 4) {
                            Image(systemName: "trophy.fill")
                                .font(.system(size: 10))
                            Text(eloRangeLabel)
                        }
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(DSColor.accent) // Royal Blue
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(DSColor.accentMuted)) // Soft Royal Blue wash
                        
                        if let km = game.distance_km {
                            Text(String(format: "%.1f km", km))
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(DSColor.textTertiary)
                        }
                    }
                }
                
                Divider().overlay(DSColor.border.opacity(0.3))
                
                // Footer (Social Avatars + Capacity Bar)
                HStack(spacing: 12) {
                    AvatarStack(count: game.participants_count, hostName: game.host_display_name)
                    
                    Spacer()
                    
                    HStack(spacing: 8) {
                        Text(verbatim: "\(game.participants_count)/\(game.capacity)")
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundStyle(DSColor.textSecondary)
                        
                        capacityProgressBar
                            .frame(width: 60)
                        
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .heavy))
                            .foregroundStyle(DSColor.textTertiary)
                    }
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous)
                    .fill(DSColor.surface)
                    .shadow(color: Color.black.opacity(0.03), radius: 8, x: 0, y: 4)
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
            // Glowing left border stripe for the host's own games using brand gradient
            .overlay(alignment: .leading) {
                if isHost {
                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: [DSColor.accent, DSColor.secondary],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(width: 4)
                        .padding(.vertical, 1)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var sportBadge: some View {
        let (label, symbol, color): (String, String, Color) = {
            switch game.sport_slug {
            case "padel":
                return (String(localized: "matches.sport.padel"), "🎾", DSColor.accentMuted)
            case "football_5":
                return (String(localized: "matches.sport.football_5"), "⚽", DSColor.secondaryMuted)
            default:
                return (game.sport_slug.capitalized, "🏆", DSColor.surfaceElevated)
            }
        }()
        return HStack(spacing: 4) {
            Text(symbol)
                .font(.system(size: 10))
            Text(label)
                .font(.system(size: 9, weight: .heavy, design: .rounded))
        }
        .foregroundStyle(DSColor.textPrimary)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Capsule().fill(color))
    }

    private var timeHeadlineView: some View {
        HStack(spacing: 4) {
            Image(systemName: "calendar")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(DSColor.accent)
            Text(timeHeadline)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(DSColor.textSecondary)
        }
    }

    private var capacityProgressBar: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(DSColor.border.opacity(0.4))
                Capsule().fill(DSColor.accent)
                    .frame(width: geo.size.width * fillFraction)
            }
        }
        .frame(height: 4)
    }

    private var fillFraction: CGFloat {
        guard game.capacity > 0 else { return 0 }
        return max(0.05, min(1.0, CGFloat(game.participants_count) / CGFloat(game.capacity)))
    }

    private var venueText: String {
        let venue = game.venue_name?.trimmingCharacters(in: .whitespaces) ?? ""
        return venue.isEmpty ? String(localized: "matches.venue.tbd") : venue
    }

    private var eloRangeLabel: String {
        guard let minElo = game.skill_min_elo, let maxElo = game.skill_max_elo else {
            return String(localized: "matches.skill.any")
        }
        return "\(minElo) - \(maxElo) ELO"
    }

    private var timeHeadline: String {
        guard let date = Date.fromISO(game.starts_at) else { return game.starts_at }
        let cal = Calendar.current
        let f = DateFormatter()
        f.locale = .current
        if cal.isDateInToday(date) {
            f.dateFormat = "HH:mm"
            return String(format: String(localized: "matches.time.today_at_format"), f.string(from: date))
        }
        if cal.isDateInTomorrow(date) {
            f.dateFormat = "HH:mm"
            return String(format: String(localized: "matches.time.tomorrow_at_format"), f.string(from: date))
        }
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: date)
    }

    private func tap() {
        UISelectionFeedbackGenerator().selectionChanged()
        onTap()
    }
}

// MARK: - Overlapping Social Avatar Stack

private struct AvatarStack: View {
    let count: Int
    let hostName: String

    var body: some View {
        HStack(spacing: -6) {
            // Glowing lime circle for host (incorporating secondary brand color with accent text)
            avatarCircle(initials(hostName), color: DSColor.secondary, textColor: DSColor.accent)
            
            // Other players (using accentMuted soft blue wash background)
            if count > 1 {
                ForEach(1..<min(4, count), id: \.self) { i in
                    avatarCircle("\(i + 1)", color: DSColor.accentMuted, textColor: DSColor.textSecondary)
                }
            }
            
            // overflow bubble
            if count > 4 {
                avatarCircle("+\(count - 4)", color: DSColor.surfaceElevated, textColor: DSColor.textPrimary)
            }
        }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ")
        if let first = parts.first?.first, let last = parts.last?.first, parts.count > 1 {
            return "\(first)\(last)".uppercased()
        }
        return String(name.prefix(2)).uppercased()
    }

    private func avatarCircle(_ text: String, color: Color, textColor: Color) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .heavy, design: .rounded))
            .foregroundStyle(textColor)
            .frame(width: 22, height: 22)
            .background(Circle().fill(color))
            .overlay(Circle().stroke(DSColor.background, lineWidth: 1.5))
    }
}
