import Foundation
import Observation

@Observable
@MainActor
final class ProfileViewModel {
    private(set) var state: ViewState<PublicProfile> = .idle
    /// Follow state lives in the global `FollowStore` so changes made on
    /// other screens (PlayersView, FollowListView) reflect immediately when
    /// this profile is open. Reading through the store also means SwiftUI
    /// re-renders the button automatically when somebody else mutates the
    /// edge — no manual notification plumbing.
    var isFollowing: Bool { FollowStore.shared.isFollowing(userId: userId) }
    let userId: String
    let container: AppContainer
    private let apiClient: APIClient

    init(apiClient: APIClient, userId: String, container: AppContainer) {
        self.apiClient = apiClient
        self.userId = userId
        self.container = container
    }

    var isMe: Bool { userId == container.currentUser?.id }

    func load() async {
        if case .loaded = state {} else { state = .loading }
        guard UUID(uuidString: userId) != nil else {
            state = .error(message: String(localized: "api.error.not_found"))
            return
        }
        do {
            let profile = try await apiClient.send(.profile(id: userId))
            // Seed the global store from network truth. If another screen
            // already mutated the edge optimistically, that local truth wins
            // until the next seed — but the server is authoritative on load.
            FollowStore.shared.seed(
                userId: profile.id,
                isFollowing: profile.is_following ?? false
            )
            state = .loaded(profile)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.errorDescription ?? String(localized: "profile.error.load"))
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    /// Toggle follow status for the profile being viewed. Optimistic UI:
    /// flip the global store immediately so every screen showing this user
    /// re-renders, then call the API, revert on failure. Counter deltas
    /// flow through `FollowStore.applyCountDelta` so the viewer's
    /// following_count and the target's followers_count both stay in sync
    /// without bespoke per-screen state.
    func toggleFollow() async {
        guard !isMe, container.isAuthenticated else { return }
        let previous = FollowStore.shared.isFollowing(userId: userId)
        let next = !previous
        let delta = next ? 1 : -1
        let viewerId = container.currentUser?.id ?? ""

        // Optimistic flip — edge + both counter deltas.
        FollowStore.shared.setFollowing(userId: userId, isFollowing: next)
        if !viewerId.isEmpty {
            // Viewer's own following_count moves.
            FollowStore.shared.applyCountDelta(forUser: viewerId, delta: delta)
        }
        // Target's followers_count moves.
        FollowStore.shared.applyCountDelta(forUser: userId, delta: delta)

        do {
            if next {
                _ = try await apiClient.send(Endpoint<EmptyResponse>.followUser(id: userId))
                // Analytics — wave-10 follow event. Only fires on the
                // follow direction (an unfollow is a UX-symmetric action
                // but a meaningless funnel signal). `source: .profile`
                // because this toggle lives inside the profile sheet —
                // other surfaces (PlayersView, SuggestedFollows) instrument
                // their own follow paths with the appropriate source value.
                Analytics.track(.followUser(targetUserId: userId, source: .profile))
            } else {
                _ = try await apiClient.send(Endpoint<EmptyResponse>.unfollowUser(id: userId))
            }
        } catch {
            // Revert on failure — surface is silent for now (we don't have a
            // toast surface inside a sheet-hosted profile). Revert order
            // doesn't matter; we just need to undo every mutation we made.
            FollowStore.shared.setFollowing(userId: userId, isFollowing: previous)
            if !viewerId.isEmpty {
                FollowStore.shared.applyCountDelta(forUser: viewerId, delta: -delta)
            }
            FollowStore.shared.applyCountDelta(forUser: userId, delta: -delta)
        }
    }

    /// Block the user being viewed. Calls POST /api/v1/users/:id/block
    /// (shipped in FAZA 61.5). On success the view dismisses back to the
    /// previous screen — the blocked account vanishes from listings on the
    /// next refresh because the backend tore down the follow edges and
    /// future list endpoints filter the block-set.
    /// `blockDidSucceed` flips to true on a successful 204 so the view can
    /// observe it (via `.onChange`) and dismiss itself.
    private(set) var blockPending: Bool = false
    private(set) var blockError: String?
    private(set) var blockDidSucceed: Bool = false

    func blockUser() async {
        guard !isMe, container.isAuthenticated else { return }
        blockPending = true
        defer { blockPending = false }
        do {
            _ = try await apiClient.send(Endpoint<EmptyResponse>.blockUser(id: userId))
            // Also collapse local follow flag so the UI doesn't briefly
            // show a stale "following" pill before the view dismisses.
            // Blocking implicitly tears down both follow edges server-side,
            // so we mirror that locally — no counter delta because the user
            // is leaving this surface entirely.
            FollowStore.shared.setFollowing(userId: userId, isFollowing: false)
            blockDidSucceed = true
        } catch let error as APIError {
            blockError = error.errorDescription ?? String(localized: "profile.block.unavailable")
        } catch {
            blockError = error.localizedDescription
        }
    }

    func clearBlockError() { blockError = nil }
    func clearBlockSuccess() { blockDidSucceed = false }

    /// Open (or create) a 1:1 conversation with the profile being viewed
    /// and return its conversation id. Used by ProfileView to wire the
    /// "Message" button — previously it was a dead haptic-only tap.
    /// Returns nil if the user is unauthenticated or the backend fails.
    func startConversation() async -> String? {
        guard !isMe, container.isAuthenticated else { return nil }
        do {
            let res = try await apiClient.send(.startConversation(otherUserId: userId))
            return res.conversation_id
        } catch {
            return nil
        }
    }

    func logout() async {
        guard let refresh = container.tokenStore.refreshToken() else {
            container.clearSession()
            return
        }
        _ = try? await apiClient.send(Endpoint<EmptyResponse>.logout(refreshToken: refresh))
        container.clearSession()
    }
}
