import Foundation

/// Request bodies for the auth endpoints. camelCase here → snake_case on the
/// wire via the shared encoder's `.convertToSnakeCase` strategy.
struct LoginRequest: Encodable, Sendable {
    let email: String
    let password: String
}

struct RegisterRequest: Encodable, Sendable {
    let email: String
    let password: String
    let displayName: String
    let birthDate: String?
}

struct GoogleRequest: Encodable, Sendable {
    let idToken: String
}

struct AppleRequest: Encodable, Sendable {
    struct Name: Encodable, Sendable {
        let first: String
        let last: String
    }
    let identityToken: String
    let authorizationCode: String?
    let name: Name?
}

struct RequestResetRequest: Encodable, Sendable {
    let email: String
}

struct LogoutRequest: Encodable, Sendable {
    let refreshToken: String
}
