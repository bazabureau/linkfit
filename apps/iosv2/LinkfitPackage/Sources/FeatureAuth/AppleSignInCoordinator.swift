import Foundation
import AuthenticationServices
import CryptoKit
#if canImport(UIKit)
import UIKit
#endif

/// The raw credential returned by Sign in with Apple, ready to POST to the
/// backend. `firstName`/`lastName` are only populated on the very first sign-in.
public struct AppleCredential: Sendable {
    public let identityToken: String
    public let authorizationCode: String?
    public let firstName: String?
    public let lastName: String?
}

public enum AppleSignInError: Error, Sendable {
    case cancelled
    case missingToken
    case failed(String)
}

/// Bridges the delegate-based `ASAuthorizationController` to async/await. A nonce
/// is bound to the request (hashed) for replay protection at Apple's layer.
@MainActor
public final class AppleSignInCoordinator: NSObject {
    private var continuation: CheckedContinuation<AppleCredential, Error>?

    public override init() { super.init() }

    public func signIn() async throws -> AppleCredential {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let provider = ASAuthorizationAppleIDProvider()
            let request = provider.createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = Self.sha256(Self.randomNonce())

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    private func finish(_ result: Result<AppleCredential, Error>) {
        continuation?.resume(with: result)
        continuation = nil
    }

    private static func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remaining = length
        while remaining > 0 {
            var random: UInt8 = 0
            _ = SecRandomCopyBytes(kSecRandomDefault, 1, &random)
            if Int(random) < charset.count {
                result.append(charset[Int(random)])
                remaining -= 1
            }
        }
        return result
    }

    private static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

extension AppleSignInCoordinator: ASAuthorizationControllerDelegate {
    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard
            let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let tokenData = credential.identityToken,
            let identityToken = String(data: tokenData, encoding: .utf8)
        else {
            finish(.failure(AppleSignInError.missingToken))
            return
        }
        let authCode = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        finish(.success(AppleCredential(
            identityToken: identityToken,
            authorizationCode: authCode,
            firstName: credential.fullName?.givenName,
            lastName: credential.fullName?.familyName
        )))
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            finish(.failure(AppleSignInError.cancelled))
        } else {
            finish(.failure(AppleSignInError.failed(error.localizedDescription)))
        }
    }
}

extension AppleSignInCoordinator: ASAuthorizationControllerPresentationContextProviding {
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        #if canImport(UIKit)
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        return scene?.keyWindow ?? ASPresentationAnchor()
        #else
        return ASPresentationAnchor()
        #endif
    }
}
