import SwiftUI

struct RootView: View {
    @Environment(AppContainer.self) private var container
    @AppStorage("linkfit.hasSeenOnboarding.v2") private var hasSeenOnboarding: Bool = false

    /// Splash gate. The branded SplashView plays once per launch (regardless
    /// of auth state) so users always see the wordmark before the routed
    /// content. SplashView's animation completes and calls `onFinished`,
    /// which flips this to `false`.
    @State private var showingSplash: Bool = true

    var body: some View {
        ZStack {
            content
                .animation(.easeInOut(duration: 0.28), value: container.isAuthenticated)
                .animation(.easeInOut(duration: 0.28), value: hasSeenOnboarding)
                .opacity(showingSplash ? 0 : 1)

            if showingSplash {
                SplashView {
                    withAnimation(.easeInOut(duration: 0.35)) {
                        showingSplash = false
                    }
                }
                .transition(.opacity)
                .zIndex(1)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if !hasSeenOnboarding {
            OnboardingView {
                hasSeenOnboarding = true
            }
            .transition(.opacity)
        } else if container.isAuthenticated {
            // `AppShell` wraps `HomeView` and owns the first-launch
            // activation tour (`OnboardingTourView`). Routing concerns
            // stay here in `RootView`; the post-auth in-app experience
            // — including push-permission prompting via the tour's final
            // slide and the existing `pushRegistrar.start()` fallback —
            // belongs inside the shell.
            AppShell()
                .transition(.opacity)
        } else {
            AuthGateView(viewModel: AuthViewModel(apiClient: container.apiClient,
                                                  container: container))
                .transition(.opacity)
        }
    }

}
