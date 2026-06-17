import Foundation
import Models

/// Intercepts requests so tests can script responses without a live server.
/// The handler is global, so the networking suite runs serialized.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) -> (Int, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        let (status, data) = handler(request)
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// Thread-safe call counter for scripting "first call vs retry" behavior.
final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    /// Returns the current value, then increments (first call -> 0).
    func next() -> Int { lock.withLock { defer { value += 1 }; return value } }
}

/// `TokenStoring` test double — no Keychain, no Persistence dependency.
actor MockTokenStore: TokenStoring {
    private var current: AuthTokens?
    init(_ tokens: AuthTokens? = nil) { current = tokens }
    func currentAccessToken() async -> String? { current?.accessToken }
    func tokens() async -> AuthTokens? { current }
    func save(_ tokens: AuthTokens) async { current = tokens }
    func clear() async { current = nil }
}
