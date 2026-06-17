import Foundation
import Networking

/// Auth endpoint factories. Paths + payloads mirror the live backend 1:1
/// (verified against v1). All are unauthenticated except where noted.
enum AuthEndpoints {
    static func login(email: String, password: String) -> Endpoint {
        Endpoint(method: .post, path: "/api/v1/auth/login",
                 json: LoginRequest(email: email, password: password), requiresAuth: false)
    }

    static func register(email: String, password: String, displayName: String, birthDate: String?) -> Endpoint {
        Endpoint(method: .post, path: "/api/v1/auth/register",
                 json: RegisterRequest(email: email, password: password, displayName: displayName, birthDate: birthDate),
                 requiresAuth: false)
    }

    static func google(idToken: String) -> Endpoint {
        Endpoint(method: .post, path: "/api/v1/auth/google",
                 json: GoogleRequest(idToken: idToken), requiresAuth: false)
    }

    static func apple(identityToken: String, authorizationCode: String?, name: AppleRequest.Name?) -> Endpoint {
        Endpoint(method: .post, path: "/api/v1/auth/apple",
                 json: AppleRequest(identityToken: identityToken, authorizationCode: authorizationCode, name: name),
                 requiresAuth: false)
    }

    static func requestPasswordReset(email: String) -> Endpoint {
        Endpoint(method: .post, path: "/api/v1/auth/request-password-reset",
                 json: RequestResetRequest(email: email), requiresAuth: false)
    }

    static func logout(refreshToken: String) -> Endpoint {
        Endpoint(method: .post, path: "/api/v1/auth/logout",
                 json: LogoutRequest(refreshToken: refreshToken), requiresAuth: false)
    }

    static let me = Endpoint(method: .get, path: "/api/v1/me")
}
