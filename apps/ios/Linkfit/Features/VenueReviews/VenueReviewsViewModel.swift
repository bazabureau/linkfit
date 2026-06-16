import Foundation
import Observation

/// Powers `VenueReviewsView` — owns the paginated review list plus the
/// aggregate summary header.
///
/// State shape: `state` is the page-level lifecycle (loading / loaded /
/// empty / error). The summary surface has its own loaded flag so we can
/// show stars even when the list is mid-refresh.
@Observable
@MainActor
final class VenueReviewsViewModel {
    let venueId: String

    private(set) var state: ViewState<[VenueReview]> = .idle
    private(set) var summary: VenueRatingSummary?
    private(set) var nextCursor: String?
    private(set) var isLoadingMore = false
    var sort: VenueReviewsSort = .recent

    private let apiClient: APIClient

    init(venueId: String, apiClient: APIClient) {
        self.venueId = venueId
        self.apiClient = apiClient
    }

    func onAppear() async {
        if case .loaded = state { return }
        await load()
    }

    /// Hard reload — clears cursor and re-fetches first page. Also re-pulls
    /// the summary so the header reflects any review the user just wrote.
    func load() async {
        if case .loaded = state {} else { state = .loading }
        nextCursor = nil

        async let pageTask = apiClient.send(
            .venueReviews(venueId: venueId, sort: sort, limit: 20, cursor: nil)
        )
        async let summaryTask = apiClient.send(.venueRatingSummary(venueId: venueId))

        do {
            let page = try await pageTask
            self.nextCursor = page.next_cursor
            self.summary = try await summaryTask
            state = page.items.isEmpty ? .empty : .loaded(page.items)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.localizedMessage)
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    /// Load next page if a cursor is available. Idempotent — calling twice
    /// while one is in flight is a no-op.
    func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        guard case .loaded(let current) = state else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await apiClient.send(
                .venueReviews(venueId: venueId, sort: sort, limit: 20, cursor: cursor)
            )
            nextCursor = page.next_cursor
            state = .loaded(current + page.items)
        } catch is CancellationError {
            return
        } catch {
            // Soft-fail: keep the current rows, drop the cursor so we don't
            // keep retrying a poisoned page on every scroll.
            nextCursor = nil
        }
    }

    func setSort(_ newSort: VenueReviewsSort) async {
        guard newSort != sort else { return }
        sort = newSort
        await load()
    }

    /// Called after `WriteReviewSheet` returns a fresh row. Inserts it at
    /// the top of the recent list and bumps the summary optimistically;
    /// then schedules a `load()` to pick up the canonical aggregate from
    /// the server.
    func acceptNewReview(_ review: VenueReview) async {
        if case .loaded(var rows) = state {
            rows.removeAll(where: { $0.author.id == review.author.id })
            rows.insert(review, at: 0)
            state = .loaded(rows)
        } else {
            state = .loaded([review])
        }
        await load()
    }

    func remove(_ reviewId: String) async {
        do {
            _ = try await apiClient.send(.deleteVenueReview(id: reviewId))
            if case .loaded(var rows) = state {
                rows.removeAll(where: { $0.id == reviewId })
                state = rows.isEmpty ? .empty : .loaded(rows)
            }
            await load()
        } catch is CancellationError {
            return
        } catch {
            // Keep the row visible and tell the user it failed — a silent
            // no-op leaves them thinking the review was deleted when it
            // wasn't.
            let message = (error as? APIError)?.localizedMessage
                ?? String(localized: "venue_reviews.error.delete")
            ToastCenter.shared.error(message)
        }
    }
}
