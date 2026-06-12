import SwiftUI

/// Full-screen Instagram-style story viewer.
///
/// Layout (top → bottom):
///   * Segmented progress bars — one per frame in the active stack,
///     filling left → right at the per-frame rate.
///   * Header row — small avatar, display_name, "5m ago" relative
///     timestamp, close X on the right.
///   * Media body — CachedAsyncImage scaled-to-fit on a black bg.
///   * Footer — caption (if any), owner-only "X views + delete".
///
/// Gestures (W13-13 — Instagram parity. Composited via
/// `simultaneousGesture`):
///   * Tap right 60% → next frame; wraps to next user; dismiss at end.
///   * Tap left 40% → previous frame; wraps to previous user.
///   * Long-press anywhere → pause progress AND hide chrome
///     (`chromeVisible = false`); release → resume + reveal.
///   * Vertical swipe down (drag > 100pt or velocity > 600) → dismiss
///     with interactive scale-down + fade.
///   * Horizontal swipe left across users → `nextGroup()`.
///   * Horizontal swipe right across users → `previousGroup()`.
///
/// Gesture suppression: when `viewModel.composerActive == true` (the
/// reply composer's TextField has focus — W13-3), the tap-skip and
/// swipe-dismiss handlers no-op so the user can type without
/// accidentally advancing or closing the viewer.
///
/// Accessibility: gestures are inaccessible to VoiceOver users, so
/// the viewer root exposes `.accessibilityActions` for Next /
/// Previous / Next user / Previous user / Dismiss, and the gesture
/// catcher is hidden from a11y (`.accessibilityHidden(true)`) so it
/// doesn't compete with the action menu.
///
/// All gesture handling lives on a transparent `Color.clear`
/// `contentShape(Rectangle())` overlay so the underlying image doesn't
/// have to be a Button (which would steal hit-testing from the
/// chrome).
struct StoryViewer: View {
    @Bindable var viewModel: StoryViewerViewModel
    @Environment(\.dismiss) private var dismiss
    /// Wave-13 — used to construct `StoryViewersViewModel` for the
    /// viewers sheet, and `ProfileViewModel` for the row-tap push.
    /// StoryViewer is hosted in a fullScreenCover off HomeView, which
    /// already injects `AppContainer` into the environment via the
    /// app root, so this lookup is non-optional.
    @Environment(AppContainer.self) private var container

    /// Vertical drag offset for the swipe-down dismiss gesture.
    /// Stays local — the VM only needs to know the result
    /// (dismissed) not the in-flight delta.
    @State private var dragOffset: CGFloat = 0
    /// Horizontal drag offset for the swipe-left/right (across
    /// users) gesture. Provides visual peek-feedback as the user
    /// drags; resets to 0 on release. We don't fully translate the
    /// viewer across — Instagram does a 3D-cube-fold, which is heavy
    /// to implement here, so we settle for a subtle horizontal
    /// translate + opacity dim that signals the gesture is being
    /// recognized.
    @State private var horizontalDragOffset: CGFloat = 0
    /// Chrome visibility — flipped to false during long-press so the
    /// progress bars, header, footer (reactions + composer) all
    /// fade out. Mirrors Instagram's "press to peek" behavior where
    /// the media takes the full screen and the UI gets out of the
    /// way. Animated via `.animation(.easeInOut, value:)` on each
    /// chrome element's opacity.
    @State private var chromeVisible: Bool = true
    /// Drives the alert presentation for the destructive delete
    /// action. Stays here rather than on the VM since it's pure UI.
    @State private var showDeleteConfirm: Bool = false
    /// Set when the viewer taps the "..." menu → "Şikayət et". Drives
    /// the `.reportSheet` modifier; the underlying viewer pauses while
    /// the sheet is up so the timer doesn't advance behind the form.
    @State private var reportPayload: ReportTargetPayload?
    /// Wave-13 — drives the "who viewed your story" sheet. Set when
    /// the owner taps the eye-icon pill in the footer; the underlying
    /// story timer pauses while the sheet is up so the next-frame
    /// transition doesn't race the user's reading. `Identifiable`
    /// wrapper around the story id so `.sheet(item:)` re-presents
    /// cleanly when the owner switches between their own stories.
    @State private var viewersSheetPayload: ViewersSheetPayload?
    /// Wave-13 — set when a row in the viewers sheet is tapped. We
    /// can't push to a NavigationStack from inside a full-screen
    /// cover, so the host (this view) presents a stacked sheet of
    /// `ProfileView` instead — same trick `ProfileFollowsSheetWith-
    /// Route` uses inside the followers list. Dismissing the profile
    /// sheet returns the user to the viewers sheet, then back to the
    /// story.
    @State private var pushedProfile: PushedProfileFromViewers?

    /// Identifiable wrapper for the viewers sheet's `.sheet(item:)`
    /// binding. Keyed by story id so re-presenting on a different
    /// story works without a SwiftUI sheet-stack conflict.
    fileprivate struct ViewersSheetPayload: Identifiable, Hashable {
        let storyId: String
        var id: String { storyId }
    }

    /// Identifiable wrapper for the pushed-profile sheet. We re-present
    /// `ProfileView` rather than relying on the viewers sheet's own
    /// NavigationStack because the viewer's host is a fullScreenCover
    /// — a push inside the viewers sheet would technically work, but
    /// the row label "tap → Profile" UX is cleaner as a stacked sheet
    /// (matches the FollowsList pattern used elsewhere in the app).
    fileprivate struct PushedProfileFromViewers: Identifiable, Hashable {
        let userId: String
        var id: String { userId }
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let story = viewModel.currentStory {
                mediaLayer(story: story)
            } else {
                // Defensive — should never happen since the host filters
                // empty groups before presenting us.
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(.white)
            }

            // Chrome — header + footer. Sits above the media but
            // below the gesture catcher so taps still register. The
            // whole VStack fades when `chromeVisible == false` (long-
            // press peek) — applying opacity at the container level
            // rather than per-element keeps the animation cheap and
            // synchronized.
            VStack(spacing: 0) {
                progressBars
                    .padding(.horizontal, 8)
                    .padding(.top, 8)
                header
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                Spacer()
                footer
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
            }
            .opacity(chromeVisible ? 1 : 0)
            .animation(.easeInOut(duration: 0.18), value: chromeVisible)

            // Gesture catcher — pure tap / press / drag handling.
            // Bottom of the z-stack so chrome buttons (close X,
            // delete) still register first.
            //
            // Hidden from VoiceOver — sighted users get the gestures,
            // VoiceOver users get the `.accessibilityActions` menu
            // attached to the viewer root below. Without this,
            // VoiceOver would announce "Color clear, button" over
            // the whole screen which is useless noise.
            GeometryReader { proxy in
                gestureCatcher(width: proxy.size.width)
            }
            .allowsHitTesting(true)
            .accessibilityHidden(true)
        }
        // Interactive swipe-down transform: scale + offset + fade.
        // 1.0 → 0.85 scale, 1.0 → 0.5 opacity over ~400pt of drag.
        // Clamped so a long swipe doesn't keep scaling past 0.85.
        .scaleEffect(max(0.85, 1 - dragOffset / 1000))
        .offset(y: max(0, dragOffset))
        .offset(x: horizontalDragOffset * 0.3) // subtle peek during left/right swipe
        .opacity(1 - min(0.5, dragOffset / 400))
        .statusBarHidden(true)
        .preferredColorScheme(.dark)
        // VoiceOver entry — exposes the five gestures as discrete
        // accessibility actions. The rotor surfaces these for VO
        // users who can't perform the tap-half / long-press / swipe
        // gestures the sighted UI uses.
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(viewModel.currentGroup?.display_name ?? ""))
        .accessibilityActions {
            Button(action: { viewModel.next() }) {
                Text("stories.viewer.a11y.next")
            }
            Button(action: { viewModel.previous() }) {
                Text("stories.viewer.a11y.previous")
            }
            Button(action: { viewModel.nextGroup() }) {
                Text("stories.viewer.a11y.next_user")
            }
            Button(action: { viewModel.previousGroup() }) {
                Text("stories.viewer.a11y.previous_user")
            }
            Button(action: { viewModel.requestDismiss() }) {
                Text("stories.viewer.a11y.dismiss")
            }
        }
        .onAppear { viewModel.startTimer() }
        .onDisappear { viewModel.stopTimer() }
        .onChange(of: viewModel.dismissRequested) { _, requested in
            if requested { dismiss() }
        }
        .alert("stories.viewer.confirm.delete.title",
               isPresented: $showDeleteConfirm) {
            Button("stories.viewer.action.delete", role: .destructive) {
                Task { await viewModel.deleteCurrent() }
            }
            Button("common.cancel", role: .cancel) {}
        }
        // Pause the auto-advance timer for the duration of the report
        // sheet so the user isn't racing the next-frame transition while
        // filling out the form. Resume when the sheet dismisses.
        .onChange(of: reportPayload?.id) { _, newId in
            viewModel.setPaused(newId != nil)
        }
        .reportSheet(payload: $reportPayload)
        // Wave-13 — same pause-while-presented contract as the report
        // sheet above. The viewers sheet has its own NavigationStack,
        // so we let it own the close affordance; the host's only job
        // is to pause + unpause the underlying timer.
        .onChange(of: viewersSheetPayload?.id) { _, newId in
            viewModel.setPaused(newId != nil)
        }
        .sheet(item: $viewersSheetPayload) { payload in
            StoryViewersSheet(
                viewModel: StoryViewersViewModel(
                    storyId: payload.storyId,
                    apiClient: container.apiClient
                ),
                onPickUser: { tappedUserId in
                    // Dismiss the viewers sheet, then present a
                    // stacked ProfileView sheet. We close the viewers
                    // sheet first so SwiftUI doesn't try to stack
                    // sheet-on-sheet (some iOS versions glitch on
                    // that); a tiny dispatch lets the dismiss
                    // animation start before the new sheet appears.
                    viewersSheetPayload = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        pushedProfile = PushedProfileFromViewers(
                            userId: tappedUserId
                        )
                    }
                }
            )
        }
        // Stacked profile sheet — opened from the viewers list when a
        // row is tapped. NavigationStack so push affordances inside
        // ProfileView still work (e.g. tapping a follower from the
        // pushed profile's own follows sheet).
        .sheet(item: $pushedProfile) { pushed in
            NavigationStack {
                ProfileView(
                    viewModel: ProfileViewModel(
                        apiClient: container.apiClient,
                        userId: pushed.userId,
                        container: container
                    )
                )
            }
        }
    }

    // MARK: - Media

    @ViewBuilder
    private func mediaLayer(story: Story) -> some View {
        let url = URL(string: story.media_url)
        CachedAsyncImage(url: url) { phase in
            if let img = phase.image {
                img.resizable().scaledToFit()
                    .ignoresSafeArea()
            } else if case .failure = phase {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 32))
                    Text("common.error.generic")
                }
                .foregroundStyle(.white.opacity(0.7))
            } else {
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(.white)
            }
        }
    }

    // MARK: - Progress bars

    /// Top segmented bars — one per story in the active group. Each
    /// bar is fully unfilled for frames after the current cursor, fully
    /// filled for frames before, and animated by `viewModel.progress`
    /// for the active frame.
    private var progressBars: some View {
        let group = viewModel.currentGroup
        let count = group?.stories.count ?? 0
        return HStack(spacing: 4) {
            ForEach(0..<count, id: \.self) { idx in
                ProgressBarSegment(
                    fill: fillFraction(forIndex: idx)
                )
                .frame(height: 3)
            }
        }
    }

    private func fillFraction(forIndex idx: Int) -> Double {
        if idx < viewModel.storyIndex { return 1.0 }
        if idx == viewModel.storyIndex { return viewModel.progress }
        return 0.0
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 10) {
            avatarMini

            VStack(alignment: .leading, spacing: 2) {
                Text(viewModel.currentGroup?.display_name ?? "")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                Text(relativeTime(viewModel.currentStory?.created_at))
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.7))
            }

            Spacer()

            // "..." menu — surfaces "Şikayət et" on non-owner stories so
            // the viewer can flag inappropriate content. Hidden on own
            // stories (would just be a no-op next to the delete button
            // in the footer).
            if !viewModel.ownsCurrent,
               let story = viewModel.currentStory,
               let group = viewModel.currentGroup {
                Menu {
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        reportPayload = ReportTargetPayload(
                            kind: .story,
                            targetId: story.id,
                            targetDisplayName: group.display_name
                        )
                    } label: {
                        Label("reports.menu.report_story", systemImage: "flag")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(Text("reports.menu.report_story"))
            }

            Button {
                viewModel.requestDismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(Text("common.close"))
        }
    }

    @ViewBuilder
    private var avatarMini: some View {
        let url = (viewModel.currentGroup?.photo_url).flatMap(URL.init(string:))
        CachedAsyncImage(url: url) { phase in
            if let img = phase.image {
                img.resizable().scaledToFill()
            } else {
                ZStack {
                    Circle().fill(Color.white.opacity(0.15))
                    Image(systemName: "person.fill")
                        .foregroundStyle(.white.opacity(0.7))
                }
            }
        }
        .frame(width: 32, height: 32)
        .clipShape(Circle())
    }

    // MARK: - Footer

    /// Footer layout (bottom → top):
    ///   * Optional delete button (owner-only).
    ///   * Optional caption pill.
    ///   * Reactions bar.
    ///
    /// SwiftUI's VStack stacks top → bottom, but the visual ordering
    /// we want from the screen's perspective is reactions ABOVE the
    /// caption (the bar should feel "primary" and sit between the
    /// caption and the media). We achieve that by listing the bar
    /// first in the VStack — it ends up above the caption, which is
    /// the intended layout.
    @ViewBuilder
    private var footer: some View {
        VStack(spacing: 12) {
            // Hide the bar from the story's owner — reacting to your
            // own story is a no-op on Instagram and would clutter the
            // owner's view. Non-owner viewers always see the bar.
            if !viewModel.ownsCurrent, let story = viewModel.currentStory {
                StoryReactionsBar(
                    reactions: story.reactions,
                    myReaction: story.my_reaction,
                    onTap: { emoji in
                        viewModel.tapReaction(emoji)
                    },
                    onPressStart: {
                        viewModel.setPaused(true)
                    },
                    onPressEnd: {
                        viewModel.setPaused(false)
                    }
                )
                // Smooth the count animations — the bar's own
                // count-show/hide already has a transition, but
                // animating the parent ensures the pill resizes
                // gracefully when a count crosses 0↔1.
                .animation(.spring(response: 0.3, dampingFraction: 0.7),
                           value: story.reactions)
                .animation(.spring(response: 0.3, dampingFraction: 0.7),
                           value: story.my_reaction)
            }

            if let caption = viewModel.currentStory?.caption,
               !caption.trimmingCharacters(in: .whitespaces).isEmpty {
                Text(caption)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.black.opacity(0.4), in: Capsule())
                    .lineLimit(3)
            }

            if viewModel.ownsCurrent {
                ownerActionsRow
            } else {
                // W13-3 — Instagram-style "reply to story" composer.
                // Bottom-anchored input strip + quick-reaction row.
                // Mounted only on non-owner stories (owner sees the
                // viewers + delete row above instead). The composer
                // owns its own focus state and mirrors it into the VM
                // via `setComposerActive`, which pauses the auto-
                // advance timer + signals the gesture overlay to
                // suppress tap-skip / swipe-dismiss while typing.
                StoryReplyComposer(viewModel: viewModel)
            }
        }
    }

    /// Wave-13 — owner-only horizontal row that combines the "who
    /// viewed your story" eye pill (Instagram-style) with the
    /// existing destructive Delete button.
    ///
    /// Eye pill layout:
    ///   * `eye` SF symbol + viewer-count label, rendered inside a
    ///     translucent black capsule that matches the delete button's
    ///     chrome so the two read as siblings.
    ///   * Tap fires `viewersSheetPayload = .init(storyId: …)` which
    ///     mounts `StoryViewersSheet`; the underlying story timer
    ///     pauses for the duration via the `.onChange` hook below.
    ///
    /// Why a single row instead of stacking the pill above Delete:
    /// the footer is already cramped on iPhone SE-class devices when
    /// a caption is present. A horizontal `HStack` keeps the visual
    /// weight low and matches the Instagram layout (eye left, delete
    /// right).
    @ViewBuilder
    private var ownerActionsRow: some View {
        HStack(spacing: 10) {
            viewersPill
            Spacer(minLength: 0)
            Button(role: .destructive) {
                showDeleteConfirm = true
            } label: {
                Label {
                    Text("stories.viewer.action.delete")
                } icon: {
                    Image(systemName: "trash")
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Color.black.opacity(0.5), in: Capsule())
            }
            .accessibilityLabel(Text("stories.viewer.action.delete"))
        }
    }

    /// Eye pill — opens `StoryViewersSheet` listing every user who
    /// has marked the story viewed. Sized identically to the Delete
    /// button on the right so the row reads balanced. Label resolves
    /// via `viewersPillLabel` below — the wire shape doesn't yet
    /// carry a scalar count on `Story`, so the pill defaults to the
    /// empty-state copy until the sheet opens (the sheet's own
    /// `.empty` / `.loaded` rendering is the source of truth on the
    /// number, and the user is one tap away).
    private var viewersPill: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            guard let id = viewModel.currentStory?.id else { return }
            viewersSheetPayload = ViewersSheetPayload(storyId: id)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "eye")
                    .font(.system(size: 14, weight: .semibold))
                Text("stories.viewers.title")
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Color.black.opacity(0.5), in: Capsule())
        }
        .accessibilityLabel(Text("stories.viewers.title"))
    }

    // MARK: - Gestures

    private func gestureCatcher(width: CGFloat) -> some View {
        // The tap-direction split: left 40% = back, right 60% = forward.
        // Standard Instagram split; slightly biased toward "forward"
        // because that's the dominant action.
        let leftWidth = width * 0.4

        return Color.clear
            .contentShape(Rectangle())
            // Long-press to pause AND hide chrome. minimumDuration
            // 0.2 so a quick tap doesn't accidentally arm peek-mode.
            // Sequenced into a zero-distance DragGesture so the
            // press-and-hold state survives the user moving their
            // finger a few points while pressing (otherwise SwiftUI
            // tears down the gesture on first jitter).
            .gesture(
                LongPressGesture(minimumDuration: 0.2)
                    .sequenced(before: DragGesture(minimumDistance: 0))
                    .onChanged { value in
                        switch value {
                        case .second(true, _):
                            // Suppress if composer is active — the
                            // user is typing and a long-touch on the
                            // keyboard region shouldn't trigger peek.
                            guard !viewModel.composerActive else { return }
                            viewModel.setPaused(true)
                            withAnimation(.easeInOut(duration: 0.18)) {
                                chromeVisible = false
                            }
                        default:
                            break
                        }
                    }
                    .onEnded { _ in
                        viewModel.setPaused(false)
                        withAnimation(.easeInOut(duration: 0.18)) {
                            chromeVisible = true
                        }
                    }
            )
            // Tap region — runs simultaneously with the long-press
            // path so a short tap still registers as next/prev. The
            // taps are wrapped in a HStack of two transparent
            // rectangles so SwiftUI can dispatch tap location to the
            // correct child.
            //
            // Suppressed while composer is active so typing doesn't
            // accidentally advance frames.
            .overlay {
                HStack(spacing: 0) {
                    Color.clear
                        .frame(width: leftWidth)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            guard !viewModel.composerActive else { return }
                            Haptics.selection()
                            viewModel.previous()
                        }
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture {
                            guard !viewModel.composerActive else { return }
                            Haptics.selection()
                            viewModel.next()
                        }
                }
            }
            // Drag gesture: handles BOTH swipe-down (dismiss) AND
            // horizontal swipe (across users). We decide which axis
            // the user is committing to based on which delta is
            // larger at release.
            //
            // Visual feedback while dragging:
            //   * Downward → dragOffset feeds the scale + opacity
            //     transform on the root.
            //   * Horizontal → horizontalDragOffset feeds a subtle
            //     0.3x translate so the user gets a "peek" hint
            //     that the gesture is being recognized.
            //
            // Thresholds (matched to Instagram feel):
            //   * Swipe-down: > 100pt OR predicted velocity > 600
            //   * Horizontal: > width * 0.25 (i.e. quarter-screen)
            //     OR predicted horizontal velocity > 500
            .simultaneousGesture(
                DragGesture(minimumDistance: 12)
                    .onChanged { value in
                        guard !viewModel.composerActive else { return }
                        let dx = value.translation.width
                        let dy = value.translation.height
                        // Decide dominant axis from the in-flight
                        // delta — vertical wins by default since
                        // dismiss is the more common gesture.
                        if abs(dy) > abs(dx) {
                            // Only respond to downward drag; ignore upward.
                            dragOffset = max(0, dy)
                            horizontalDragOffset = 0
                        } else {
                            horizontalDragOffset = dx
                            dragOffset = 0
                        }
                    }
                    .onEnded { value in
                        guard !viewModel.composerActive else {
                            dragOffset = 0
                            horizontalDragOffset = 0
                            return
                        }
                        let dx = value.translation.width
                        let dy = value.translation.height
                        let vx = value.predictedEndTranslation.width
                        let vy = value.predictedEndTranslation.height

                        // Pick the committed axis.
                        if abs(dy) > abs(dx) {
                            // Vertical — swipe-down dismiss.
                            if dy > 100 || vy > 600 {
                                Haptics.soft()
                                viewModel.requestDismiss()
                            } else {
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                                    dragOffset = 0
                                }
                            }
                        } else {
                            // Horizontal — across-users swipe.
                            let commitX = width * 0.25
                            if dx < -commitX || vx < -500 {
                                // Swipe left → next user.
                                Haptics.selection()
                                viewModel.nextGroup()
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                                    horizontalDragOffset = 0
                                }
                            } else if dx > commitX || vx > 500 {
                                // Swipe right → previous user.
                                Haptics.selection()
                                viewModel.previousGroup()
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                                    horizontalDragOffset = 0
                                }
                            } else {
                                // Under threshold — spring back.
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                                    horizontalDragOffset = 0
                                }
                            }
                        }
                    }
            )
    }

    // MARK: - Relative time

    /// Format `created_at` ISO8601 as "5m ago" / "2h ago" / "now".
    /// Falls back to `stories.relative_time_now` when the timestamp
    /// can't be parsed (best-effort UX — we'd rather show "now" than
    /// a blank cell).
    private func relativeTime(_ iso: String?) -> String {
        guard let iso, let date = parseISO(iso) else {
            return String(localized: "stories.relative_time_now")
        }
        let delta = max(0, Int(Date().timeIntervalSince(date)))
        let minutes = delta / 60
        let hours = minutes / 60
        if hours >= 1 {
            return String(format: String(localized: "stories.relative_time_format_h"), hours)
        }
        if minutes >= 1 {
            return String(format: String(localized: "stories.relative_time_format_m"), minutes)
        }
        return String(localized: "stories.relative_time_now")
    }

    private func parseISO(_ s: String) -> Date? {
        // Try the fractional-seconds variant first since the server
        // tends to ship microsecond precision; fall back to plain.
        let withFrac = ISO8601DateFormatter()
        withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFrac.date(from: s) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: s)
    }
}

// MARK: - Segment

/// One bar in the segmented progress row at the top. `fill` is 0…1.
/// Rendered as a faint white track behind a solid white pill that
/// scales horizontally — the GeometryReader lets the pill compute its
/// width relative to the parent without us hard-coding a layout.
private struct ProgressBarSegment: View {
    let fill: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.3))
                Capsule()
                    .fill(Color.white)
                    .frame(width: max(0, min(proxy.size.width, proxy.size.width * fill)))
            }
        }
    }
}
