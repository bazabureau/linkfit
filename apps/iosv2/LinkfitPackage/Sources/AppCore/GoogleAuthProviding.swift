import Foundation

/// Seam for Google Sign-In. The concrete implementation (using the GoogleSignIn
/// SDK) lives in the app target so the package never links a third-party SDK.
/// `FeatureAuth` depends only on this protocol and is handed an instance via DI.
public protocol GoogleAuthProviding: Sendable {
    /// Presents the Google sign-in sheet and returns the OIDC `id_token` to POST
    /// to `/api/v1/auth/google`. Throws `GoogleAuthError.cancelled` on user cancel.
    @MainActor func signIn() async throws -> String
}

public enum GoogleAuthError: Error, Sendable {
    case cancelled
    case notConfigured
    case failed(String)
}
