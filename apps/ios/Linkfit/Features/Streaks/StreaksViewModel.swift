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
            state = .loaded(resp)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.errorDescription ?? String(localized: "common.error.generic"))
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }
}
