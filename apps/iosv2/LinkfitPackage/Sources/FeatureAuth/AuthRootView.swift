import SwiftUI
import Models
import AppCore

/// Public entry point for the unauthenticated flow. The app injects a repository,
/// an optional Google provider, and a callback fired with the signed-in `User`.
public struct AuthRootView: View {
    private let deps: AuthDependencies

    public init(
        repository: any AuthRepository,
        google: (any GoogleAuthProviding)?,
        onAuthenticated: @escaping (User) -> Void
    ) {
        let social = SocialAuth(repository: repository, google: google)
        self.deps = AuthDependencies(repository: repository, social: social, onAuthenticated: onAuthenticated)
    }

    public var body: some View {
        NavigationStack {
            LoginView(deps: deps)
        }
    }
}
