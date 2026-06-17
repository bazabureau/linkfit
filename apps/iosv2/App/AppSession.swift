import SwiftUI
import Observation
import Models
import Networking

/// The app's authentication state machine. `@Observable` so `RootView` re-renders
/// on transitions. Owns nothing UI; just the current auth status + the bootstrap
/// (resume-session-on-launch) and sign-out flows.
@MainActor
@Observable
final class AppSession {
    enum State: Equatable {
        case checking
        case signedOut
        case signedIn(User)
    }

    private(set) var state: State = .checking
    private let tokenStore: any TokenStoring

    init(tokenStore: any TokenStoring) {
        self.tokenStore = tokenStore
    }

    /// On launch: if a token exists, verify it by fetching `/me`; otherwise the
    /// user is signed out. A hard failure clears the (now useless) tokens.
    func bootstrap(api: any APIClient) async {
        guard await tokenStore.tokens() != nil else {
            state = .signedOut
            return
        }
        do {
            let user: User = try await api.send(Endpoint(method: .get, path: "/api/v1/me"))
            state = .signedIn(user)
        } catch {
            await tokenStore.clear()
            state = .signedOut
        }
    }

    func didAuthenticate(_ user: User) {
        state = .signedIn(user)
    }

    func signOut() {
        state = .signedOut
        Task { await tokenStore.clear() }
    }
}
