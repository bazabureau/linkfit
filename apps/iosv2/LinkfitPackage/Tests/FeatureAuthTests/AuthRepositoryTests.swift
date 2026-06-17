import Testing
import Foundation
import Models
import Networking
@testable import FeatureAuth

/// API client double that decodes a canned JSON body for any request — exercises
/// the real decoder path without a network.
struct StubAPIClient: APIClient {
    let json: String
    func send<T: Decodable & Sendable>(_ endpoint: Endpoint, as type: T.Type) async throws -> T {
        try JSON.decoder.decode(T.self, from: Data(json.utf8))
    }
    func send(_ endpoint: Endpoint) async throws {}
    func upload(image data: Data, to path: String) async throws -> URL { URL(string: "https://x")! }
}

actor MemoryTokenStore: TokenStoring {
    private var current: AuthTokens?
    func currentAccessToken() async -> String? { current?.accessToken }
    func tokens() async -> AuthTokens? { current }
    func save(_ tokens: AuthTokens) async { current = tokens }
    func clear() async { current = nil }
}

@Suite struct AuthRepositoryTests {
    private let sessionJSON = #"""
    {"user":{"id":"u1","email":"a@b.c","display_name":"Kamran","created_at":"2026-06-01T10:00:00Z"},
     "access_token":"acc","refresh_token":"ref","access_token_expires_in_seconds":900}
    """#

    @Test func loginReturnsUserAndPersistsTokens() async throws {
        let store = MemoryTokenStore()
        let repo = LiveAuthRepository(api: StubAPIClient(json: sessionJSON), tokenStore: store)

        let user = try await repo.login(email: "a@b.c", password: "secret1")

        #expect(user.id == "u1")
        #expect(user.displayName == "Kamran")
        #expect(await store.currentAccessToken() == "acc")
        let tokens = await store.tokens()
        #expect(tokens?.refreshToken == "ref")
        #expect(tokens?.expiresAt ?? .distantPast > Date())  // expiry stamped in the future
    }

    @Test func registerPersistsSession() async throws {
        let store = MemoryTokenStore()
        let repo = LiveAuthRepository(api: StubAPIClient(json: sessionJSON), tokenStore: store)

        let user = try await repo.register(name: "Kamran", email: "a@b.c", password: "secret1", birthDate: nil)

        #expect(user.id == "u1")
        #expect(await store.currentAccessToken() == "acc")
    }

    @Test func logoutClearsTokens() async {
        let store = MemoryTokenStore()
        await store.save(AuthTokens(accessToken: "acc", refreshToken: "ref", expiresAt: Date().addingTimeInterval(900)))
        let repo = LiveAuthRepository(api: StubAPIClient(json: "{}"), tokenStore: store)

        await repo.logout()

        #expect(await store.tokens() == nil)
    }
}
