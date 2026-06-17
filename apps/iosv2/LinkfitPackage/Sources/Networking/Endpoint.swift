import Foundation

public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

/// Type-erased `Encodable` so `Endpoint` can carry any request body while staying
/// a concrete `Sendable` value type. The wrapped value must itself be `Sendable`.
public struct AnyEncodable: Encodable, Sendable {
    private let encodeFunc: @Sendable (Encoder) throws -> Void

    public init<T: Encodable & Sendable>(_ wrapped: T) {
        self.encodeFunc = { try wrapped.encode(to: $0) }
    }

    public func encode(to encoder: Encoder) throws {
        try encodeFunc(encoder)
    }
}

/// A single API call described as data. Endpoints are declared per-domain as
/// static factories (e.g. `Endpoint.login(...)`) so call sites read declaratively
/// and the surface stays discoverable.
public struct Endpoint: Sendable {
    public let method: HTTPMethod
    public let path: String
    public var query: [String: String]
    public var body: AnyEncodable?
    public var requiresAuth: Bool

    public init(
        method: HTTPMethod,
        path: String,
        query: [String: String] = [:],
        body: AnyEncodable? = nil,
        requiresAuth: Bool = true
    ) {
        self.method = method
        self.path = path
        self.query = query
        self.body = body
        self.requiresAuth = requiresAuth
    }

    /// Convenience for JSON-body requests.
    public init<B: Encodable & Sendable>(
        method: HTTPMethod,
        path: String,
        query: [String: String] = [:],
        json: B,
        requiresAuth: Bool = true
    ) {
        self.init(
            method: method,
            path: path,
            query: query,
            body: AnyEncodable(json),
            requiresAuth: requiresAuth
        )
    }
}
