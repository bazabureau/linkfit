import SwiftUI

/// "People you may know" carousel of suggestion cards — rendered above
/// the players list on PlayersView and as a discovery rail on HomeView.
/// Self-managing: handles its own fetch on first appear, hides silently
/// on empty/loading-then-empty, and bubbles tap intent (avatar or name)
/// up via `onTapUser` so the host can route to the player's profile.
///
/// Two layouts ship from the same view:
///   * `.section` (default) — the PlayersView treatment. Inline section
///      header rendered inside the scroll, 140pt cards, no dismiss
///      control. Caption is the shared-games count caption.
///   * `.rail` — the HomeView treatment. Compact title + small "x"
///      dismiss on the right, 120pt cards, skill-level chip, one-line
///      reasoning line ("X oyun birgə" / "Eyni səviyyə"), follow pill at
///      the bottom. Tapping follow animates the card sliding out.
///
/// Visual language matches the existing PlayerRowCard / glass aesthetic:
/// rounded ultraThinMaterial cards with a faint border, lime accent on
/// the primary action, the same circular avatar fallback (initials over
/// gradient).
///
/// The carousel deliberately does NOT render its own section header
/// inside the scroll view in `.section` mode — the host (PlayersView)
/// renders the title above the carousel so it aligns with the page's
/// other section breaks. We keep the empty-state silent (`EmptyView`)
/// rather than rendering "No suggestions" copy; a blank space would be
/// more distracting than absence.
struct SuggestedFollowsView: View {
    @State var viewModel: SuggestedFollowsViewModel
    /// Tapping a card (avatar or name) routes here. The host decides
    /// whether to push, present, or no-op; we just hand back the id.
    let onTapUser: (String) -> Void

    /// Visual treatment — picks the host-specific copy and card size.
    /// Default `.section` preserves the original PlayersView behaviour
    /// (no API churn for that call site).
    var layout: Layout = .section

    /// Optional dismiss handler — only invoked from the `.rail` layout
    /// when the user taps the small "x" in the rail header. Hosts that
    /// don't want a dismiss control pass `nil` (the icon is hidden).
    var onDismiss: (() -> Void)? = nil

    enum Layout {
        case section  // PlayersView — large card, big title, no dismiss
        case rail     // HomeView — compact card, dismissable, skill chip
    }

    var body: some View {
        content
            .task { await viewModel.loadIfNeeded() }
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
    }

    // MARK: - Layout

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .empty:
            // Idle = haven't fetched yet, briefly shown before the
            // .task fires. Empty = server returned zero items, or a
            // follow action drained the last card. Both should
            // collapse the carousel to nothing — the host's VStack
            // simply skips the row.
            EmptyView()
        case .loading:
            loadingStrip
        case .error:
            // Silent on error — surfacing a "Couldn't load suggestions"
            // banner above the main list would be too loud for a
            // peripheral feature. The user can still scroll to the
            // canonical list below. Telemetry agent can wire a
            // breadcrumb here later.
            EmptyView()
        case .loaded(let items):
            switch layout {
            case .section:
                sectionTitle
                carousel(items: items)
            case .rail:
                VStack(alignment: .leading, spacing: 8) {
                    railHeader
                    carousel(items: items)
                }
            }
        }
    }

    /// `.section` header — "Tanış ola biləcəklərin" / "People you may
    /// know". Rendered inline with the carousel rather than by the host
    /// so `SuggestedFollowsHook.makeCarousel` ships a single
    /// "drop-in-everything" view instead of forcing every host to
    /// duplicate the heading.
    private var sectionTitle: some View {
        Text("suggested.title")
            .font(DSType.cardTitle)
            .foregroundStyle(DSColor.textPrimary)
            .padding(.horizontal, 2)
    }

    /// `.rail` header — different AZ-first copy ("Tanış olmaq istəyə
    /// bilərsən") plus an optional dismiss "x" on the right. Kept inside
    /// this view (rather than the host) so a future surface gets the
    /// same chrome for free.
    private var railHeader: some View {
        HStack(spacing: 8) {
            Text("home.suggested.rail.title")
                .font(.system(size: 18, weight: .heavy, design: .default))
                .foregroundStyle(DSColor.textPrimary)
            Spacer()
            if let onDismiss {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    onDismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(DSColor.textSecondary)
                        .padding(8)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("home.suggested.rail.dismiss"))
            }
        }
        .padding(.horizontal, DSSpacing.md)
    }

    /// Faint placeholder strip while we wait for the first response.
    /// Three glass rectangles roughly the size of a card so the layout
    /// doesn't pop when the real content slides in.
    private var loadingStrip: some View {
        let cardWidth: CGFloat = (layout == .rail) ? 120 : 140
        let cardHeight: CGFloat = (layout == .rail) ? 190 : 168
        return VStack(alignment: .leading, spacing: 8) {
            switch layout {
            case .section:
                sectionTitle
            case .rail:
                railHeader
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(DSColor.surface)
                            .frame(width: cardWidth, height: cardHeight)
                            .overlay(
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .strokeBorder(DSColor.border, lineWidth: 1)
                            )
                    }
                }
                .padding(.horizontal, layout == .rail ? DSSpacing.md : 2)
            }
        }
    }

    private func carousel(items: [SuggestedFollowItem]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(items) { item in
                    SuggestedFollowCard(
                        item: item,
                        layout: layout,
                        onTap: { onTapUser(item.user_id) },
                        onFollow: {
                            // `.rail` cards animate the slide-out
                            // before the follow lands — the view-model
                            // already drops the item from the loaded
                            // array, so wrapping the call in
                            // `withAnimation` is enough to get the
                            // adjacent cards to glide into the freed
                            // slot rather than jump. `.section` keeps
                            // the original non-animated removal so the
                            // PlayersView treatment doesn't get a
                            // surprise UX change.
                            if layout == .rail {
                                Task {
                                    withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                                        // Trigger via the VM — animation
                                        // is applied to the state
                                        // change made inside.
                                    }
                                    await viewModel.follow(item: item)
                                }
                            } else {
                                Task { await viewModel.follow(item: item) }
                            }
                        }
                    )
                    .transition(.asymmetric(
                        insertion: .opacity,
                        removal: .move(edge: .leading).combined(with: .opacity)
                    ))
                }
            }
            .padding(.horizontal, layout == .rail ? DSSpacing.md : 2)
            .animation(.spring(response: 0.35, dampingFraction: 0.85), value: items.map(\.id))
        }
    }
}

// MARK: - Card

/// One card in the carousel. Stateless — it reflects the prop and
/// signals tap intent upward. Width is fixed so two-and-a-half cards
/// peek at typical phone widths (a soft cue that the row scrolls
/// horizontally) without us needing a GeometryReader.
private struct SuggestedFollowCard: View {
    let item: SuggestedFollowItem
    let layout: SuggestedFollowsView.Layout
    var onTap: () -> Void
    var onFollow: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            avatar
            VStack(spacing: 4) {
                Text(item.display_name)
                    .font(DSType.bodyStrong)
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                    .multilineTextAlignment(.center)
                if layout == .rail {
                    skillChip
                    Text(reasoningCaption)
                        .font(DSType.caption2)
                        .foregroundStyle(DSColor.textSecondary)
                        .lineLimit(1)
                        .multilineTextAlignment(.center)
                } else {
                    Text(sharedGamesCaption)
                        .font(DSType.caption2)
                        .foregroundStyle(DSColor.textSecondary)
                        .lineLimit(1)
                        .multilineTextAlignment(.center)
                }
            }
            followButton
        }
        .padding(12)
        .frame(width: cardWidth)
        .dsSurfaceCard(radius: 16)
        .contentShape(Rectangle())
        // Tap on the whole card body routes to the profile.
        // The follow button below has its own gesture and consumes
        // the tap before this fires (SwiftUI propagates inner→outer).
        .onTapGesture {
            UISelectionFeedbackGenerator().selectionChanged()
            onTap()
        }
    }

    /// 120pt rail cards keep the row scannable on home (alongside
    /// stories + clubs) while the legacy 140pt section cards give
    /// PlayersView extra room for the games-together caption.
    private var cardWidth: CGFloat {
        switch layout {
        case .rail:    return 120
        case .section: return 140
        }
    }

    // MARK: Avatar

    private var avatar: some View {
        let url: URL? = {
            guard let raw = item.photo_url, !raw.hasPrefix("data:") else { return nil }
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
        .frame(width: 56, height: 56)
        .clipShape(Circle())
        .overlay(
            Circle().strokeBorder(DSColor.border, lineWidth: 1)
        )
    }

    private var initialsCircle: some View {
        ZStack {
            Circle()
                .fill(LinearGradient(
                    colors: [DSColor.accent.opacity(0.7), DSColor.accent.opacity(0.4)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                ))
            Text(initials)
                .font(.system(size: 20, weight: .heavy))
                .foregroundStyle(DSColor.textOnAccent)
        }
    }

    private var initials: String {
        let parts = item.display_name.split(separator: " ").prefix(2)
        return parts.map { $0.prefix(1).uppercased() }.joined()
    }

    // MARK: Captions / chips

    /// "X oyun birgə" / "X games together" / "X игр вместе" —
    /// pulled from the localized format string so plural handling
    /// stays consistent with the rest of the app.
    private var sharedGamesCaption: String {
        String.localizedStringWithFormat(
            NSLocalizedString("suggested.games_format", comment: ""),
            item.shared_games_count
        )
    }

    /// One-line "why this card is here" for the rail variant. v1 only
    /// has shared-games as a real signal (the backend `reason` enum
    /// emits only `"played_together"`), so we surface that count when
    /// it's positive. If the count is zero — which shouldn't happen
    /// per the backend's `shared_games_count: positive()` validator
    /// but is defensive — we fall back to a "same skill level" line
    /// so the card still earns a reason to exist. When more reasons
    /// are added on the wire (mutual friends, same city, etc.) the
    /// switch below picks them up.
    private var reasoningCaption: String {
        if item.shared_games_count > 0 {
            return sharedGamesCaption
        }
        return String(localized: "home.suggested.reason.same_skill")
    }

    /// Compact skill-level pill rendered on rail cards. The backend
    /// already emits a `skill_level` enum (`beginner`/`intermediate`/
    /// `advanced`/`expert`) but our wire type drops it; we compute the
    /// same bucket client-side from `primary_elo` via the canonical
    /// helper so the chip stays consistent with PlayerRowCard and
    /// ProfileView.
    private var skillChip: some View {
        let level = SkillLevel.from(elo: item.primary_elo)
        return HStack(spacing: 4) {
            Image(systemName: level.systemImage)
                .font(.system(size: 9, weight: .heavy))
            Text(level.labelKey)
                .font(.system(size: 10, weight: .heavy, design: .default))
        }
        .foregroundStyle(level.accent)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Capsule().fill(level.accent.opacity(0.12)))
        .overlay(Capsule().strokeBorder(level.accent.opacity(0.35), lineWidth: 0.5))
    }

    // MARK: Follow button

    private var followButton: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            onFollow()
        } label: {
            Text("suggested.action.follow")
                .font(DSType.badge)
                .foregroundStyle(DSColor.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(Capsule().fill(DSColor.surfaceElevated))
                .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
