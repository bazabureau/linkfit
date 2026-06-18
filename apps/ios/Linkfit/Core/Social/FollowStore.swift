import Foundation
import Observation

// =============================================================================
// FOLLOW STORE
// -----------------------------------------------------------------------------
// Global, in-memory source-of-truth for "does the viewer follow user X?".
//
// PROBLEM IT SOLVES
// -----------------
// Follow state used to live independently in each view-model:
//   - ProfileViewModel.isFollowing
//   - PlayersViewModel (per-row PlayerSummary.is_followed_by_me)
//   - FollowListViewModel rows
//
// If the user followed somebody from the directory and THEN opened that
// person's profile, the profile sheet showed the stale "Follow" CTA until
// the server round-trip resolved — and even then only on a manual reload.
// Two screens disagreeing about the same edge is bad UX.
//
// SOLUTION
// --------
// One @Observable singleton that every screen consults. When PlayersView
// flips an edge through `setFollowing`, SwiftUI re-renders every view that
// reads `FollowStore.shared.isFollowing(userId:)` — including a half-open
// ProfileView in a sheet behind it.
//
// View-models still own the network call + optimistic revert; this store
// is just the shared cache.
//
// COUNTER DELTAS
// --------------
// Following somebody also changes two visible counts:
//   - viewer's `following_count` (+1 / -1)
//   - target's `followers_count` (+1 / -1)
// Each screen has its own server-supplied count, so we stash a per-user
// delta that screens add on top of `serverCount`. Reset via `reset()` (e.g.
// on logout / hard refresh) to avoid drift accumulating forever.
// =============================================================================

@Observable
@MainActor
final class FollowStore {
    /// Process-wide shared instance. View-models reach in through this
    /// rather than being injected because the store has no dependencies
    /// and we want incidental call sites (toast actions, deep-link
    /// handlers, etc.) to update it without wiring DI.
    static let shared = FollowStore()

    /// The viewer's follow edge against each known user id.
    /// `nil` (missing key) means "we don't know — fall back to whatever the
    /// payload says". `false` is an explicit "viewer does NOT follow this user".
    private(set) var followingByUserId: [String: Bool] = [:]

    /// Delta to add on top of a user's server-supplied count.
    /// Same delta serves two purposes:
    ///   - On the VIEWER's profile: applied to their own `following_count`.
    ///   - On a TARGET's profile: applied to that target's `followers_count`.
    /// Screens decide which count to apply it to based on whose profile is
    /// open. See `applyCountDelta(forUser:delta:)` for accumulation rules.
    private(set) var followingCountDelta: [String: Int] = [:]

    /// User ids with an in-flight follow/unfollow request. Prevents a rapid
    /// double-tap from sending POST+DELETE races that leave the UI and server
    /// disagreeing about the final edge.
    private(set) var pendingUserIds: Set<String> = []

    init() {}

    // MARK: - Follow edges

    /// Prime the store from network truth. Called by view-models after a
    /// successful load — e.g. ProfileViewModel.load() seeds the profile's
    /// edge from `PublicProfile.is_following`. Safe to call repeatedly; the
    /// last seed wins.
    func seed(userId: String, isFollowing: Bool) {
        followingByUserId[userId] = isFollowing
    }

    /// Flip the local entry. Used by view-models during optimistic mutation.
    /// View-models still call the network and revert this on failure.
    func setFollowing(userId: String, isFollowing: Bool) {
        followingByUserId[userId] = isFollowing
    }

    /// Read accessor. Returns false when we haven't seen the user before
    /// — callers that need "unknown" semantics should consult
    /// `followingByUserId` directly.
    func isFollowing(userId: String) -> Bool {
        followingByUserId[userId] ?? false
    }

    // MARK: - Counter deltas

    /// Accumulate a counter delta for `userId`. Positive = follow action,
    /// negative = unfollow. Screens displaying a count for `userId` should
    /// render `serverCount + (followingCountDelta[userId] ?? 0)`.
    ///
    /// Why accumulate rather than overwrite? A user may follow then unfollow
    /// then re-follow within a single session. The deltas net out (+1, -1,
    /// +1 = +1) and a subsequent server refresh re-syncs the canonical
    /// count.
    func applyCountDelta(forUser userId: String, delta: Int) {
        guard delta != 0 else { return }
        followingCountDelta[userId, default: 0] += delta
    }

    var isMutatingAnyFollow: Bool {
        !pendingUserIds.isEmpty
    }

    func isPending(userId: String) -> Bool {
        pendingUserIds.contains(userId)
    }

    /// Shared optimistic follow mutation used by Profile, Players, and
    /// Follows lists. The caller supplies the API call so analytics/source-
    /// specific behavior can stay at the feature layer, while this store owns
    /// the edge flip, count deltas, in-flight guard, and rollback.
    @discardableResult
    func performToggle(
        targetUserId: String,
        viewerUserId: String?,
        follow: Bool? = nil,
        request: (_ willFollow: Bool) async throws -> Void
    ) async throws -> Bool {
        guard !pendingUserIds.contains(targetUserId) else {
            return isFollowing(userId: targetUserId)
        }

        let previous = isFollowing(userId: targetUserId)
        let next = follow ?? !previous
        guard previous != next else { return next }

        let delta = next ? 1 : -1
        pendingUserIds.insert(targetUserId)
        setFollowing(userId: targetUserId, isFollowing: next)
        if let viewerUserId, !viewerUserId.isEmpty {
            applyCountDelta(forUser: viewerUserId, delta: delta)
        }
        applyCountDelta(forUser: targetUserId, delta: delta)

        do {
            try await request(next)
            pendingUserIds.remove(targetUserId)
            return next
        } catch {
            setFollowing(userId: targetUserId, isFollowing: previous)
            if let viewerUserId, !viewerUserId.isEmpty {
                applyCountDelta(forUser: viewerUserId, delta: -delta)
            }
            applyCountDelta(forUser: targetUserId, delta: -delta)
            pendingUserIds.remove(targetUserId)
            throw error
        }
    }

    /// Wipe everything. Call on logout so the next signed-in user starts
    /// with a clean slate and doesn't see leftover follow flags from the
    /// previous account.
    func reset() {
        followingByUserId.removeAll()
        followingCountDelta.removeAll()
        pendingUserIds.removeAll()
    }
}
