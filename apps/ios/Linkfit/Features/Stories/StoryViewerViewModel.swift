import Foundation
import Observation

/// Backing state for the full-screen story viewer.
///
/// Owns:
///   * `groupIndex` + `storyIndex` — the (user, frame) cursor.
///   * `progress` — the current 0…1 progress through the active frame's
///     5-second display window. Drives the segmented progress bar at
///     the top of the viewer.
///   * `isPaused` — true while the long-press is active. Pauses both
///     the on-screen progress bar AND the underlying timer task.
///   * `viewedIds` — local set of story ids the viewer has already
///     marked viewed this session. Guards against double-firing
///     `POST /:id/view` when the viewer re-navigates onto a frame.
///   * `dismissRequested` — flipped to true by the viewer's swipe-down
///     gesture; the host observes and closes the cover.
///
/// The timer task is reconfigured every time `storyIndex` changes —
/// `advance(to:)` cancels the previous task and starts a fresh one,
/// which is the only safe way to drive a "5 seconds per frame" cycle
/// without a leaked Task piling up advances on top of each other.
@Observable
@MainActor
final class StoryViewerViewModel {
    /// Frame display duration. Instagram uses ~5s for images; we
    /// match. Video stories (when added) should derive duration from
    /// the asset itself.
    static let frameDurationSeconds: TimeInterval = 5.0

    private(set) var groups: [StoryGroup]
    private(set) var groupIndex: Int
    private(set) var storyIndex: Int
    private(set) var progress: Double = 0
    private(set) var isPaused: Bool = false
    private(set) var dismissRequested: Bool = false
    private(set) var viewedIds: Set<String> = []
    /// True while the reply composer (W13-3) has focus on its
    /// TextField. The gesture overlay reads this to suppress tap-
    /// skip / swipe-dismiss handlers so the user can keep typing
    /// without an accidental advance / dismiss. Toggled via
    /// `setComposerActive(_:)` from the composer view's
    /// `@FocusState` binding.
    private(set) var composerActive: Bool = false

    /// Owner id used to decide whether to surface the delete button.
    /// `nil` when the viewer is not signed in (shouldn't happen in
    /// practice — the rail requires auth — but keeping it optional
    /// avoids force-unwraps).
    let viewerId: String?

    private let apiClient: APIClient
    /// Fired when a story is successfully marked viewed — the rail's
    /// view-model uses this to update the ring color. Closure form
    /// avoids a hard reference back to the rail VM (which would create
    /// a retain cycle through @Bindable).
    let onMarkViewed: (String) -> Void
    /// Fired when a story is successfully deleted. The rail's VM uses
    /// this to drop the story from its local cache without a refetch.
    let onDelete: (String) -> Void

    private var timerTask: Task<Void, Never>?
    private var expiryTask: Task<Void, Never>?

    init(
        groups: [StoryGroup],
        startGroupIndex: Int,
        viewerId: String?,
        apiClient: APIClient,
        onMarkViewed: @escaping (String) -> Void,
        onDelete: @escaping (String) -> Void
    ) {
        // Resolve groupIndex into a local first so we can both store it
        // AND use it to derive storyIndex — Swift's init-phase rules
        // forbid `self.groupIndex` access until every stored property
        // is initialised, even when the one we want is already set.
        let activeGroups = StoryGroup.removingExpiredStories(from: groups)
        let resolvedGroupIndex = max(0, min(startGroupIndex, max(0, activeGroups.count - 1)))
        self.groups = activeGroups
        self.groupIndex = resolvedGroupIndex
        self.viewerId = viewerId
        self.apiClient = apiClient
        self.onMarkViewed = onMarkViewed
        self.onDelete = onDelete

        // Land on the first UNVIEWED frame in the starting group so
        // a tap on a group with a partial stack picks up where the
        // viewer left off — matches Instagram. Falls back to index 0
        // if every frame has been viewed.
        let stack = activeGroups.indices.contains(resolvedGroupIndex)
            ? activeGroups[resolvedGroupIndex].stories
            : []
        self.storyIndex = stack.firstIndex(where: { !$0.viewed_by_me }) ?? 0
    }

    // MARK: - Computed accessors

    var currentGroup: StoryGroup? {
        groups.indices.contains(groupIndex) ? groups[groupIndex] : nil
    }

    var currentStory: Story? {
        guard let g = currentGroup, g.stories.indices.contains(storyIndex) else { return nil }
        return g.stories[storyIndex]
    }

    /// True when the active story belongs to the viewer themselves.
    /// Drives the delete button and the "X views" caption.
    var ownsCurrent: Bool {
        guard let viewerId, let g = currentGroup else { return false }
        return g.user_id == viewerId
    }

    // MARK: - Timer

    /// Kick off (or restart) the per-frame progress timer. Cancels any
    /// in-flight task before starting a new one so we never double-
    /// drive `progress`. Marks the active story as viewed on the first
    /// tick after the cursor lands.
    func startTimer() {
        timerTask?.cancel()
        pruneExpiredStories()
        guard currentStory != nil else {
            dismissRequested = true
            return
        }
        progress = 0
        markCurrentViewed()
        scheduleExpirySweep()
        timerTask = Task { [weak self] in
            // 60 ticks/sec is overkill; the progress bar is ~3pt tall
            // so 30 fps reads as smooth. Each tick advances by
            // 1/(duration * fps), and the loop exits when progress
            // reaches 1.0 or the task is cancelled.
            let fps: Double = 30
            let step: Double = 1.0 / (Self.frameDurationSeconds * fps)
            let interval = UInt64(1_000_000_000 / UInt64(fps))
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: interval)
                await MainActor.run { [weak self] in
                    guard let self else { return }
                    guard !self.isPaused else { return }
                    self.progress = min(1.0, self.progress + step)
                    if self.progress >= 1.0 {
                        self.next()
                    }
                }
            }
        }
    }

    func stopTimer() {
        timerTask?.cancel()
        timerTask = nil
        expiryTask?.cancel()
        expiryTask = nil
    }

    // MARK: - Gestures

    /// Right-tap = advance one frame. Wraps around to the next user's
    /// first frame when we hit the end of the current stack; when
    /// we've consumed the very last frame of the very last group, the
    /// viewer dismisses (mirrors Instagram).
    func next() {
        guard let g = currentGroup else { dismissRequested = true; return }
        if storyIndex + 1 < g.stories.count {
            storyIndex += 1
            startTimer()
        } else if groupIndex + 1 < groups.count {
            groupIndex += 1
            // New group starts at its first frame regardless of
            // viewed_by_me — tapping forward into a partially-viewed
            // group means "show me the next thing", and Instagram
            // does the same.
            storyIndex = 0
            startTimer()
        } else {
            dismissRequested = true
        }
    }

    /// Left-tap = step backward. Wraps to the previous user's LAST
    /// frame; doesn't dismiss when we hit the start (Instagram just
    /// stays on the first frame and resets its progress).
    func previous() {
        if storyIndex > 0 {
            storyIndex -= 1
            startTimer()
        } else if groupIndex > 0 {
            groupIndex -= 1
            let stack = currentGroup?.stories ?? []
            storyIndex = max(0, stack.count - 1)
            startTimer()
        } else {
            // At the very first frame — reset progress so the bar
            // animates back to 0; don't dismiss.
            progress = 0
            startTimer()
        }
    }

    func setPaused(_ paused: Bool) {
        isPaused = paused
    }

    /// Called by the reply composer (W13-3) when its TextField gains
    /// or loses focus. Pauses the timer while the composer is active
    /// (so the frame doesn't auto-advance behind a half-typed
    /// reply) and also signals the gesture overlay to suppress
    /// tap-skip / swipe-dismiss handlers — typing should never
    /// accidentally close the viewer.
    func setComposerActive(_ active: Bool) {
        composerActive = active
        isPaused = active
    }

    /// Jump forward one user (swipe-left across users). Lands on the
    /// next group's first frame; dismisses if we were already on the
    /// last group. Mirrors Instagram's horizontal-swipe behavior.
    func nextGroup() {
        if groupIndex + 1 < groups.count {
            groupIndex += 1
            storyIndex = 0
            startTimer()
        } else {
            dismissRequested = true
        }
    }

    /// Jump back one user (swipe-right across users). Lands on the
    /// previous group's first frame; stays put (re-anchors progress)
    /// if we were already on the first group.
    func previousGroup() {
        if groupIndex > 0 {
            groupIndex -= 1
            storyIndex = 0
            startTimer()
        } else {
            // At the first group already — reset progress so the
            // bar animates back to 0, matching Instagram.
            progress = 0
            startTimer()
        }
    }

    /// Swipe-down — host observes `dismissRequested` and closes the
    /// fullScreenCover.
    func requestDismiss() {
        dismissRequested = true
        stopTimer()
    }

    // MARK: - Reactions

    /// Handle a tap on a reaction emoji in `StoryReactionsBar`.
    ///
    /// Three cases:
    ///   1. Viewer hasn't reacted → POST sets `emoji`, counts that
    ///      emoji +1.
    ///   2. Viewer tapped the SAME emoji they had → DELETE clears,
    ///      counts that emoji -1.
    ///   3. Viewer tapped a DIFFERENT emoji → POST switches, counts
    ///      old emoji -1 + new emoji +1.
    ///
    /// All three mutations happen optimistically against the local
    /// `currentStory.reactions` + `my_reaction`; on network failure we
    /// revert by restoring the pre-tap snapshot. The bar reads from
    /// `currentStory` so the UI update is immediate.
    ///
    /// Triggers `Haptics.soft()` on the touch — matches Instagram's
    /// reaction feel (gentle bump rather than a tap-acknowledgement
    /// click).
    func tapReaction(_ emoji: StoryReactionEmoji) {
        guard let story = currentStory else { return }
        Haptics.soft()
        let isClear = (story.my_reaction == emoji.rawValue)
        // Snapshot for revert. We snapshot only the affected story
        // rather than the whole `groups` array — reaction churn is
        // high-frequency and we don't want to copy a 50-group rail
        // payload on every tap.
        let snapshot = story

        // Apply optimistic mutation.
        var nextReactions = story.reactions
        if let prior = story.my_reaction {
            nextReactions[prior] = max(0, (nextReactions[prior] ?? 0) - 1)
            if nextReactions[prior] == 0 { nextReactions.removeValue(forKey: prior) }
        }
        let newMyReaction: String?
        if isClear {
            newMyReaction = nil
        } else {
            newMyReaction = emoji.rawValue
            nextReactions[emoji.rawValue] = (nextReactions[emoji.rawValue] ?? 0) + 1
        }
        replaceCurrentStory(
            reactions: nextReactions,
            myReaction: newMyReaction
        )

        // Fire network. Server returns canonical state; on success we
        // adopt it so any concurrent reactions from other viewers are
        // reflected. On failure we revert to the snapshot.
        Task { [apiClient, storyId = story.id] in
            do {
                let response: StoryReactionResponse
                if isClear {
                    response = try await apiClient.send(
                        Endpoint.clearStoryReaction(id: storyId)
                    )
                } else {
                    response = try await apiClient.send(
                        Endpoint.reactToStory(id: storyId, emoji: emoji)
                    )
                }
                await MainActor.run { [weak self] in
                    self?.adoptServerReactions(
                        forStoryId: storyId,
                        reactions: response.reactions,
                        myReaction: response.my_reaction
                    )
                }
            } catch APIError.notFound {
                await MainActor.run { [weak self] in
                    self?.removeStoryLocally(id: storyId, notifyRail: true)
                    ToastCenter.shared.error(String(localized: "stories.expired.toast"))
                }
            } catch {
                await MainActor.run { [weak self] in
                    self?.revertReaction(toSnapshot: snapshot)
                }
            }
        }
    }

    /// Replace the active story's reaction fields in-place. Walks the
    /// `groups → stories` tree to mutate without rebuilding unrelated
    /// rows. Used by the optimistic update path; the server-adoption
    /// and revert paths use the by-id variants below since the cursor
    /// may have moved by the time the network call resolves.
    private func replaceCurrentStory(reactions: [String: Int], myReaction: String?) {
        guard groups.indices.contains(groupIndex) else { return }
        let g = groups[groupIndex]
        guard g.stories.indices.contains(storyIndex) else { return }
        let s = g.stories[storyIndex]
        let updated = s.replacingReactions(reactions, myReaction: myReaction)
        var nextStack = g.stories
        nextStack[storyIndex] = updated
        var nextGroups = groups
        nextGroups[groupIndex] = StoryGroup(
            user_id: g.user_id,
            display_name: g.display_name,
            photo_url: g.photo_url,
            has_unviewed: g.has_unviewed,
            latest_story_at: g.latest_story_at,
            stories: nextStack
        )
        groups = nextGroups
    }

    /// Adopt the server's canonical reaction tally for a specific
    /// story id. Locates the story by id (rather than current cursor)
    /// since the user may have navigated to another frame by the time
    /// the response arrives — applying the response to the wrong frame
    /// would clobber its state.
    private func adoptServerReactions(forStoryId id: String, reactions: [String: Int], myReaction: String?) {
        applyToStory(id: id) { s in
            s.replacingReactions(reactions, myReaction: myReaction)
        }
    }

    /// Revert the optimistic mutation back to the pre-tap snapshot.
    /// Used when the network call fails — we'd rather restore the
    /// previous reactions/my_reaction than leave the viewer with a
    /// phantom reaction the server never accepted. Located via id
    /// rather than cursor so the revert still works if the user has
    /// navigated to another frame in the meantime.
    private func revertReaction(toSnapshot snapshot: Story) {
        applyToStory(id: snapshot.id) { _ in snapshot }
    }

    /// Generic by-id mutator. Walks `groups` for a story matching
    /// `id`, hands it to `transform`, and stores the result. No-op if
    /// the story has since been deleted.
    private func applyToStory(id: String, transform: (Story) -> Story) {
        for gi in groups.indices {
            let g = groups[gi]
            guard let si = g.stories.firstIndex(where: { $0.id == id }) else { continue }
            var nextStack = g.stories
            nextStack[si] = transform(g.stories[si])
            var nextGroups = groups
            nextGroups[gi] = StoryGroup(
                user_id: g.user_id,
                display_name: g.display_name,
                photo_url: g.photo_url,
                has_unviewed: g.has_unviewed,
                latest_story_at: g.latest_story_at,
                stories: nextStack
            )
            groups = nextGroups
            return
        }
    }

    // MARK: - Reply (Wave-13)

    /// True while a reply send is in flight. The composer uses this to
    /// dim its send button so a double-tap can't enqueue two parallel
    /// reply POSTs against the same story. Cleared in both success and
    /// failure branches so a transient network blip doesn't lock the
    /// composer permanently.
    private(set) var isSendingReply: Bool = false

    /// Send the user's reply text as a DM to the story author. The
    /// server resolves (or creates) the 1:1 conversation, persists the
    /// message with a "↩ Story reply:" sentinel prefix, and fans out
    /// the existing push + SSE pipes. On success we surface a confirm
    /// toast; on failure a generic error toast + the composer's text
    /// stays intact so the user can retry.
    ///
    /// Pauses the story auto-advance for the duration of the call so
    /// the next-frame transition doesn't yank the composer out from
    /// under the user mid-network. The pause state is restored to its
    /// pre-send value in both branches — works whether the user kept
    /// the keyboard focused (already paused) or let it dismiss before
    /// hitting send.
    ///
    /// Returns `true` on a successful send so the View can clear its
    /// local text state and dismiss the keyboard.
    @discardableResult
    func sendReply(text: String) async -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        guard !isSendingReply else { return false }
        // Can't reply to your own story — the composer is hidden on
        // owner stories already, but defense-in-depth here keeps a
        // third-party call site honest.
        guard !ownsCurrent, let story = currentStory else { return false }

        isSendingReply = true
        let priorPaused = isPaused
        setPaused(true)

        let storyId = story.id
        do {
            _ = try await apiClient.send(
                Endpoint.replyToStory(id: storyId, body: trimmed)
            )
            isSendingReply = false
            setPaused(priorPaused)
            Haptics.soft()
            ToastCenter.shared.success(
                String(localized: "stories.reply.success.toast")
            )
            return true
        } catch APIError.notFound {
            isSendingReply = false
            setPaused(priorPaused)
            removeStoryLocally(id: storyId, notifyRail: true)
            ToastCenter.shared.error(String(localized: "stories.expired.toast"))
            return false
        } catch {
            isSendingReply = false
            setPaused(priorPaused)
            ToastCenter.shared.error(
                String(localized: "error.generic")
            )
            return false
        }
    }

    // MARK: - Mutations

    /// Delete the active story. Optimistically pops the frame out of
    /// the local stack and either advances to the next frame or
    /// dismisses if that was the last one. On network failure we
    /// re-show the frame and stop the timer so the user can retry.
    func deleteCurrent() async {
        guard let story = currentStory else { return }
        guard ownsCurrent else { return }
        let snapshot = groups
        // Mutate optimistically.
        var nextGroups = groups
        let gi = groupIndex
        var stack = nextGroups[gi].stories
        stack.removeAll { $0.id == story.id }
        nextGroups[gi] = StoryGroup(
            user_id: nextGroups[gi].user_id,
            display_name: nextGroups[gi].display_name,
            photo_url: nextGroups[gi].photo_url,
            has_unviewed: stack.contains { !$0.viewed_by_me },
            latest_story_at: nextGroups[gi].latest_story_at,
            stories: stack
        )
        // If the group emptied, drop it.
        if stack.isEmpty {
            nextGroups.remove(at: gi)
        }
        groups = nextGroups
        onDelete(story.id)

        // Re-anchor the cursor. If the group emptied, jump to the
        // next group; otherwise stay at the same index (which now
        // points at what used to be the next frame). If we ran out of
        // groups entirely, dismiss.
        if nextGroups.isEmpty {
            dismissRequested = true
            stopTimer()
        } else if !groups.indices.contains(gi) {
            groupIndex = max(0, gi - 1)
            storyIndex = 0
            startTimer()
        } else {
            if storyIndex >= groups[gi].stories.count {
                storyIndex = max(0, groups[gi].stories.count - 1)
            }
            startTimer()
        }

        // Network call. We treat failure as "log + revert".
        do {
            _ = try await apiClient.send(Endpoint.deleteStory(id: story.id))
        } catch {
            // Revert. UX is rough but better than silently leaving the
            // user thinking they deleted something they didn't.
            groups = snapshot
            stopTimer()
            dismissRequested = true
        }
    }

    // MARK: - Internals

    /// Fire `POST /:id/view` for the active story, once per session.
    /// Idempotent on the server side (per spec) so retries are safe.
    private func markCurrentViewed() {
        guard let story = currentStory else { return }
        guard !viewedIds.contains(story.id) else { return }
        guard story.isActive() else {
            removeStoryLocally(id: story.id, notifyRail: true)
            return
        }
        guard !story.viewed_by_me else {
            // Already viewed by-me on the server side; still track
            // locally so a UI ring color update fires.
            viewedIds.insert(story.id)
            onMarkViewed(story.id)
            return
        }
        viewedIds.insert(story.id)
        onMarkViewed(story.id)
        Task { [apiClient, id = story.id] in
            _ = try? await apiClient.send(Endpoint.markStoryViewed(id: id))
        }
    }

    @discardableResult
    private func pruneExpiredStories(referenceDate: Date = Date()) -> Bool {
        let expiredIds = StoryGroup.expiredStoryIds(in: groups, referenceDate: referenceDate)
        guard !expiredIds.isEmpty else { return false }
        groups = StoryGroup.removingExpiredStories(from: groups, referenceDate: referenceDate)
        expiredIds.forEach(onDelete)
        reanchorAfterLocalRemoval()
        return true
    }

    private func removeStoryLocally(id: String, notifyRail: Bool) {
        let before = currentStory?.id
        var nextGroups: [StoryGroup] = []
        for group in groups {
            let stack = group.stories.filter { $0.id != id }
            guard !stack.isEmpty else { continue }
            nextGroups.append(StoryGroup(
                user_id: group.user_id,
                display_name: group.display_name,
                photo_url: group.photo_url,
                has_unviewed: stack.contains { !$0.viewed_by_me },
                latest_story_at: stack.last?.created_at ?? group.latest_story_at,
                stories: stack
            ))
        }
        groups = nextGroups
        if notifyRail {
            onDelete(id)
        }
        reanchorAfterLocalRemoval()
        if currentStory?.id != before, currentStory != nil {
            startTimer()
        }
    }

    private func reanchorAfterLocalRemoval() {
        guard !groups.isEmpty else {
            dismissRequested = true
            stopTimer()
            return
        }
        groupIndex = min(groupIndex, groups.count - 1)
        let storyCount = groups[groupIndex].stories.count
        storyIndex = min(storyIndex, max(0, storyCount - 1))
    }

    private func scheduleExpirySweep(referenceDate: Date = Date()) {
        expiryTask?.cancel()
        guard let nextExpiry = StoryGroup.nextExpirationDate(in: groups, referenceDate: referenceDate) else {
            expiryTask = nil
            return
        }
        let delaySeconds = max(0, nextExpiry.timeIntervalSince(referenceDate) + 0.5)
        let delayNanoseconds = UInt64(delaySeconds * 1_000_000_000)
        expiryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: delayNanoseconds)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard let self else { return }
                let before = self.currentStory?.id
                let changed = self.pruneExpiredStories()
                guard changed, !self.dismissRequested else { return }
                if self.currentStory?.id != before {
                    self.startTimer()
                } else {
                    self.scheduleExpirySweep()
                }
            }
        }
    }
}
