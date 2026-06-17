import SwiftUI
import AppCore
import Models
import Networking
import Persistence
import DesignSystem

/// Composition root. Builds every dependency once and owns them for the app's
/// lifetime. Features receive what they need through their root-view initializers
/// (constructed here / in `AppTabView`) — no global singletons in feature code.
@MainActor
final class AppContainer {
    let env: EnvConfig
    let tokenStore: TokenStore
    let api: any APIClient
    let sse: SSEClient
    let haptics: any Haptics
    let analytics: any AnalyticsClient
    let toasts: ToastCenter
    let session: AppSession

    init() {
        let env = EnvConfig.load()
        self.env = env

        let tokenStore = TokenStore()
        self.tokenStore = tokenStore

        let session = AppSession(tokenStore: tokenStore)
        self.session = session

        self.api = URLSessionAPIClient(
            baseURL: env.apiBaseURL,
            tokenStore: tokenStore,
            certPins: env.certPins,
            onUnauthorized: { [weak session] in
                Task { @MainActor in session?.signOut() }
            }
        )
        self.sse = SSEClient(baseURL: env.apiBaseURL, tokenStore: tokenStore, certPins: env.certPins)
        self.haptics = SystemHaptics()
        self.analytics = NoopAnalytics()
        self.toasts = ToastCenter()
    }
}
