import Foundation
import Observation

/// Drives `FollowListView`. Wraps the followers / following endpoints with
/// offset-based pagination — the API returns `next_offset` (or `nil` when
/// the window is exhausted). Concurrent loads are de-duped: the view's
/// `onAppear`-per-row trigger fires more than once during fast scrolling.
@Observable
@MainActor
final class FollowListViewModel {
    private(set) var state: ViewState<[FollowEdge]> = .idle
    /// When true the footer shows a spinner — used during pagination only.
    /// The initial load uses the top-level `.loading` state instead.
    private(set) var isPaging: Bool = false

    let userId: String
    let kind: FollowListKind

    private let apiClient: APIClient
    private let pageSize: Int
    private var nextOffset: Int? = 0
    private var loaded: [FollowEdge] = []
    /// Single in-flight task — pagination triggers race during fast scroll
    /// and would otherwise dispatch one network call per visible row.
    private var inFlight: Task<Void, Never>?

    let viewerUserId: String?

    init(apiClient: APIClient, userId: String, kind: FollowListKind, viewerUserId: String? = nil, pageSize: Int = 30) {
        self.apiClient = apiClient
        self.userId = userId
        self.kind = kind
        self.viewerUserId = viewerUserId
        self.pageSize = pageSize
    }

    func onAppear() async {
        // Cheap guard — don't refetch when the screen reappears with data.
        if case .loaded = state { return }
        await refresh()
    }

    /// Force a fresh first-page load, throwing away anything we had.
    func refresh() async {
        inFlight?.cancel()
        nextOffset = 0
        loaded = []
        if case .loaded = state {} else { state = .loading }
        await loadPage(reset: true)
    }

    /// Load the next page if there's one to fetch. No-op when the previous
    /// page returned `next_offset = nil`.
    func loadMore() async {
        guard nextOffset != nil, !isPaging, inFlight == nil else { return }
        await loadPage(reset: false)
    }

    /// Force-remove a follower from `userId`'s followers list. Only meaningful
    /// when `kind == .followers` and the caller owns the list — backend returns
    /// 403 otherwise. On success the row is dropped from `loaded` optimistically
    /// and the host's followers_count delta is decremented via `FollowStore`.
    ///
    /// Throws the underlying `APIError` so the caller can surface a one-shot
    /// alert on failure without the row disappearing.
    func removeFollower(followerId: String) async throws {
        // `_ =` discard so generic `R` infers from the endpoint's
        // `EmptyResponse` — bare `try await` leaves `R` unbound and the
        // compiler emits "generic parameter 'R' could not be inferred".
        _ = try await apiClient.send(
            Endpoint<EmptyResponse>.removeFollower(
                profileUserId: userId,
                followerUserId: followerId
            )
        )

        // Optimistic local mutation — drop the row from the in-memory page so
        // the list updates immediately without waiting for a refresh.
        loaded.removeAll { $0.id == followerId }
        state = loaded.isEmpty ? .empty : .loaded(loaded)

        // Tell any open profile screen rendering `userId`'s follower count to
        // decrement by one. The store accumulates deltas (see FollowStore
        // docs) so multiple removals in a single session compose correctly.
        FollowStore.shared.applyCountDelta(forUser: userId, delta: -1)
    }

    // MARK: - Private

    private func loadPage(reset: Bool) async {
        guard let offset = nextOffset else { return }

        if !reset { isPaging = true }
        let task = Task { [weak self] in
            guard let self else { return }
            await self.performFetch(offset: offset, reset: reset)
        }
        inFlight = task
        defer {
            inFlight = nil
            isPaging = false
        }
        await task.value
    }

    private func performFetch(offset: Int, reset: Bool) async {
        do {
            let endpoint: Endpoint<FollowsPage> = (kind == .followers)
                ? .followers(userId: userId, limit: pageSize, offset: offset)
                : .following(userId: userId, limit: pageSize, offset: offset)
            let page = try await apiClient.send(endpoint)

            if Task.isCancelled { return }
            if reset { loaded = [] }

            // Seed the FollowStore from decoded network truth
            for item in page.items {
                if let isFollowing = item.is_following {
                    FollowStore.shared.seed(userId: item.id, isFollowing: isFollowing)
                } else if kind == .following, userId == viewerUserId {
                    // Fallback for looking at our own following list: we follow them
                    FollowStore.shared.seed(userId: item.id, isFollowing: true)
                }
            }

            loaded.append(contentsOf: page.items)
            nextOffset = page.next_offset
            state = loaded.isEmpty ? .empty : .loaded(loaded)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if Task.isCancelled { return }
            // For pagination failures we keep the existing rows visible and
            // just stop trying — only the initial load surfaces an error UI.
            if reset {
                state = .error(message: error.localizedMessage)
            }
        } catch {
            if Task.isCancelled { return }
            if reset {
                state = .error(message: error.localizedDescription)
            }
        }
    }
}
