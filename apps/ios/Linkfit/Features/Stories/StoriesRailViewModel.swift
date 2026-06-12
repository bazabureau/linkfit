import Foundation
import Observation

/// Backing state for the stories rail on top of HomeView.
///
/// Lifecycle:
///   * `.task` on the rail fires `loadIfNeeded()` once per mount.
///   * `refresh()` is fired from HomeView's pull-to-refresh alongside
///     the games / venues / nearby-players loads.
///   * `removeStory(id:)` is called by StoryViewer after a successful
///     delete so the rail reflects the missing frame without a refetch.
///   * `prepend(_:)` is called by StoryCreator after a successful post
///     so the rail's "Your story" item bumps to "has unviewed" without
///     waiting for the next reload (which would feel laggy after the
///     user tapped Post).
///   * `markFrameViewed(_:)` is called by StoryViewer when a frame
///     becomes the active card; flips `viewed_by_me` locally and
///     re-evaluates `has_unviewed` for the owning group so the rail's
///     ring color updates immediately. Network call is fire-and-forget
///     from the viewer side (`POST /:id/view` is idempotent server-side).
///
/// The rail intentionally hides when `items` is empty rather than
/// rendering an empty band — see `StoriesRail` and the localization
/// table comment for `stories.empty`.
@Observable
@MainActor
final class StoriesRailViewModel {
    /// Single source of truth for the rail. SwiftUI's ForEach diffs on
    /// the group's `id` (= `user_id`) so reordering after a fresh load
    /// animates instead of rebuilding the whole row.
    private(set) var groups: [StoryGroup] = []

    /// `groups` minus the viewer's own group — pre-computed alongside
    /// every `groups` mutation via `recomputeOtherGroups(viewerId:)` so
    /// the rail's `ForEach(otherGroups)` doesn't re-filter on every
    /// render. The view writes the viewer id via `setViewerId(_:)` once
    /// it knows who the signed-in user is; mutations to `groups`
    /// (load, prepend, removeStory, markFrameViewed) then refresh this
    /// derived array. If no viewer is set yet, `otherGroups == groups`.
    private(set) var otherGroups: [StoryGroup] = []

    /// Viewer id used to derive `otherGroups`. `nil` until the rail
    /// view tells us via `setViewerId(_:)`; while nil, `otherGroups`
    /// is just a mirror of `groups`.
    private var viewerId: String?

    /// Cold-load flag — flips true after the first `load()` resolves
    /// (success OR empty). The view uses this to skip rendering on the
    /// initial cold mount when the rail would otherwise flash an empty
    /// row for a few hundred ms before the response lands.
    private(set) var didLoad: Bool = false

    /// True while a network reload is in flight. Used by the view to
    /// skip overlapping refreshes when the user pulls down rapidly.
    private(set) var isLoading: Bool = false

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Tell the view-model who the signed-in viewer is so it can derive
    /// `otherGroups` without re-filtering on every render. Safe to call
    /// repeatedly — if the id hasn't changed we skip recomputation.
    /// Called from `StoriesRail.task` once the viewer resolves.
    func setViewerId(_ id: String?) {
        guard viewerId != id else { return }
        viewerId = id
        recomputeOtherGroups()
    }

    /// Recompute `otherGroups` from `groups` + the current viewer id.
    /// Called after any mutation to `groups` (load, prepend, remove,
    /// markFrameViewed) and after `setViewerId(_:)`.
    private func recomputeOtherGroups() {
        guard let viewerId else {
            otherGroups = groups
            return
        }
        otherGroups = groups.filter { $0.user_id != viewerId }
    }

    /// First-mount fetch. Idempotent: subsequent calls while we've
    /// already loaded once are no-ops (use `refresh()` for explicit
    /// re-pulls). The rail is meant to feel stable across navigation —
    /// remounting the tab shouldn't re-flash a skeleton.
    func loadIfNeeded() async {
        guard !didLoad else { return }
        await load()
    }

    /// Force reload — used by pull-to-refresh and the post-creation
    /// callback. We deliberately keep `groups` populated during the
    /// fetch so the existing avatars don't disappear mid-pull.
    func refresh() async {
        await load()
    }

    /// Optimistically prepend a freshly-posted story to the viewer's
    /// own group. If the viewer already has a group in `groups` we
    /// merge into it (preserving the user's photo + display name);
    /// otherwise we synthesise a fresh group at index 0.
    ///
    /// Why optimistic: the create flow returns the persisted `Story`
    /// but NOT the updated rail payload — and the rail is the first
    /// thing the user sees after tapping Post, so a network round-trip
    /// to re-pull `feed` would feel sluggish. A subsequent `refresh()`
    /// from pull-to-refresh resolves any drift.
    func prepend(story: Story, viewer: PublicUser) {
        let now = ISO8601DateFormatter().string(from: Date())
        if let idx = groups.firstIndex(where: { $0.user_id == viewer.id }) {
            // Existing group — append the new story to the stack
            // (server orders oldest-first, so a fresh story goes at
            // the end). Bump `has_unviewed = true` and the
            // `latest_story_at` so the rail sort still places this
            // group near the front on the next refresh.
            let existing = groups[idx]
            var stack = existing.stories
            stack.append(story)
            let merged = StoryGroup(
                user_id: existing.user_id,
                display_name: existing.display_name,
                photo_url: existing.photo_url,
                has_unviewed: true,
                latest_story_at: now,
                stories: stack
            )
            groups[idx] = merged
        } else {
            // First story for this viewer — synthesise the group.
            let group = StoryGroup(
                user_id: viewer.id,
                display_name: viewer.display_name,
                photo_url: viewer.photo_url,
                has_unviewed: true,
                latest_story_at: now,
                stories: [story]
            )
            groups.insert(group, at: 0)
        }
        recomputeOtherGroups()
    }

    /// Remove a story by id after a successful delete in StoryViewer.
    /// If the deletion empties a group, the group itself is dropped so
    /// the rail doesn't show a dead avatar with no stack behind it.
    func removeStory(id: String) {
        var next: [StoryGroup] = []
        for group in groups {
            let trimmed = group.stories.filter { $0.id != id }
            if trimmed.isEmpty { continue }
            // `has_unviewed` may now be false if the deleted story was
            // the last unviewed frame in the stack.
            let hasUnviewed = trimmed.contains { !$0.viewed_by_me }
            next.append(StoryGroup(
                user_id: group.user_id,
                display_name: group.display_name,
                photo_url: group.photo_url,
                has_unviewed: hasUnviewed,
                latest_story_at: group.latest_story_at,
                stories: trimmed
            ))
        }
        groups = next
        recomputeOtherGroups()
    }

    /// Mark a single frame as viewed and recompute the owning group's
    /// `has_unviewed` flag so the rail's ring transitions from lime to
    /// gray once all of a user's frames have been seen.
    func markFrameViewed(storyId: String) {
        guard let groupIdx = groups.firstIndex(where: { g in
            g.stories.contains { $0.id == storyId }
        }) else { return }
        let group = groups[groupIdx]
        var newStack: [Story] = []
        for story in group.stories {
            if story.id == storyId, !story.viewed_by_me {
                newStack.append(Story(
                    id: story.id,
                    media_url: story.media_url,
                    media_type: story.media_type,
                    caption: story.caption,
                    created_at: story.created_at,
                    viewed_by_me: true
                ))
            } else {
                newStack.append(story)
            }
        }
        let hasUnviewed = newStack.contains { !$0.viewed_by_me }
        groups[groupIdx] = StoryGroup(
            user_id: group.user_id,
            display_name: group.display_name,
            photo_url: group.photo_url,
            has_unviewed: hasUnviewed,
            latest_story_at: group.latest_story_at,
            stories: newStack
        )
        recomputeOtherGroups()
    }

    // MARK: - Internals

    private func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await apiClient.send(Endpoint.storiesFeed())
            if Task.isCancelled { return }
            groups = response.items
            recomputeOtherGroups()
            didLoad = true
        } catch is CancellationError {
            // Tab swap or app background — keep the existing rail data,
            // don't surface an error. The rail is best-effort.
            return
        } catch {
            // The rail is non-critical — failing silently is preferable
            // to throwing an error band onto the home screen. If we've
            // loaded once already we keep that data; on cold load we
            // simply leave `groups` empty (rail hides).
            didLoad = true
        }
    }
}
