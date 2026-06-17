import Foundation

/// The single seam every repository talks to. Implemented by
/// `URLSessionAPIClient`; mocked in tests. `Sendable` so it can be shared across
/// actors and captured by `@Sendable` closures.
public protocol APIClient: Sendable {
    /// Send a request and decode the 2xx body as `T`.
    func send<T: Decodable & Sendable>(_ endpoint: Endpoint, as type: T.Type) async throws -> T
    /// Send a request and discard the body (still throws on non-2xx).
    func send(_ endpoint: Endpoint) async throws
    /// Multipart image upload; returns the stored media URL.
    func upload(image data: Data, to path: String) async throws -> URL
}

public extension APIClient {
    /// Type-inferred convenience: `let user: User = try await client.send(.me())`.
    func send<T: Decodable & Sendable>(_ endpoint: Endpoint) async throws -> T {
        try await send(endpoint, as: T.self)
    }
}
