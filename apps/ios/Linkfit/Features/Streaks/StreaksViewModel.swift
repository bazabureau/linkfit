import Foundation
import Observation

/// State + load logic for the streaks screen.
///
/// The streaks endpoint is auth-gated but per-user — the screen accepts a
/// `userId` so the same hook can render either the viewer's own streak or
/// another player's (e.g. when opened from a public profile).
@Observable
@MainActor
final class StreaksViewModel {
    private(set) var state: ViewState<StreaksResponse> = .idle
    let userId: String

    private let apiClient: APIClient

    init(apiClient: APIClient, userId: String) {
        self.apiClient = apiClient
        self.userId = userId
    }

    func load() async {
        state = .loading
        do {
            let resp = try await apiClient.send(.streaks(userId: userId))
            // A brand-new player gets 26 zero-count weeks back. Surface the
            // dedicated empty card instead of an all-grey heatmap so the
            // screen reads as "nothing yet" rather than "loaded but blank".
            if resp.current_streak_weeks == 0,
               resp.longest_streak_weeks == 0,
               resp.weeks.allSatisfy({ $0.games_count == 0 }) {
                state = .empty
            } else {
                state = .loaded(resp)
            }
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.errorDescription ?? String(localized: "common.error.generic"))
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }
}
