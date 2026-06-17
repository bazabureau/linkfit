import Foundation
import Models
import Networking

/// Domain operations for authentication. The live implementation persists tokens
/// on success so callers only ever deal in `User`. Mocked in tests.
public protocol AuthRepository: Sendable {
    func login(email: String, password: String) async throws -> User
    func register(name: String, email: String, password: String, birthDate: String?) async throws -> User
    func signInGoogle(idToken: String) async throws -> User
    func signInApple(identityToken: String, authorizationCode: String?, firstName: String?, lastName: String?) async throws -> User
    func requestPasswordReset(email: String) async throws
    func logout() async
}

public struct LiveAuthRepository: AuthRepository {
    private let api: any APIClient
    private let tokenStore: any TokenStoring

    public init(api: any APIClient, tokenStore: any TokenStoring) {
        self.api = api
        self.tokenStore = tokenStore
    }

    public func login(email: String, password: String) async throws -> User {
        try await authenticate(AuthEndpoints.login(email: email, password: password))
    }

    public func register(name: String, email: String, password: String, birthDate: String?) async throws -> User {
        try await authenticate(AuthEndpoints.register(email: email, password: password, displayName: name, birthDate: birthDate))
    }

    public func signInGoogle(idToken: String) async throws -> User {
        try await authenticate(AuthEndpoints.google(idToken: idToken))
    }

    public func signInApple(identityToken: String, authorizationCode: String?, firstName: String?, lastName: String?) async throws -> User {
        let name: AppleRequest.Name?
        if let firstName, let lastName, !(firstName.isEmpty && lastName.isEmpty) {
            name = AppleRequest.Name(first: firstName, last: lastName)
        } else {
            name = nil
        }
        return try await authenticate(AuthEndpoints.apple(identityToken: identityToken, authorizationCode: authorizationCode, name: name))
    }

    public func requestPasswordReset(email: String) async throws {
        try await api.send(AuthEndpoints.requestPasswordReset(email: email))
    }

    public func logout() async {
        if let tokens = await tokenStore.tokens() {
            try? await api.send(AuthEndpoints.logout(refreshToken: tokens.refreshToken))
        }
        await tokenStore.clear()
    }

    /// Shared tail: decode the session, persist tokens, return the user.
    private func authenticate(_ endpoint: Endpoint) async throws -> User {
        let session: AuthSessionDTO = try await api.send(endpoint)
        await tokenStore.save(session.tokens())
        return session.user
    }
}
