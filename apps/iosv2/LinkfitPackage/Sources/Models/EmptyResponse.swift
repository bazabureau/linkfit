import Foundation

/// Placeholder for endpoints that return no meaningful body (e.g. join/leave,
/// logout). Decodes from `{}`, `[]`, or an empty payload.
public struct EmptyResponse: Codable, Sendable, Equatable {
    public init() {}
    public init(from decoder: Decoder) throws {}
    public func encode(to encoder: Encoder) throws {}
}
