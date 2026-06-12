//  AppleSignInService.swift
//  Linkfit
//
//  Sign in with Apple — the iOS-side wrapper.
//
//  Apple's `ASAuthorizationAppleIDProvider` performs a system-managed sign-in
//  flow that returns an identity token (a JWS the backend can verify against
//  Apple's JWKS). We never touch passwords; the Linkfit server is the sole
//  party that establishes session trust by verifying the JWS.
//
//  Threading model: `signIn(presentationAnchor:)` is `@MainActor` because
//  ASAuthorizationController requires a main-thread presentation context.
//  The continuation hop back through the delegate happens on the main thread
//  too, so the whole flow stays main-bound.

import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// Errors surfaced from the Apple sign-in pipeline. We collapse the system's
/// many internal codes into a small enum the UI can show without leaking
/// implementation details.
///
/// `.networkOffline` is split out from the catch-all so the UI can show the
/// localized "no internet" copy instead of the raw `NSURLError` description.
/// `.backendRejected` deliberately carries the original `APIError` (when
/// available) so callers can still distinguish offline / timeout / 5xx if
/// they want to — `errorDescription` resolves to a sensible localized string
/// either way.
enum AppleSignInError: LocalizedError {
    case canceled
    case networkOffline
    case noIdentityToken
    case authorizationFailed(String)
    case backendRejected(String)

    var errorDescription: String? {
        switch self {
        case .canceled:
            return String(localized: "auth.error.signin_cancelled")
        case .networkOffline:
            return String(localized: "error.network_offline")
        case .noIdentityToken:
            return String(localized: "auth.error.apple_no_token")
        case .authorizationFailed(let message):
            return message
        case .backendRejected(let message):
            return message
        }
    }
}

@MainActor
final class AppleSignInService: NSObject {
    private let apiClient: APIClient
    private var continuation: CheckedContinuation<AuthSession, Error>?
    private var currentNonce: String?

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        super.init()
    }

    /// Drives the Apple authorization flow end-to-end and exchanges the
    /// resulting identity token for a Linkfit session by POSTing to
    /// `/api/v1/auth/apple`. The exchange happens on the server side, which
    /// is responsible for verifying the JWS signature & claims.
    func signIn() async throws -> AuthSession {
        // Apple recommends binding a single-use nonce to the identity token so
        // that replay of an intercepted token against another app/session is
        // impossible. We send the sha256(nonce) so it ends up in the token's
        // `nonce` claim, but we keep the raw nonce locally for verification.
        let raw = randomNonceString()
        currentNonce = raw

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<AuthSession, Error>) in
            self.continuation = continuation

            let provider = ASAuthorizationAppleIDProvider()
            let request = provider.createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = sha256(raw)

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    // MARK: - Helpers

    /// 32-byte URL-safe random nonce — Apple's recommended length.
    private func randomNonceString(length: Int = 32) -> String {
        let charset: [Character] =
            Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remaining = length
        while remaining > 0 {
            var random: UInt8 = 0
            let err = SecRandomCopyBytes(kSecRandomDefault, 1, &random)
            if err != errSecSuccess { continue }
            if random < charset.count {
                result.append(charset[Int(random) % charset.count])
                remaining -= 1
            }
        }
        return result
    }

    private func sha256(_ input: String) -> String {
        let data = Data(input.utf8)
        let hashed = SHA256.hash(data: data)
        return hashed.compactMap { String(format: "%02x", $0) }.joined()
    }

    private func resume(_ result: Result<AuthSession, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        self.currentNonce = nil
        switch result {
        case .success(let session):
            continuation.resume(returning: session)
        case .failure(let error):
            continuation.resume(throwing: error)
        }
    }
}

// MARK: - ASAuthorizationControllerDelegate

extension AppleSignInService: ASAuthorizationControllerDelegate {
    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            resume(.failure(AppleSignInError.authorizationFailed("Unexpected credential type")))
            return
        }
        guard let identityTokenData = credential.identityToken,
              let identityToken = String(data: identityTokenData, encoding: .utf8) else {
            resume(.failure(AppleSignInError.noIdentityToken))
            return
        }
        // `authorizationCode` is sometimes nil on subsequent sign-ins; we send
        // it when present so the backend can call Apple's `/auth/token`
        // endpoint in the future if we ever need refresh tokens from Apple.
        let authCode = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }

        // Apple only returns full name on the FIRST authorization — afterwards
        // the fields are nil. Pass them through so the server can use them
        // when minting the user row.
        let givenName = credential.fullName?.givenName
        let familyName = credential.fullName?.familyName

        // Persist the stable Apple user identifier so a subsequent app launch
        // can call `ASAuthorizationAppleIDProvider.getCredentialState(forUserID:)`
        // and discover when the user revoked access via iOS Settings →
        // Sign in with Apple → Linkfit → Stop Using. The string is not
        // sensitive (it's the same ID across our backend), so plain
        // UserDefaults is fine — no need to widen `TokenStoring`.
        AppleSignInService.storeUserID(credential.user)

        Task { [apiClient] in
            do {
                let session = try await apiClient.send(
                    .appleSignIn(
                        identityToken: identityToken,
                        authorizationCode: authCode,
                        givenName: givenName,
                        familyName: familyName
                    )
                )
                self.resume(.success(session))
            } catch let error as APIError {
                // Surface offline as a distinct case so the UI shows the
                // localized "no internet" copy instead of the raw URLError
                // string. Other API errors fall through to backendRejected
                // with their already-localized `errorDescription`.
                if case .offline = error {
                    self.resume(.failure(AppleSignInError.networkOffline))
                } else {
                    self.resume(.failure(AppleSignInError.backendRejected(
                        error.localizedMessage
                    )))
                }
            } catch {
                self.resume(.failure(error))
            }
        }
    }

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithError error: Error) {
        // ASAuthorizationError.canceled is the user explicitly bailing — we
        // map it to a sentinel that the caller can ignore quietly.
        if let asError = error as? ASAuthorizationError, asError.code == .canceled {
            resume(.failure(AppleSignInError.canceled))
            return
        }
        // The system flow can also fail purely because the device is offline
        // (Apple needs to validate the request server-side). Surface that as
        // the dedicated case so the toast reads "No internet connection"
        // instead of a CFNetwork-flavoured string.
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain &&
           (ns.code == NSURLErrorNotConnectedToInternet ||
            ns.code == NSURLErrorNetworkConnectionLost ||
            ns.code == NSURLErrorDataNotAllowed) {
            resume(.failure(AppleSignInError.networkOffline))
            return
        }
        resume(.failure(AppleSignInError.authorizationFailed(error.localizedDescription)))
    }
}

// MARK: - Apple user ID persistence (for credential-state-check on launch)

extension AppleSignInService {
    /// UserDefaults key under which we cache the stable Apple user identifier
    /// (the `user` field on `ASAuthorizationAppleIDCredential`). Used by
    /// `AppContainer.refreshAppleCredentialStateIfNeeded()` on launch.
    static let appleUserIDDefaultsKey = "linkfit.auth.apple_user_id"

    static func storeUserID(_ userID: String) {
        UserDefaults.standard.set(userID, forKey: appleUserIDDefaultsKey)
    }

    static func storedUserID() -> String? {
        UserDefaults.standard.string(forKey: appleUserIDDefaultsKey)
    }

    static func clearStoredUserID() {
        UserDefaults.standard.removeObject(forKey: appleUserIDDefaultsKey)
    }
}

// MARK: - Presentation anchor

extension AppleSignInService: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        // Use the connected foreground window — Apple's controller needs a
        // backing window to draw on. Falling back to a fresh UIWindow keeps
        // the code valid in tests without a live scene.
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive })
        return scene?.keyWindow ?? UIWindow()
    }
}

// MARK: - APIClient extension

extension Endpoint where Response == AuthSession {
    /// POST /api/v1/auth/apple — see oauth.routes.ts. The server verifies the
    /// `identity_token` against Apple's JWKS, upserts the user, and returns
    /// a Linkfit session. `name` is only meaningful on the first call.
    static func appleSignIn(identityToken: String,
                            authorizationCode: String?,
                            givenName: String?,
                            familyName: String?) -> Endpoint<AuthSession> {
        var body: [String: Any] = ["identity_token": identityToken]
        if let authorizationCode { body["authorization_code"] = authorizationCode }
        var name: [String: String] = [:]
        if let givenName, !givenName.isEmpty { name["first"] = givenName }
        if let familyName, !familyName.isEmpty { name["last"] = familyName }
        if !name.isEmpty { body["name"] = name }
        return Endpoint(method: .post, path: "/api/v1/auth/apple",
                        body: try? JSONSerialization.data(withJSONObject: body))
    }
}
