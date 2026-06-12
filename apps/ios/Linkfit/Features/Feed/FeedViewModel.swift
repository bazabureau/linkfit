import Foundation
import Observation

/// Drives `FeedView`. Cursor-paginates `GET /api/v1/feed`. Concurrent loads
/// are de-duped so the per-row pagination trigger doesn't fire multiple
/// requests during fast scroll.
@Observable
@MainActor
final class FeedViewModel {
    private(set) var state: ViewState<[FeedEvent]> = .idle
    /// Pagination spinner — separate from the top-level `.loading` state so
    /// initial-load and pagination render differently.
    private(set) var isPaging: Bool = false

    private let apiClient: APIClient
    private let pageSize: Int
    /// `nil` means we've exhausted the timeline.
    private var nextCursor: String? = nil
    /// Whether we've ever made a successful fetch. The first refresh always
    /// uses `nil` cursor regardless of this — but it gates the "next page"
    /// short-circuit on first appear.
    private var hasFetchedOnce: Bool = false
    private var loaded: [FeedEvent] = []
    private var inFlight: Task<Void, Never>?

    init(apiClient: APIClient, pageSize: Int = 20) {
        self.apiClient = apiClient
        self.pageSize = pageSize
    }

    func onAppear() async {
        if case .loaded = state { return }
        await refresh()
    }

    /// Pull-to-refresh and initial load. Drops anything we had and starts
    /// from cursor=nil.
    func refresh() async {
        inFlight?.cancel()
        nextCursor = nil
        hasFetchedOnce = false
        loaded = []
        if case .loaded = state {} else { state = .loading }
        await loadPage(reset: true)
    }

    /// Fetch the next page if there's one left. Triggered when the bottom
    /// row appears.
    func loadMore() async {
        guard hasFetchedOnce, nextCursor != nil, !isPaging, inFlight == nil else { return }
        await loadPage(reset: false)
    }

    private func loadPage(reset: Bool) async {
        if !reset { isPaging = true }
        let cursor = reset ? nil : nextCursor
        let task = Task { [weak self] in
            guard let self else { return }
            await self.performFetch(cursor: cursor, reset: reset)
        }
        inFlight = task
        defer {
            inFlight = nil
            isPaging = false
        }
        await task.value
    }

    private func performFetch(cursor: String?, reset: Bool) async {
        do {
            let endpoint: Endpoint<FeedPage> = .feed(cursor: cursor, limit: pageSize)
            let page = try await apiClient.send(endpoint)
            if Task.isCancelled { return }
            if reset { loaded = [] }
            // Dedupe by id — defensive against the rare case where a fan-out
            // race emits the same event twice (the unique index drops it
            // server-side, but a client that fetches across the seam might
            // still see overlap if pagination boundaries shift).
            let existing = Set(loaded.map(\.id))
            for event in page.items where !existing.contains(event.id) {
                loaded.append(event)
            }
            nextCursor = page.next_cursor
            hasFetchedOnce = true
            state = loaded.isEmpty ? .empty : .loaded(loaded)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if Task.isCancelled { return }
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
