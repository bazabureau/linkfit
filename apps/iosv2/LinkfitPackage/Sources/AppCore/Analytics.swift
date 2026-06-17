import Foundation

/// Product-analytics seam. The real PostHog implementation lives in the app
/// target (so the package stays SDK-free); features depend only on this protocol.
/// `NoopAnalytics` is used whenever no key is configured (dev/CI) and in tests.
public protocol AnalyticsClient: Sendable {
    func track(_ event: String, _ properties: [String: String])
    func identify(_ userID: String)
    func reset()
}

public extension AnalyticsClient {
    func track(_ event: String) { track(event, [:]) }
}

public struct NoopAnalytics: AnalyticsClient {
    public init() {}
    public func track(_ event: String, _ properties: [String: String]) {}
    public func identify(_ userID: String) {}
    public func reset() {}
}
