import Foundation

/// View model backing the Leaderboards screen.
///
/// State machine notes:
///   * `state` is the canonical `ViewState<[LeaderboardEntry]>` — every
///     branch (idle/loading/loaded/empty/error) is required to render.
///     We never use raw optionals + booleans here (the project rule).
///   * `isLoadingMore` is orthogonal to `state` because we keep showing
///     the existing rows while the next page is in flight — switching
///     `state` to `.loading` would unmount the list. It's only flipped
///     to `true` while an offset-paginated fetch is running.
///   * `hasMore` is computed from `total_count`: once we've buffered
///     `>= total_count` entries we stop firing infinite-scroll loads.
///
/// The list is offset-paginated (the backend ships `total_count` per
/// page) and the page size is fixed at construction time so the
/// infinite-scroll trigger and the initial fetch always agree.
///
/// Wave-9 — three filter axes (`scope`, `skill`, `period`) are now
/// observable inputs. Setting any of them via `setScope` / `setSkill` /
/// `setPeriod` cancels the in-flight task and re-fetches from offset 0
/// so the visible list reflects the new filter atomically.
@Observable
@MainActor
final class LeaderboardsViewModel {
    // MARK: - Inputs

    let sport: String
    let pageSize: Int

    // MARK: - Filters

    /// Geographic scope. Defaults to `.city` — most users care about who
    /// they could plausibly bump into on a court next week, not the global
    /// top.
    private(set) var scope: LeaderboardScope = .city

    /// Skill bucket filter. Defaults to `.all` so the first paint shows the
    /// full ladder; users opt into a narrower bucket via the filter row.
    private(set) var skillFilter: LeaderboardSkillFilter = .all

    /// Time window. Defaults to `.all` — the same rationale as `.all` for
    /// skill: show everything first, let the user narrow.
    private(set) var period: LeaderboardPeriod = .all

    // MARK: - State

    private(set) var state: ViewState<[LeaderboardEntry]> = .idle
    private(set) var isLoadingMore: Bool = false
    private(set) var totalCount: Int = 0

    /// True once we've fetched all rows the server has. Used by the
    /// scroll-target trigger to decide whether to call `loadMore()`.
    var hasMore: Bool {
        guard case .loaded(let items) = state else { return totalCount == 0 ? false : true }
        return items.count < totalCount
    }

    // MARK: - Dependencies

    private let apiClient: APIClient

    /// In-flight task so we can cancel on `refresh()` and avoid
    /// duplicate concurrent fetches.
    private var loadTask: Task<Void, Never>?

    // MARK: - Init

    init(apiClient: APIClient, sport: String = "padel", pageSize: Int = 50) {
        self.apiClient = apiClient
        self.sport = sport
        self.pageSize = pageSize
    }

    // MARK: - Lifecycle

    func onAppear() async {
        // Avoid re-loading if we already have data (e.g. coming back
        // from a pushed profile). Refresh has its own path.
        if case .loaded = state { return }
        await loadFirstPage()
    }

    /// Pull-to-refresh entry point. Always re-fetches from offset 0.
    func refresh() async {
        loadTask?.cancel()
        await loadFirstPage()
    }

    // MARK: - Filter setters (Wave-9)

    /// Update the geographic scope and refetch the first page. No-op if
    /// the new value equals the current one — prevents redundant network
    /// chatter when the segmented control's `onChange` fires with an
    /// unchanged selection.
    func setScope(_ next: LeaderboardScope) async {
        guard next != scope else { return }
        scope = next
        await refresh()
    }

    func setSkill(_ next: LeaderboardSkillFilter) async {
        guard next != skillFilter else { return }
        skillFilter = next
        await refresh()
    }

    func setPeriod(_ next: LeaderboardPeriod) async {
        guard next != period else { return }
        period = next
        await refresh()
    }

    // MARK: - Fetching

    /// Initial load (offset 0). Replaces the entire list.
    private func loadFirstPage() async {
        // Keep showing the existing rows while we refresh — flipping
        // to `.loading` would yank the list out from under the user.
        if case .loaded = state {} else { state = .loading }

        do {
            let page = try await apiClient.send(
                .leaderboardElo(
                    sport: sport,
                    limit: pageSize,
                    offset: 0,
                    scope: scope,
                    skill: skillFilter,
                    period: period
                )
            )
            totalCount = page.total_count
            if page.items.isEmpty {
                state = .empty
            } else {
                state = .loaded(page.items)
            }
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.localizedMessage)
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    /// Infinite-scroll trigger. Called when the last visible row
    /// appears. No-op if we're already loading, errored, or the list
    /// is exhausted.
    func loadMoreIfNeeded(currentItem: LeaderboardEntry) async {
        guard case .loaded(let items) = state else { return }
        // Trigger when we hit the bottom-most row.
        guard items.last?.id == currentItem.id else { return }
        guard !isLoadingMore else { return }
        guard items.count < totalCount else { return }

        await loadMore()
    }

    private func loadMore() async {
        guard case .loaded(let existing) = state else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }

        do {
            let page = try await apiClient.send(
                .leaderboardElo(
                    sport: sport,
                    limit: pageSize,
                    offset: existing.count,
                    scope: scope,
                    skill: skillFilter,
                    period: period
                )
            )
            // Server is the source of truth for the total — keep it
            // fresh in case rows have been added/removed since the
            // first page.
            totalCount = page.total_count
            // De-dup by id in case the server returns overlapping
            // ranges across pages.
            let existingIds = Set(existing.map(\.id))
            let merged = existing + page.items.filter { !existingIds.contains($0.id) }
            state = .loaded(merged)
        } catch is CancellationError {
            return
        } catch {
            // Pagination failures shouldn't blow away the existing
            // list — just stop. The user can scroll again to retry.
            //
            // (We intentionally don't surface a per-page error UI
            // here; the next scroll trigger will redrive the fetch.)
            return
        }
    }
}
