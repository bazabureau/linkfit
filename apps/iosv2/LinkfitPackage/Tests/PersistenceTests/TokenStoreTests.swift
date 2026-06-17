import Testing
import Foundation
import Models
@testable import Persistence

/// In-memory `SecureStore` so tests never touch the real Keychain.
final class InMemorySecureStore: SecureStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: Data] = [:]

    func data(for key: String) -> Data? { lock.withLock { storage[key] } }
    func set(_ data: Data, for key: String) { lock.withLock { storage[key] = data } }
    func remove(_ key: String) { lock.withLock { storage[key] = nil } }
}

@Suite struct TokenStoreTests {
    private func makeTokens() -> AuthTokens {
        AuthTokens(
            accessToken: "access-123",
            refreshToken: "refresh-456",
            expiresAt: Date().addingTimeInterval(900)
        )
    }

    @Test func savesAndReadsBack() async {
        let store = TokenStore(store: InMemorySecureStore(), key: "tokens")
        let tokens = makeTokens()

        await store.save(tokens)

        #expect(await store.currentAccessToken() == "access-123")
        #expect(await store.tokens() == tokens)
    }

    @Test func clearRemovesEverything() async {
        let store = TokenStore(store: InMemorySecureStore(), key: "tokens")
        await store.save(makeTokens())

        await store.clear()

        #expect(await store.tokens() == nil)
        #expect(await store.currentAccessToken() == nil)
    }

    @Test func survivesAcrossInstances() async {
        let backing = InMemorySecureStore()
        let first = TokenStore(store: backing, key: "tokens")
        await first.save(makeTokens())

        // A fresh actor reading the same backing store should see the tokens.
        let second = TokenStore(store: backing, key: "tokens")
        #expect(await second.currentAccessToken() == "access-123")
    }
}
