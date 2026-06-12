//  GoogleSignInService.swift
//  Linkfit
//
//  Google Sign-In — the iOS-side wrapper.
//
//  Uses Google's `GoogleSignIn-iOS` SwiftPM package (declared in project.yml
//  under `packages.GoogleSignIn`). After the system flow completes we hand
//  the resulting `id_token` to the Linkfit backend at `/api/v1/auth/google`,
//  which verifies the JWS against Google's JWKS and returns a Linkfit session
//  in the standard shape.
//
//  Client ID is read at runtime from the `GIDClientID` Info.plist key (set in
//  project.yml's `info.properties` section). On dev builds without a real
//  client ID we throw a clear error at sign-in time rather than crashing on
//  launch — this way the rest of the auth UI still functions.

import Foundation
import GoogleSignIn
import UIKit

enum GoogleSignInError: LocalizedError {
    case missingClientID
    case canceled
    case networkOffline
    case noIDToken
    case noPresenter
    case backendRejected(String)
    case underlying(String)

    var errorDescription: String? {
        switch self {
        case .missingClientID:
            return "Google sign-in isn't configured for this build (missing GIDClientID)."
        case .canceled:
            return String(localized: "auth.error.signin_cancelled")
        case .networkOffline:
            return String(localized: "error.network_offline")
        case .noIDToken:
            return String(localized: "auth.error.google_no_token")
        case .noPresenter:
            return "Couldn't find a presenting view controller for Google sign-in."
        case .backendRejected(let message):
            return message
        case .underlying(let message):
            return message
        }
    }
}

@MainActor
final class GoogleSignInService {
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Runs the system Google sign-in sheet and exchanges the resulting
    /// `id_token` for a Linkfit session.
    func signIn() async throws -> AuthSession {
        guard let clientID = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
              !clientID.isEmpty,
              !clientID.contains("REPLACE_WITH") else {
            throw GoogleSignInError.missingClientID
        }
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)

        guard let presenter = Self.topViewController() else {
            throw GoogleSignInError.noPresenter
        }

        let result: GIDSignInResult
        do {
            result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
        } catch {
            let ns = error as NSError
            if ns.domain == kGIDSignInErrorDomain,
               ns.code == GIDSignInError.canceled.rawValue {
                throw GoogleSignInError.canceled
            }
            // The Google flow ultimately funnels through URLSession when it
            // fetches the discovery document and token endpoints. Map known
            // offline URL errors to our dedicated case so the toast reads
            // "No internet connection" instead of a raw CFNetwork string.
            if ns.domain == NSURLErrorDomain &&
               (ns.code == NSURLErrorNotConnectedToInternet ||
                ns.code == NSURLErrorNetworkConnectionLost ||
                ns.code == NSURLErrorDataNotAllowed) {
                throw GoogleSignInError.networkOffline
            }
            throw GoogleSignInError.underlying(error.localizedDescription)
        }

        guard let idToken = result.user.idToken?.tokenString, !idToken.isEmpty else {
            throw GoogleSignInError.noIDToken
        }

        do {
            return try await apiClient.send(.googleSignIn(idToken: idToken))
        } catch let error as APIError {
            // Distinguish offline so we can show the localized network copy
            // rather than the generic "server rejected" wording.
            if case .offline = error {
                throw GoogleSignInError.networkOffline
            }
            throw GoogleSignInError.backendRejected(
                error.localizedMessage
            )
        }
    }

    /// Walk up the foreground key-window's view-controller chain to find the
    /// top-most presenter for the GIDSignIn UI.
    private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive })
        guard let root = scene?.keyWindow?.rootViewController else { return nil }
        var current = root
        while let presented = current.presentedViewController {
            current = presented
        }
        return current
    }
}

// MARK: - Endpoint

extension Endpoint where Response == AuthSession {
    /// POST /api/v1/auth/google — see oauth.routes.ts. The server verifies
    /// the ID token against Google's JWKS and returns a Linkfit session.
    static func googleSignIn(idToken: String) -> Endpoint<AuthSession> {
        Endpoint(method: .post, path: "/api/v1/auth/google",
                 body: try? JSONSerialization.data(withJSONObject: ["id_token": idToken]))
    }
}
