import SwiftUI
import MapKit

struct GameDetailView: View {
    @State var viewModel: GameDetailViewModel
    @Environment(AppContainer.self) private var container
    @State private var showRating = false
    @State private var confirmCancel = false
    @State private var confirmLeave = false
    @State private var showShare = false
    @State private var showScoring = false
    // Wave-11 host actions. The overflow "..." menu surfaces Cancel
    // and Reschedule as first-class items distinct from the inline
    // action bar button. `showCancelSheet` drives a small reason-
    // capture dialog (the backend forwards the reason into push
    // notifications); `showRescheduleSheet` drives `RescheduleGameSheet`.
    @State private var showCancelSheet = false
    @State private var cancelReason: String = ""
    @State private var showRescheduleSheet = false
    /// Pre-rendered story image presented through the share sheet once the
    /// `MatchResultCard(variant: .story)` finishes rasterising. Non-nil
    /// drives the `.sheet(item:)` below — the Story Creator from the
    /// parallel Stories module isn't wired up yet, so we fall back to
    /// `UIActivityViewController` so the user can still hand the image to
    /// Instagram / Telegram / Photos in the meantime.
    @State private var storyImagePayload: StoryImagePayload?
    /// Set while the SwiftUI → UIImage rasterisation is in flight so the
    /// toolbar button can show a progress indicator (and we ignore double
    /// taps from impatient fingers).
    @State private var isRenderingStory = false
    /// Participant the host has selected for the "Mark as no-show"
    /// flow. Non-nil drives the `.confirmationDialog` below — once
    /// the host confirms, we read `user_id` / `display_name` off it
    /// to fire the API and shape the prompt copy.
    @State private var noShowTarget: Participant?
    /// Set when a non-host viewer taps the trailing "..." menu and picks
    /// "Şikayət et". Drives the shared `.reportSheet` modifier mounted
    /// at the bottom of this view tree.
    @State private var reportPayload: ReportTargetPayload?
    @State private var groupConversationId: String?

    var body: some View {
        ZStack {
            // Mesh-gradient backdrop, matching home / matches /
            // tournaments / profile. Previously this used a flat
            // `DSColor.background` which made game detail feel like a
            // different surface than the rest of the app.
            PremiumAuthBackground()
            content
        }
        .navigationTitle(Text("game.title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { trailingToolbar }
        .task { await viewModel.load() }
        .refreshable { await viewModel.load() }
        .sheet(isPresented: $showRating) {
            if case .loaded(let game) = viewModel.state, let me = container.currentUser?.id {
                RatingFlowView(
                    viewModel: RatingFlowViewModel(
                        apiClient: container.apiClient,
                        gameId: game.id,
                        coplayers: game.participants.filter { $0.user_id != me && $0.status != .cancelled }
                    )
                ) {
                    showRating = false
                    Task { await viewModel.load() }
                }
            }
        }
        .sheet(isPresented: $showShare) {
            if case .loaded(let game) = viewModel.state {
                ShareSheet(items: [shareString(for: game)])
            }
        }
        // TODO(wiring): present StoryCreator(preset: rendered) — the
        // Stories module is being built in parallel. Swapping the body of
        // this `.sheet` for `StorySharePreviewSheet(image: payload.image)`
        // wires the pre-rendered game cards to the native Stories flow.
        .sheet(item: $storyImagePayload) { payload in
            StorySharePreviewSheet(image: payload.image)
        }
        // Live scoring is presented as a full-screen cover (not a
        // sheet) because court-side use needs maximum vertical space
        // for the score buttons. Closing it triggers a `viewModel.load`
        // so any status changes (e.g. `completed` after finalize)
        // propagate back to the action bar.
        .fullScreenCover(isPresented: $showScoring, onDismiss: {
            Task { await viewModel.load() }
        }) {
            if case .loaded(let game) = viewModel.state {
                NavigationStack {
                    LiveScoringView(
                        viewModel: LiveScoringViewModel(
                            apiClient: container.apiClient,
                            gameId: game.id,
                            hostUserId: game.host_user_id,
                            currentUserId: container.currentUser?.id,
                            participants: game.participants
                        )
                    )
                }
            }
        }
        .confirmationDialog(
            Text("game.confirm.cancel.title"),
            isPresented: $confirmCancel,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
                Task { await viewModel.cancel() }
            } label: { Text("game.action.cancel") }
            Button(role: .cancel) {} label: { Text("common.keep") }
        } message: {
            Text("game.confirm.cancel.message")
        }
        .confirmationDialog(
            Text("game.confirm.leave.title"),
            isPresented: $confirmLeave,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
                Task { await viewModel.leave() }
            } label: { Text("game.action.leave") }
            Button(role: .cancel) {} label: { Text("common.keep") }
        } message: {
            Text("game.confirm.leave.message")
        }
        // Host-only "Mark as no-show" confirmation. Bound to the
        // `noShowTarget` participant so the dialog can show the
        // player's name in its message — pressing the destructive
        // action fires the API and clears the target. Cancel just
        // clears it. The dialog itself is shared across the whole
        // participants list, which is why it lives at the screen
        // root rather than inside the row.
        .confirmationDialog(
            Text("game.confirm.no_show.title"),
            isPresented: Binding(
                get: { noShowTarget != nil },
                set: { if !$0 { noShowTarget = nil } }
            ),
            titleVisibility: .visible,
            presenting: noShowTarget
        ) { target in
            Button(role: .destructive) {
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
                let userId = target.user_id
                Task { await viewModel.markNoShow(userId: userId) }
                noShowTarget = nil
            } label: { Text("game.action.mark_no_show") }
            Button(role: .cancel) { noShowTarget = nil } label: { Text("common.keep") }
        } message: { target in
            Text(String(format: String(localized: "game.confirm.no_show.message_format"),
                        target.display_name))
        }
        // Action errors now surface as a transient alert on top of the
        // loaded game detail instead of replacing the screen with an
        // error state. The user can retry without re-navigating.
        .alert(
            Text("game.action.error.title"),
            isPresented: Binding(
                get: { viewModel.actionError != nil },
                set: { if !$0 { viewModel.clearActionError() } }
            ),
            presenting: viewModel.actionError
        ) { _ in
            Button(role: .cancel) { viewModel.clearActionError() } label: {
                Text("common.ok")
            }
        } message: { message in
            Text(message)
        }
        // Trust & safety sheet — mounted on the root view so it's not
        // disposed when intermediate sheets close. Driven by
        // `reportPayload` set from the trailing "..." menu.
        .reportSheet(payload: $reportPayload)
        // Wave-11 cancel-with-reason. Presented as an alert with a
        // single `TextField` instead of a `.confirmationDialog`
        // because the latter doesn't accept a `TextField` on iOS 18
        // — only buttons. Alerts do, since iOS 16. Reason is
        // optional: an empty submit still fires the cancel.
        .alert(
            Text("games.cancel.title"),
            isPresented: $showCancelSheet
        ) {
            TextField(
                String(localized: "games.cancel.reason.placeholder"),
                text: $cancelReason
            )
            .textInputAutocapitalization(.sentences)
            Button(role: .destructive) {
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
                let trimmed = cancelReason.trimmingCharacters(in: .whitespacesAndNewlines)
                let reason: String? = trimmed.isEmpty ? nil : trimmed
                Task {
                    let ok = await viewModel.cancelWithReason(reason)
                    if ok {
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        ToastCenter.shared.success(
                            String(localized: "games.cancel.success")
                        )
                    }
                    // Failure path: viewModel populated `actionError` and
                    // the existing `.alert(...)` modifier below
                    // ("game.action.error.title") will surface it.
                    cancelReason = ""
                }
            } label: { Text("games.cancel.confirm") }
            Button(role: .cancel) { cancelReason = "" } label: {
                Text("common.keep")
            }
        } message: {
            Text("game.confirm.cancel.message")
        }
        // Wave-11 reschedule sheet. Presented as a sheet (not a
        // full-screen cover) because the date/time pickers fit
        // comfortably in a sheet and the smaller surface makes the
        // host's role clearer — this is a quick edit, not a flow.
        .sheet(isPresented: $showRescheduleSheet) {
            if case .loaded(let game) = viewModel.state {
                RescheduleGameSheet(viewModel: viewModel, game: game)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
    }

    @ToolbarContentBuilder
    private var trailingToolbar: some ToolbarContent {
        // Share-to-Story sits to the LEFT of the generic share button.
        // It surfaces for two distinct moments:
        //   • completed games → renders `MatchResultCard` (existing
        //     Wave-7 behaviour, untouched).
        //   • open/full games the viewer has joined or hosts →
        //     renders a Wave-10 `GameJoinedCard` so the user can
        //     announce on IG Stories that they're playing. This is
        //     the viral growth-loop entry point.
        //
        // The rasterising state pulses an inline progress view so the
        // user knows the tap registered even if the 1080×1920 render
        // takes a beat on older devices.
        ToolbarItem(placement: .topBarTrailing) {
            if case .loaded(let game) = viewModel.state, shouldShowStoryShareButton(game) {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    Task { await renderStoryAndPresent(game) }
                } label: {
                    if isRenderingStory {
                        ProgressView()
                            .controlSize(.small)
                            .tint(DSColor.accent)
                    } else {
                        Image(systemName: "rectangle.portrait.on.rectangle.portrait.angled")
                            .foregroundStyle(DSColor.accent)
                    }
                }
                .disabled(isRenderingStory)
                .accessibilityLabel(Text("game.action.share_to_story"))
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            if case .loaded = viewModel.state {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    showShare = true
                } label: {
                    Image(systemName: "square.and.arrow.up")
                        .foregroundStyle(DSColor.accent)
                }
                .accessibilityLabel(Text("game.action.share"))
            }
        }
        // Trust & safety: non-host viewers get a "..." menu surfacing
        // "Şikayət et" so they can flag a suspicious game (fake venue,
        // host harassment, no-show pattern). Hidden for the host —
        // reporting your own game is meaningless and would only add
        // visual noise next to the share button.
        ToolbarItem(placement: .topBarTrailing) {
            if case .loaded(let game) = viewModel.state,
               let me = container.currentUser?.id,
               game.host_user_id != me {
                Menu {
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        reportPayload = ReportTargetPayload(
                            kind: .game,
                            targetId: game.id,
                            targetDisplayName: game.venue_name
                        )
                    } label: {
                        Label("reports.menu.report_game", systemImage: "flag")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .foregroundStyle(DSColor.accent)
                }
                .accessibilityLabel(Text("reports.menu.report_game"))
            }
        }
        // Wave-11 host overflow menu. Shown ONLY when the viewer is
        // the host AND the game is still cancellable / reschedulable
        // (status `.open` + start time still in the future). The same
        // menu intentionally keeps the existing "Sil" (soft-delete)
        // affordance — Cancel and Sil mean different things: cancel
        // keeps the row visible to participants with status
        // `cancelled`, while delete removes the game from every read
        // path. Hosts can pick whichever matches the situation.
        ToolbarItem(placement: .topBarTrailing) {
            if case .loaded(let game) = viewModel.state,
               viewModel.isHost,
               canHostManage(game) {
                Menu {
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        // Clear any stale action error before presenting
                        // the sheet so the parent's `.alert(...)` doesn't
                        // pre-fire over the sheet from an earlier flow
                        // (cancel, leave, etc.) — that race made the
                        // reschedule sheet feel like it failed before
                        // the user even interacted with it.
                        viewModel.clearActionError()
                        showRescheduleSheet = true
                    } label: {
                        Label("games.action.reschedule",
                              systemImage: "calendar.badge.clock")
                    }
                    Button(role: .destructive) {
                        UISelectionFeedbackGenerator().selectionChanged()
                        viewModel.clearActionError()
                        cancelReason = ""
                        showCancelSheet = true
                    } label: {
                        Label("games.action.cancel",
                              systemImage: "xmark.circle")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundStyle(DSColor.accent)
                }
                .accessibilityLabel(Text("games.action.reschedule"))
            }
        }
    }

    /// True when the host can still cancel or reschedule the game.
    /// Hides the menu for already-cancelled / completed games (the
    /// backend would reject the calls anyway) and for games whose
    /// `starts_at` already slid into the past — the backend rejects
    /// reschedule + cancel of started games with a 422.
    private func canHostManage(_ game: GameDetail) -> Bool {
        guard game.status == .open || game.status == .full else { return false }
        guard let starts = Date.fromISO(game.starts_at) else { return false }
        return starts > Date()
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView()
        case .empty:
            EmptyStateView(
                icon: "questionmark.circle",
                title: String(localized: "game.detail.empty.title"),
                message: String(localized: "game.detail.empty.message")
            )
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
        case .loaded(let game):
            loaded(game)
        }
    }

    private func loaded(_ game: GameDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.md) {
                header(game)
                // Completed games lead with the final-result banner — it's
                // the answer to "what happened?" that everyone returning
                // to this screen actually wants. Pre-match the same slot
                // shows the countdown.
                if game.status == .completed, let score = viewModel.matchScore {
                    FinalResultCard(
                        score: score,
                        participants: game.participants,
                        myTeam: viewModel.myTeam,
                        eloDelta: nil
                    )
                } else {
                    countdownBar(game)
                }
                miniMap(game)
                detailsCard(game)
                participantsCard(game)
                actionBar(game)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.bottom, DSSpacing.xl)
            // Cap reading measure on iPad — body copy + cards stretch past
            // the comfortable line length on a 13" canvas otherwise. No-op
            // on iPhone portrait.
            .maxWidthConstrained()
        }
    }

    // MARK: - Sections

    private func header(_ game: GameDetail) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            HStack(spacing: DSSpacing.xs) {
                Image(systemName: game.sport_slug == "padel" ? "figure.tennis" : "sportscourt")
                    .foregroundStyle(DSColor.accent)
                Text(sportLabel(game.sport_slug))
                    .font(DSType.bodyEmphasis)
                Spacer()
                statusPill(game.status)
            }
            Text(formatStart(game.starts_at))
                .font(DSType.displayMedium)
                .foregroundStyle(DSColor.textPrimary)
            if let venue = game.venue_name {
                HStack(spacing: 4) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DSColor.textSecondary)
                    Text(venue)
                        .font(DSType.body)
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
        }
        .padding(.top, DSSpacing.sm)
    }

    @ViewBuilder
    private func countdownBar(_ game: GameDetail) -> some View {
        // Use the centralised parser — the bare `ISO8601DateFormatter()`
        // doesn't accept the fractional-seconds form the backend emits,
        // so this would silently fail to render the bar for every game.
        if let date = Date.fromISO(game.starts_at) {
            let countdown = countdownLabel(to: date)
            HStack(spacing: DSSpacing.xs) {
                Image(systemName: countdownIcon(to: date))
                    .foregroundStyle(DSColor.accent)
                Text(countdown)
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                Spacer()
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.vertical, DSSpacing.sm)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(DSColor.accentMuted)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(DSColor.accent.opacity(0.30), lineWidth: 1)
            )
        }
    }

    private func miniMap(_ game: GameDetail) -> some View {
        let coord = CLLocationCoordinate2D(latitude: game.lat, longitude: game.lng)
        return Map(initialPosition: .region(MKCoordinateRegion(
            center: coord,
            span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
        ))) {
            Annotation(game.venue_name ?? "", coordinate: coord) {
                ZStack {
                    Circle().fill(DSColor.accent).frame(width: 18, height: 18)
                        .shadow(color: DSColor.accent.opacity(0.6), radius: 6)
                    Circle().strokeBorder(DSColor.textOnAccent, lineWidth: 2).frame(width: 18, height: 18)
                }
            }
        }
        .frame(height: 160)
        .clipShape(RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .allowsHitTesting(false)
    }

    private func detailsCard(_ game: GameDetail) -> some View {
        Card {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                row(
                    labelKey: "game.detail.duration",
                    value: String(format: String(localized: "game.detail.duration_minutes_format"), game.duration_minutes)
                )
                Divider().overlay(DSColor.border)
                row(
                    labelKey: "game.detail.players",
                    value: String(format: String(localized: "game.detail.players_count_format"), game.participants_count, game.capacity)
                )
                if let min = game.skill_min_elo, let max = game.skill_max_elo {
                    Divider().overlay(DSColor.border)
                    row(
                        labelKey: "game.detail.skill_range",
                        value: String(format: String(localized: "game.detail.skill_range_format"), min, max)
                    )
                }
                if let notes = game.notes, !notes.isEmpty {
                    Divider().overlay(DSColor.border)
                    VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                        Text("game.detail.notes")
                            .font(DSType.caption)
                            .foregroundStyle(DSColor.textSecondary)
                        Text(notes)
                            .font(DSType.body)
                            .foregroundStyle(DSColor.textPrimary)
                    }
                }
            }
        }
    }

    private func participantsCard(_ game: GameDetail) -> some View {
        // Hosts mark no-shows from a completed game. Non-host
        // participants (and games that aren't completed yet) skip
        // the affordance entirely so casual taps don't surface a
        // destructive action.
        let active = game.participants.filter { $0.status != .cancelled }
        let canMarkNoShow = viewModel.isHost && game.status == .completed
        return Card {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                HStack {
                    Text("game.detail.players")
                        .font(DSType.bodyEmphasis)
                        .foregroundStyle(DSColor.textPrimary)
                    Spacer()
                    Text(String(format: String(localized: "game.detail.players_count_format"),
                                game.participants_count, game.capacity))
                        .font(.system(.footnote, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }
                // Each active participant is a NavigationLink into the
                // host NavigationStack's `.profile(id)` destination. The
                // current user's profile already exposes the Follow /
                // Message actions, so this is the bridge from "I see
                // who's playing" to "I want to connect with them" — the
                // social flow the user explicitly asked to surface.
                ForEach(active) { p in
                    // Hosts get a long-press context menu on every
                    // non-host participant who isn't already flagged
                    // as `.no_show`. Context menu over swipe-actions
                    // because the row lives in a VStack — `.swipeActions`
                    // only fires inside a List, while `.contextMenu`
                    // works on any view.
                    let isSelf = p.user_id == game.host_user_id
                    let alreadyMarked = p.status == .no_show
                    let eligible = canMarkNoShow && !isSelf && !alreadyMarked
                    NavigationLink(value: HomeRoute.profile(p.user_id)) {
                        HStack(spacing: DSSpacing.sm) {
                            Circle()
                                .fill(LinearGradient(
                                    colors: [DSColor.accent, DSColor.accentSoft],
                                    startPoint: .topLeading, endPoint: .bottomTrailing
                                ))
                                .frame(width: 36, height: 36)
                                .overlay(
                                    Text(initials(p.display_name))
                                        .font(.system(.caption, design: .default, weight: .bold))
                                        .foregroundStyle(DSColor.textOnAccent)
                                )
                            VStack(alignment: .leading, spacing: 0) {
                                Text(p.display_name)
                                    .font(DSType.body)
                                    .foregroundStyle(DSColor.textPrimary)
                                if p.user_id == game.host_user_id {
                                    Text("game.detail.host")
                                        .font(.system(.caption2, design: .default, weight: .semibold))
                                        .foregroundStyle(DSColor.accent)
                                } else if alreadyMarked {
                                    // Visual breadcrumb so the host can tell
                                    // at a glance who's been flagged without
                                    // needing to re-open the menu.
                                    Text("game.detail.no_show_flag")
                                        .font(.system(.caption2, design: .default, weight: .semibold))
                                        .foregroundStyle(DSColor.danger)
                                }
                            }
                            Spacer()
                            // Affordance: a faint chevron tells the user
                            // the row is tappable. Without it the row
                            // looks like a static list item.
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .heavy))
                                .foregroundStyle(DSColor.textTertiary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(Text("game.detail.open_profile_hint"))
                    .contextMenu {
                        if eligible {
                            Button(role: .destructive) {
                                noShowTarget = p
                            } label: {
                                Label {
                                    Text("game.action.mark_no_show")
                                } icon: {
                                    Image(systemName: "person.fill.xmark")
                                }
                            }
                        }
                    }
                }
                if active.count < game.capacity {
                    let empty = game.capacity - active.count
                    ForEach(0..<empty, id: \.self) { _ in
                        HStack(spacing: DSSpacing.sm) {
                            Circle()
                                .strokeBorder(DSColor.border, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                                .frame(width: 36, height: 36)
                                .overlay(
                                    Image(systemName: "person.fill.questionmark")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(DSColor.textTertiary)
                                )
                            Text("game.detail.players")
                                .font(DSType.footnote)
                                .foregroundStyle(DSColor.textTertiary)
                            Spacer()
                        }
                        .opacity(0.55)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func actionBar(_ game: GameDetail) -> some View {
        VStack(spacing: DSSpacing.sm) {
            if viewModel.isParticipant {
                if let cid = groupConversationId {
                    NavigationLink(value: HomeRoute.groupThread(cid)) {
                        HStack(spacing: 8) {
                            Image(systemName: "bubble.left.and.bubble.right.fill")
                            Text("group_chat.open_for_game")
                                .font(.system(.subheadline, design: .default, weight: .semibold))
                        }
                        .foregroundStyle(DSColor.accent)
                        .padding(.horizontal, DSSpacing.md)
                        .padding(.vertical, DSSpacing.sm)
                        .background(Capsule().fill(DSColor.accent.opacity(0.12)))
                    }
                    .buttonStyle(.plain)
                } else {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small).tint(DSColor.accent)
                        Text("group_chat.open_for_game")
                            .font(.system(.subheadline, design: .default, weight: .semibold))
                    }
                    .foregroundStyle(DSColor.accent)
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.vertical, DSSpacing.sm)
                    .background(Capsule().fill(DSColor.accent.opacity(0.12)))
                    .task {
                        do {
                            groupConversationId = try await GroupConversationViewModel.resolveConversationId(
                                apiClient: container.apiClient,
                                kind: .game,
                                targetId: game.id
                            )
                        } catch {
                            // ignore
                        }
                    }
                }
            }

            // Live-scoring affordance — anyone in the match can open
            // the scoring sheet. Visible from "full" (game starting)
            // through "completed" so participants can record and
            // verify the result. After completion the same button
            // opens the view in spectator mode so anyone can audit.
            if viewModel.isParticipant
                && (game.status == .full || game.status == .completed) {
                PrimaryButton(
                    title: String(localized: game.status == .completed
                                  ? "scoring.entry.view_final"
                                  : "scoring.entry.track"),
                    icon: "scope",
                    isLoading: false, isEnabled: true
                ) {
                    UISelectionFeedbackGenerator().selectionChanged()
                    showScoring = true
                }
            }
            if viewModel.canRate {
                PrimaryButton(title: String(localized: "game.action.rate"), icon: "star.fill",
                              isLoading: false, isEnabled: true) {
                    UISelectionFeedbackGenerator().selectionChanged()
                    showRating = true
                }
            } else if viewModel.isHost && game.status == .open {
                SecondaryButton(title: String(localized: "game.action.cancel"), icon: "xmark.circle") {
                    confirmCancel = true
                }
            } else if viewModel.isParticipant && game.status != .completed && game.status != .cancelled {
                SecondaryButton(title: String(localized: "game.action.leave"), icon: "person.fill.xmark") {
                    confirmLeave = true
                }
            } else if viewModel.isJoinable && container.isAuthenticated {
                // No-show info banner above the Join CTA. Users
                // joining a game commit to showing up — if they
                // don't, the host can flag them as a no-show and
                // their reliability_score drops. Surfacing this up
                // front sets expectations and reduces ghosting.
                noShowInfoBanner
                PrimaryButton(title: String(localized: "game.action.join"),
                              icon: "person.fill.checkmark",
                              isLoading: viewModel.actionInFlight,
                              isEnabled: !viewModel.actionInFlight) {
                    UISelectionFeedbackGenerator().selectionChanged()
                    Task {
                        await viewModel.join()
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                    }
                }
            }
        }
        .padding(.top, DSSpacing.xs)
    }

    /// Info banner shown above the Join CTA. Sets clear
    /// expectations that no-show behavior costs reliability — the
    /// downstream consequence in the rating service.
    private var noShowInfoBanner: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle.fill")
                .font(.system(size: 14, weight: .heavy))
                .foregroundStyle(DSColor.accent)
                .padding(.top, 1)
            Text("game.join.no_show_info")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(DSColor.accent.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(DSColor.accent.opacity(0.2), lineWidth: 1)
        )
    }

    // MARK: - Helpers

    private func row(labelKey: LocalizedStringKey, value: String) -> some View {
        HStack {
            Text(labelKey).font(DSType.footnote).foregroundStyle(DSColor.textSecondary)
            Spacer()
            Text(value).font(DSType.bodyEmphasis).foregroundStyle(DSColor.textPrimary)
        }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.map { $0.prefix(1).uppercased() }.joined()
    }

    private func formatStart(_ iso: String) -> String {
        // Same story as `countdownBar` — without `Date.fromISO`, every
        // game on this screen showed its raw timestamp (`2026-05-20T
        // 19:00:00.000Z`) instead of a friendly date string.
        guard let date = Date.fromISO(iso) else { return iso }
        let f = DateFormatter()
        f.doesRelativeDateFormatting = true
        f.dateStyle = .full
        f.timeStyle = .short
        return f.string(from: date)
    }

    private func countdownLabel(to date: Date) -> String {
        let interval = date.timeIntervalSinceNow
        if interval <= -60 {
            return String(localized: "game.detail.already_started")
        }
        if interval <= 60 {
            return String(localized: "game.detail.starts_now")
        }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .full
        let rel = f.localizedString(for: date, relativeTo: Date())
        return String(format: String(localized: "game.detail.starts_in_format"), rel)
    }

    private func countdownIcon(to date: Date) -> String {
        let interval = date.timeIntervalSinceNow
        if interval < 0 { return "clock.badge.checkmark" }
        if interval < 3600 { return "timer" }
        return "calendar.badge.clock"
    }

    private func sportLabel(_ slug: String) -> String {
        switch slug {
        case "padel": return String(localized: "game.sport.padel")
        case "football_5": return String(localized: "game.sport.football_5")
        default: return slug.capitalized
        }
    }

    private func statusPill(_ status: GameStatus) -> some View {
        let (key, color, bg): (LocalizedStringKey, Color, Color) = {
            switch status {
            case .open: return ("game.status.open", DSColor.success, DSColor.accentMuted)
            case .full: return ("game.status.full", DSColor.warning, DSColor.warning.opacity(0.15))
            case .cancelled: return ("game.status.cancelled", DSColor.danger, DSColor.danger.opacity(0.12))
            case .completed: return ("game.status.completed", DSColor.textSecondary, DSColor.border)
            }
        }()
        return Text(key)
            .font(.system(.caption, design: .default, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, DSSpacing.xs)
            .padding(.vertical, 4)
            .background(Capsule().fill(bg))
    }

    private func shareString(for game: GameDetail) -> String {
        let when = formatStart(game.starts_at)
        let venue = game.venue_name ?? sportLabel(game.sport_slug)
        return String(format: String(localized: "game.share.text_format"), venue, when)
    }

    /// True when the toolbar should render the "Paylaş" (share-to-Story)
    /// pictogram. Two routes:
    ///   • completed games — the result-card route, available to
    ///     anyone (so spectators can share interesting finals too).
    ///   • open / full games — only when the viewer is the host or
    ///     a confirmed participant. Showing the affordance to a
    ///     random outsider would let them share an Instagram story
    ///     pretending they joined.
    private func shouldShowStoryShareButton(_ game: GameDetail) -> Bool {
        switch game.status {
        case .completed:
            return true
        case .open, .full:
            return viewModel.isHost || viewModel.isParticipant
        case .cancelled:
            return false
        }
    }

    /// Build a `ShareCardData` from the loaded game + match score, then
    /// rasterise the story-variant `MatchResultCard` into a `UIImage` via
    /// `ImageRenderer`. Hands the resulting image off to the Stories
    /// flow — falls back to `UIActivityViewController` until the Story
    /// Creator view is wired up (see TODO on the sheet binding above).
    ///
    /// For non-completed games (status `.open`/`.full`) we route to the
    /// Wave-10 `GameJoinedCard` so the user can announce they joined /
    /// opened a match, complete with the empty-slot graphic that subtly
    /// nudges followers to fill the remaining spots — the viral
    /// growth-loop entry point.
    private func renderStoryAndPresent(_ game: GameDetail) async {
        guard !isRenderingStory else { return }
        isRenderingStory = true
        defer { isRenderingStory = false }

        let me = container.currentUser?.id
        let image: UIImage?

        if game.status == .completed {
            let data = buildShareCardData(game: game,
                                          score: viewModel.matchScore,
                                          currentUserId: me)
            image = await MainActor.run {
                let card = MatchResultCard(data: data, variant: .story)
                let renderer = ImageRenderer(content: card)
                renderer.scale = UIScreen.main.scale
                renderer.proposedSize = ProposedViewSize(ShareCardVariant.story.pointSize)
                return renderer.uiImage
            }
        } else {
            let data = buildJoinedCardData(game: game, currentUserId: me)
            image = await MainActor.run {
                let card = GameJoinedCard(data: data)
                let renderer = ImageRenderer(content: card)
                renderer.scale = UIScreen.main.scale
                renderer.proposedSize = ProposedViewSize(ShareCardVariant.story.pointSize)
                return renderer.uiImage
            }
        }

        guard let image else {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            return
        }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        storyImagePayload = StoryImagePayload(image: image)
    }

    /// Compose a `GameJoinedCardData` payload from the loaded
    /// `GameDetail`. Filters cancelled participants out so the slot
    /// grid only counts confirmed players — same rule the rest of
    /// the screen uses. The referral code is left nil today; once
    /// `PublicUser` exposes the field we can thread it through here
    /// and the footer's growth-loop URL will light up automatically.
    private func buildJoinedCardData(
        game: GameDetail,
        currentUserId: String?
    ) -> GameJoinedCardData {
        let date = Date.fromISO(game.starts_at) ?? Date()
        let sport = sportLabel(game.sport_slug)
        let activeParticipants = game.participants
            .filter { $0.status != .cancelled }
            .map { p in
                (
                    id: p.user_id,
                    displayName: p.display_name,
                    avatarURL: p.photo_url.flatMap(URL.init(string:))
                )
            }
        return ShareCardHook.makeJoinedData(
            participants: activeParticipants,
            capacity: game.capacity,
            hostUserId: game.host_user_id,
            currentUserId: currentUserId,
            sportLabel: sport,
            venueName: game.venue_name,
            startsAt: date,
            referralCode: nil,
            shareURL: URL(string: "https://linkfit.az/g/\(game.id)")
        )
    }

    /// Construct the share-card payload from the loaded game + (optional)
    /// match score. When the score hasn't loaded yet we still render a
    /// dignified card with zeroed scores rather than blocking — the
    /// player roster, venue, and date are usually the most-screenshotted
    /// parts anyway.
    private func buildShareCardData(
        game: GameDetail,
        score: MatchScore?,
        currentUserId: String?
    ) -> ShareCardData {
        let date = Date.fromISO(game.starts_at) ?? Date()
        let sport = sportLabel(game.sport_slug)
        let activeParticipants = game.participants.filter { $0.status != .cancelled }

        // Split participants into "self team" and "opponents" based on the
        // server-side scoring rosters when available; fall back to a
        // host-vs-everyone split so the card still reads sensibly on
        // games where scoring was never opened.
        let (selfTeamIds, opponentIds): ([String], [String]) = {
            if let score, let me = currentUserId {
                if score.team_a_user_ids.contains(me) {
                    return (score.team_a_user_ids, score.team_b_user_ids)
                }
                if score.team_b_user_ids.contains(me) {
                    return (score.team_b_user_ids, score.team_a_user_ids)
                }
                // Spectator viewing a finished match — show team A on
                // the left, team B on the right.
                return (score.team_a_user_ids, score.team_b_user_ids)
            }
            // No score: lone host on left, the rest on the right.
            let host = game.host_user_id
            return (
                [host],
                activeParticipants.map { $0.user_id }.filter { $0 != host }
            )
        }()

        let lookup: [String: Participant] = Dictionary(
            uniqueKeysWithValues: activeParticipants.map { ($0.user_id, $0) }
        )
        func players(_ ids: [String]) -> [(id: String, displayName: String, avatarURL: URL?)] {
            ids.compactMap { id in
                guard let p = lookup[id] else { return nil }
                return (id: p.user_id,
                        displayName: p.display_name,
                        avatarURL: p.photo_url.flatMap(URL.init(string:)))
            }
        }

        let (selfScore, opponentScore): (Int, Int) = {
            guard let score else { return (0, 0) }
            let a = score.sets.filter { $0.a > $0.b }.count
            let b = score.sets.filter { $0.b > $0.a }.count
            if let me = currentUserId, score.team_b_user_ids.contains(me) {
                return (b, a)
            }
            return (a, b)
        }()

        return ShareCardHook.makeData(
            selfTeamScore: selfScore,
            opponentScore: opponentScore,
            selfTeamPlayers: players(selfTeamIds),
            opponentPlayers: players(opponentIds),
            // `makeData` only tags the lime "you" highlight when the id
            // matches — pass an empty sentinel for spectators so nobody
            // gets the highlight rather than mis-attributing it.
            currentUserId: currentUserId ?? "",
            sportLabel: sport,
            venueName: game.venue_name,
            date: date,
            eloChange: nil,
            shareURL: URL(string: "https://linkfit.az/g/\(game.id)")
        )
    }
}

/// Payload binding for the story-image share sheet. Identifiable so we
/// can drive the SwiftUI `.sheet(item:)` lifecycle — assigning nil
/// dismisses; assigning a fresh value presents.
private struct StoryImagePayload: Identifiable {
    let id = UUID()
    let image: UIImage
}

/// Thin UIActivityViewController bridge so SwiftUI can present the share sheet.
private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
