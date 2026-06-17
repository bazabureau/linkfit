import UIKit
import AppCore
import GoogleSignIn

/// Concrete `GoogleAuthProviding` using the GoogleSignIn SDK. Lives in the app
/// target so the package never links the vendor SDK. Returns the OIDC id_token
/// for the backend to verify at `/api/v1/auth/google`.
@MainActor
final class GoogleAuthProvider: GoogleAuthProviding {
    private let clientID: String

    init(clientID: String) {
        self.clientID = clientID
    }

    func signIn() async throws -> String {
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
        guard let presenter = Self.topViewController() else {
            throw GoogleAuthError.failed("No view controller to present from")
        }
        do {
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
            guard let idToken = result.user.idToken?.tokenString, !idToken.isEmpty else {
                throw GoogleAuthError.failed("Google returned no id token")
            }
            return idToken
        } catch let error as GIDSignInError where error.code == .canceled {
            throw GoogleAuthError.cancelled
        }
    }

    private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        var top = scene?.keyWindow?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
