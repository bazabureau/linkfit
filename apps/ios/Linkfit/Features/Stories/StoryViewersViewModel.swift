import Foundation
import Observation

/// Drives `StoryViewersSheet` — the Instagram-style "who viewed your
/// story" list the author opens by tapping the eye-icon pill in the
/// viewer footer. The endpoint is author-only on the server side; the
/// client gates presentation behind `StoryViewerViewModel.ownsCurrent`
/// so a non-owner never even sees the pill, but the VM doesn't need
/// to enforce that — the 403 would just surface as `.error` here.
///
/// State machine:
///   * `.idle`     — not loaded yet (transient, the view immediately
///                   transitions to `.loading` on appear).
///   * `.loading`  — first-page fetch in flight. The view renders an
///                   optimistic empty-skeleton (matching the conventions
///                   in `FollowListView`) rather than a bare spinner so
///                   the layout doesn't pop when the data lands.
///   * `.loaded`   — `.loaded(viewers)` where `viewers` is the server-
///                   sorted (newest-first) array. Empty array is
///                   coerced to `.empty`.
///   * `.empty`    — server returned `viewers: []` (story has had no
///                   non-author views yet). The sheet renders the
///                   "Hələ heç kim baxmayıb. Story 24 saatdan sonra
///                   silinəcək." copy in that state.
///   * `.error`    — fetch failed (network, 403, etc.). View renders a
///                   retry CTA.
///
/// Why a one-shot fetch (no pagination): a single story rarely has more
/// than a few hundred viewers within its 24h life, and the server caps
/// the response anyway. If that assumption breaks we'll graft on the
/// same offset pattern `FollowListViewModel` uses; for now the simpler
/// model wins on readability.
///
/// Pull-to-refresh is implemented via `refresh()` which re-runs the
/// same fetch and overwrites the local list — newer reactions or views
/// that landed after the first load are picked up on the swipe-down.
@Observable
@MainActor
final class StoryViewersViewModel {
    private(set) var state: ViewState<[StoryViewerInfo]> = .idle
    /// Total view count as reported by the server. May exceed
    /// `viewers.count` once the backend caps the response array (not
    /// today, but the wire shape leaves room). Used by the sheet's
    /// inline subtitle if/when we surface it.
    private(set) var count: Int = 0

    let storyId: String

    private let apiClient: APIClient
    /// Single in-flight task — guards against onAppear + pull-to-
    /// refresh racing each other on a fast scroll.
    private var inFlight: Task<Void, Never>?

    init(storyId: String, apiClient: APIClient) {
        self.storyId = storyId
        self.apiClient = apiClient
    }

    /// Initial load — cheap-guarded so the sheet's `.task` doesn't
    /// refetch when the user toggles back from a pushed profile.
    func onAppear() async {
        if case .loaded = state { return }
        if case .empty = state { return }
        await load()
    }

    /// Pull-to-refresh hook. Always re-fetches and overwrites the
    /// local list so a newly-arrived viewer (or one who just reacted)
    /// shows up.
    func refresh() async {
        await load()
    }

    // MARK: - Private

    private func load() async {
        inFlight?.cancel()
        // Optimistic empty render — we keep the previously-loaded
        // rows visible during a pull-to-refresh, but a cold start
        // flips into `.loading` so the sheet renders the skeleton.
        if case .loaded = state {} else if case .empty = state {} else {
            state = .loading
        }
        let task = Task { [weak self, storyId, apiClient] in
            guard let self else { return }
            do {
                let response = try await apiClient.send(
                    Endpoint.storyViewers(id: storyId)
                )
                if Task.isCancelled { return }
                await MainActor.run {
                    self.count = response.count
                    if response.viewers.isEmpty {
                        self.state = .empty
                    } else {
                        self.state = .loaded(response.viewers)
                    }
                }
            } catch is CancellationError {
                return
            } catch let error as APIError {
                if Task.isCancelled { return }
                await MainActor.run {
                    self.state = .error(message: error.localizedMessage)
                }
            } catch {
                if Task.isCancelled { return }
                await MainActor.run {
                    self.state = .error(message: error.localizedDescription)
                }
            }
        }
        inFlight = task
        await task.value
        inFlight = nil
    }
}
