import SwiftUI

/// Observable backing the grid + detail sheet. Mirrors the simple `ViewState`
/// pattern used elsewhere (RankingsViewModel, ProfileViewModel) — one
/// `load()` call, one re-render. Pull-to-refresh re-invokes `load()`.
@Observable
@MainActor
final class AchievementsViewModel {
    private(set) var state: ViewState<AchievementsResponse> = .idle
    let userId: String
    private let apiClient: APIClient

    init(apiClient: APIClient, userId: String) {
        self.apiClient = apiClient
        self.userId = userId
    }

    func onAppear() async { await load() }

    func load() async {
        if case .loaded = state {} else { state = .loading }
        do {
            let res = try await apiClient.send(.achievements(userId: userId))
            state = res.items.isEmpty ? .empty : .loaded(res)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.localizedMessage)
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    /// Convenience used by `ProfileView`'s recently-unlocked carousel. Returns
    /// up to `limit` unlocked items sorted by `unlocked_at` desc. If the
    /// payload hasn't loaded yet (or only has locked rows) the array is empty.
    func recentlyUnlocked(limit: Int = 5) -> [Achievement] {
        guard case .loaded(let res) = state else { return [] }
        return res.items
            .filter { $0.unlocked }
            .sorted { (a, b) in
                // Server returns ISO-8601; lexical compare is correct for that
                // format and avoids importing a Date formatter just for this.
                (a.unlocked_at ?? "") > (b.unlocked_at ?? "")
            }
            .prefix(limit)
            .map { $0 }
    }
}
