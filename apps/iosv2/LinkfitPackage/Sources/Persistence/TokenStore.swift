import Foundation
import Models

/// `TokenStoring` implementation. An `actor` so reads/writes from the API client,
/// the refresher, and the UI never race. Keeps an in-memory copy to avoid a
/// Keychain hit on every request; the `SecureStore` remains the source of truth
/// across launches.
public actor TokenStore: TokenStoring {
    private let store: any SecureStore
    private let key: String
    private var cached: AuthTokens?
    private var didLoad = false

    public init(
        store: any SecureStore = KeychainStore(service: "az.linkfit.v2.session"),
        key: String = "tokens"
    ) {
        self.store = store
        self.key = key
    }

    public func currentAccessToken() async -> String? {
        await tokens()?.accessToken
    }

    public func tokens() async -> AuthTokens? {
        if didLoad { return cached }
        defer { didLoad = true }
        guard
            let data = store.data(for: key),
            let decoded = try? JSONDecoder().decode(AuthTokens.self, from: data)
        else {
            cached = nil
            return nil
        }
        cached = decoded
        return decoded
    }

    public func save(_ tokens: AuthTokens) async {
        cached = tokens
        didLoad = true
        if let data = try? JSONEncoder().encode(tokens) {
            store.set(data, for: key)
        }
    }

    public func clear() async {
        cached = nil
        didLoad = true
        store.remove(key)
    }
}
