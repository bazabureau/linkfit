import SwiftUI

/// Top-N padel players by ELO.
///
/// Hosted inside a `NavigationStack` by the parent (e.g. the
/// tab shell). The view never pushes profiles itself — instead
/// it surfaces an `onTapPlayer: (String) -> Void` so the host
/// can decide whether to push a `ProfileView` onto its stack
/// or present a sheet (matches the `RankingsView` /
/// `onPickPlayer` convention used elsewhere in the app).
///
/// UI shape:
///   * Inline native nav title ("leaderboards.title") with a
///     transparent toolbar so the premium background bleeds
///     through (iOS 18 stock pattern).
///   * Subtitle pill rendered below the title in the content
///     area (rather than as a large title) — keeps the bar
///     compact and gives us full control over typography.
///   * Each row is a glass card with a rank badge, avatar
///     (with initials fallback), name + secondary stats, and
///     a monospaced ELO score.
///   * Top-3 rows are sized slightly larger and tinted with
///     gold/silver/bronze for the podium feel.
///   * Pull-to-refresh on the outer ScrollView, infinite
///     scroll via `.task(id:)` on the last visible row.
///
/// Wave-9 — three filter chips sit between the subtitle and the
/// list: scope (Şəhər/Qlobal), period (Həftə/Ay/Hamısı), and a
/// skill-level menu (All + 4 buckets). Each tap fires the
/// matching `setScope`/`setSkill`/`setPeriod` on the view model
/// which cancels the in-flight task and refetches offset=0.
struct LeaderboardsView: View {
    @State var viewModel: LeaderboardsViewModel
    /// Tap handler — defaults to a no-op so the view can be pushed as a
    /// pure destination (e.g. from ProfileView's "Liderlər" button) without
    /// every host having to thread a routing closure. Hosts that DO want
    /// profile navigation pass the handler explicitly.
    var onTapPlayer: (String) -> Void = { _ in }

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            ScrollView {
                LazyVStack(spacing: DSSpacing.xs) {
                    header
                        .padding(.horizontal, DSSpacing.md)
                        .padding(.bottom, DSSpacing.xs)
                    filterStrip
                        .padding(.horizontal, DSSpacing.md)
                        .padding(.bottom, DSSpacing.sm)
                    content
                    Spacer().frame(height: 120) // tab-bar inset
                }
                .padding(.top, DSSpacing.sm)
            }
            .scrollIndicators(.hidden)
            .refreshable { await viewModel.refresh() }
        }
        .navigationTitle("leaderboards.title")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { await viewModel.onAppear() }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            Text("leaderboards.subtitle")
                .font(.system(.subheadline, design: .default, weight: .medium))
                .foregroundStyle(DSColor.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Filter strip (Wave-9)

    /// Three-axis filter row: scope segmented, period segmented, skill
    /// dropdown. The segmented controls are stock SwiftUI Pickers in
    /// `.segmented` style so they pick up the system tint and accessibility
    /// for free; the skill chip is a Menu because five options would
    /// overflow the row visually.
    private var filterStrip: some View {
        VStack(spacing: DSSpacing.xs) {
            // Scope — Şəhər vs Qlobal.
            SegmentedPicker(
                segments: [
                    (LeaderboardScope.city, String(localized: "leaderboards.scope.city" as String.LocalizationValue), Optional("building.2.fill")),
                    (LeaderboardScope.global, String(localized: "leaderboards.scope.global" as String.LocalizationValue), Optional("globe"))
                ],
                selection: Binding(
                    get: { viewModel.scope },
                    set: { next in Task { await viewModel.setScope(next) } }
                )
            )

            // Period — Həftə / Ay / Hamısı.
            SegmentedPicker(
                segments: [
                    (LeaderboardPeriod.week, String(localized: "leaderboards.period.week" as String.LocalizationValue), Optional("calendar.badge.clock")),
                    (LeaderboardPeriod.month, String(localized: "leaderboards.period.month" as String.LocalizationValue), Optional("calendar")),
                    (LeaderboardPeriod.all, String(localized: "leaderboards.period.all" as String.LocalizationValue), Optional("infinity"))
                ],
                selection: Binding(
                    get: { viewModel.period },
                    set: { next in Task { await viewModel.setPeriod(next) } }
                )
            )

            // Skill — five options collapsed into a Menu so the row stays
            // a single tap target on narrow screens.
            HStack(spacing: DSSpacing.xs) {
                Text("leaderboards.skill.label")
                    .font(.system(.caption, design: .default, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
                Spacer(minLength: 0)
                Menu {
                    ForEach(LeaderboardSkillFilter.allCases) { filter in
                        Button {
                            Task { await viewModel.setSkill(filter) }
                        } label: {
                            HStack {
                                Text(skillLabelKey(filter))
                                if filter == viewModel.skillFilter {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text(skillLabelKey(viewModel.skillFilter))
                            .font(.system(.subheadline, design: .default, weight: .heavy))
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .heavy))
                    }
                    .foregroundStyle(DSColor.accent)
                    .padding(.horizontal, DSSpacing.sm)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(DSColor.accent.opacity(0.14)))
                    .overlay(Capsule().strokeBorder(DSColor.accent.opacity(0.4), lineWidth: 1))
                }
            }
        }
    }

    /// Map the skill enum onto its existing localization key. Reuses
    /// `players.filter.skill.*` since the wording is identical and we
    /// don't want two parallel sets of translations to drift.
    private func skillLabelKey(_ filter: LeaderboardSkillFilter) -> LocalizedStringKey {
        switch filter {
        case .all:          return "players.filter.skill.any"
        case .beginner:     return "players.filter.skill.beginner"
        case .intermediate: return "players.filter.skill.intermediate"
        case .advanced:     return "players.filter.skill.advanced"
        case .expert:       return "players.filter.skill.expert"
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(label: nil)
                .frame(height: 280)
        case .loaded(let items):
            list(items: items)
        case .empty:
            EmptyStateView(
                icon: "trophy",
                title: String(localized: "leaderboards.empty.title"),
                message: String(localized: "leaderboards.empty.message")
            )
            .frame(minHeight: 320)
        case .error(let message):
            ErrorStateView(message: message) {
                Task { await viewModel.refresh() }
            }
            .frame(minHeight: 320)
        }
    }

    private func list(items: [LeaderboardEntry]) -> some View {
        LazyVStack(spacing: DSSpacing.xs) {
            ForEach(items) { item in
                Button {
                    Haptics.selection()
                    onTapPlayer(item.user_id)
                } label: {
                    LeaderboardRow(item: item, isPodium: item.rank <= 3)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, DSSpacing.md)
                .task(id: item.id) {
                    // Infinite-scroll trigger — fires when the row
                    // first appears. The VM no-ops on intermediate
                    // rows; only the last visible row drives a fetch.
                    await viewModel.loadMoreIfNeeded(currentItem: item)
                }
            }

            if viewModel.isLoadingMore {
                ProgressView()
                    .tint(DSColor.accent)
                    .padding(.vertical, DSSpacing.md)
            }
        }
    }
}

// MARK: - Row

private struct LeaderboardRow: View {
    let item: LeaderboardEntry
    let isPodium: Bool

    /// 36pt for the rest of the list, 44pt for the top-3 podium —
    /// big enough to feel "premium" but not so chunky that the
    /// rows visually crowd each other.
    private var avatarSize: CGFloat { isPodium ? 52 : 40 }
    private var rankBadgeSize: CGFloat { isPodium ? 44 : 36 }
    private var vPadding: CGFloat { isPodium ? DSSpacing.md : DSSpacing.sm }

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            rankBadge
            avatar
            VStack(alignment: .leading, spacing: 2) {
                Text(item.display_name)
                    .font(.system(isPodium ? .body : .subheadline,
                                  design: .default,
                                  weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    // Skill chip — small inline capsule next to the
                    // secondary line so the bucket is legible even on
                    // smaller rows.
                    let level = resolvedSkill
                    Text(level.labelKey)
                        .font(.system(.caption2, design: .default, weight: .heavy))
                        .foregroundStyle(level.accent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(level.accent.opacity(0.14)))
                    Text(secondaryLine)
                        .font(.system(.caption, design: .default))
                        .foregroundStyle(DSColor.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: DSSpacing.xs)
            // Trailing: "N qələbə" — Wave-9 product copy. The exact wins
            // integer lives on the API response (`games_won`); we fall
            // back to a win_rate × games_played approximation for older
            // payloads that pre-date the field.
            VStack(alignment: .trailing, spacing: 2) {
                Text(String(format: String(localized: "leaderboards.row.wins_format"),
                            resolvedWins))
                    .font(.system(isPodium ? .subheadline : .footnote,
                                  design: .default,
                                  weight: .heavy))
                    .foregroundStyle(DSColor.accent)
                    .monospacedDigit()
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, vPadding)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .strokeBorder(borderColor, lineWidth: isPodium ? 1.5 : 1)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(.isButton)
    }

    /// Server-supplied skill bucket when present; falls back to the local
    /// ELO mapping so older payloads still render the correct label.
    private var resolvedSkill: SkillLevel {
        if let raw = item.skill_level, let level = SkillLevel(rawValue: raw) {
            return level
        }
        return SkillLevel.from(elo: item.elo_rating)
    }

    /// Wins count surfaced in the trailing cell. Defaults to a derived
    /// integer when the server payload omits `games_won` (pre-Wave-9
    /// responses).
    private var resolvedWins: Int {
        if let won = item.games_won { return won }
        return Int((Double(item.games_played) * item.win_rate).rounded())
    }

    // MARK: Sub-views

    /// Rank badge — medal SF Symbol tinted with the semantic medal tokens
    /// for the podium (gold/silver/bronze), a numeric badge with a
    /// trailing dot ("4.", "5.") for everyone else. The Apple HIG
    /// convention for ordered lists in casual surfaces uses the dot to
    /// imply ordinal, which is what product asked for.
    @ViewBuilder
    private var rankBadge: some View {
        switch item.rank {
        case 1:
            medalCell(tint: DSColor.medalGold)
        case 2:
            medalCell(tint: DSColor.medalSilver)
        case 3:
            medalCell(tint: DSColor.medalBronze)
        default:
            Text("\(item.rank).")
                .font(.system(.subheadline, design: .default, weight: .heavy))
                .foregroundStyle(DSColor.textSecondary)
                .frame(width: rankBadgeSize, height: rankBadgeSize)
                .background(Circle().fill(DSColor.surfaceElevated))
        }
    }

    /// Reusable medal cell — circle wash with a tinted `medal.fill` glyph
    /// centered. Rendered a touch smaller than the badge so it has visual
    /// breathing room on both light and dark canvases.
    private func medalCell(tint: Color) -> some View {
        ZStack {
            Circle()
                .fill(tint.opacity(0.20))
                .overlay(Circle().strokeBorder(tint.opacity(0.35), lineWidth: 1))
            Image(systemName: "medal.fill")
                .font(.system(size: rankBadgeSize * 0.45, weight: .semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
        }
        .frame(width: rankBadgeSize, height: rankBadgeSize)
    }

    @ViewBuilder
    private var avatar: some View {
        let url = item.photo_url.flatMap(URL.init(string:))
        ZStack {
            Circle()
                .fill(LinearGradient(
                    colors: [DSColor.accent, DSColor.accentSoft],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
            CachedAsyncImage(url: url) { phase in
                if let image = phase.image {
                    image
                        .resizable()
                        .scaledToFill()
                } else {
                    // `.empty` and `.failure` both fall through to
                    // initials, which is the right behavior for an
                    // avatar — there's no value in showing a broken-
                    // image placeholder.
                    Text(initials(item.display_name))
                        .font(.system(.callout, design: .default, weight: .bold))
                        .foregroundStyle(DSColor.textOnAccent)
                }
            }
        }
        .frame(width: avatarSize, height: avatarSize)
        .clipShape(Circle())
    }

    // MARK: Styling helpers

    private var borderColor: Color {
        switch item.rank {
        case 1: return DSColor.medalGold.opacity(0.55)
        case 2: return DSColor.medalSilver.opacity(0.55)
        case 3: return DSColor.medalBronze.opacity(0.55)
        default: return DSColor.border
        }
    }

    // MARK: Strings

    /// "X oyun · Y% qələbə" — `win_rate` arrives in [0,1] and we
    /// render it as a whole-percent integer for compactness. Kept as the
    /// caption next to the skill chip so the row still surfaces the full
    /// stat trio (skill bucket / games / win%) at a glance.
    private var secondaryLine: String {
        let winPct = Int((item.win_rate * 100).rounded())
        return String(format: String(localized: "leaderboards.row.games_format"),
                      item.games_played,
                      winPct)
    }

    private var accessibilityLabel: String {
        let winPct = Int((item.win_rate * 100).rounded())
        // Composed from a positional, localized format so screen readers
        // get a coherent sentence in the user's language rather than three
        // disjoint hardcoded-English labels. Order: name, rank, skill,
        // games, wins, win%.
        return String(
            format: String(localized: "leaderboards.row.a11y_format"),
            item.display_name,
            item.rank,
            resolvedSkill.localizedName,
            item.games_played,
            resolvedWins,
            winPct
        )
    }

    private func initials(_ name: String) -> String {
        let parts = name
            .split(separator: " ")
            .prefix(2)
            .map { $0.prefix(1).uppercased() }
        let joined = parts.joined()
        return joined.isEmpty ? "?" : joined
    }
}
