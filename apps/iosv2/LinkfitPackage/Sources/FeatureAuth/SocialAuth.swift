import Foundation
import Models
import AppCore

/// Runs the two social sign-in flows and exchanges the provider credential for a
/// Linkfit session via the repository. Shared by Login and Register screens.
@MainActor
public final class SocialAuth {
    private let repository: any AuthRepository
    private let googleProvider: (any GoogleAuthProviding)?

    public init(repository: any AuthRepository, google: (any GoogleAuthProviding)?) {
        self.repository = repository
        self.googleProvider = google
    }

    public var isGoogleAvailable: Bool { googleProvider != nil }

    public func signInWithApple() async throws -> User {
        let credential = try await AppleSignInCoordinator().signIn()
        return try await repository.signInApple(
            identityToken: credential.identityToken,
            authorizationCode: credential.authorizationCode,
            firstName: credential.firstName,
            lastName: credential.lastName
        )
    }

    public func signInWithGoogle() async throws -> User {
        guard let googleProvider else { throw GoogleAuthError.notConfigured }
        let idToken = try await googleProvider.signIn()
        return try await repository.signInGoogle(idToken: idToken)
    }
}
