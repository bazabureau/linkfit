import SwiftUI
import DesignSystem
import FeatureAuth

/// Top-level router: shows the splash until launch bootstrap completes (with a
/// short minimum so it doesn't flash), then routes to auth or the main tabs.
struct RootView: View {
    let container: AppContainer
    @State private var ready = false

    var body: some View {
        Group {
            if !ready {
                SplashView()
            } else {
                switch container.session.state {
                case .checking:
                    SplashView()
                case .signedOut:
                    AuthRootView(
                        repository: container.authRepository,
                        google: container.googleAuth,
                        onAuthenticated: { container.session.didAuthenticate($0) }
                    )
                case .signedIn(let user):
                    AppTabView(container: container, user: user)
                }
            }
        }
        .animation(.easeInOut(duration: 0.35), value: ready)
        .toastHost(container.toasts)
        .environment(container.toasts)
        .task {
            let minSplash = Task { try? await Task.sleep(nanoseconds: 700_000_000) }
            await container.session.bootstrap(api: container.api)
            _ = await minSplash.value
            ready = true
        }
    }
}
