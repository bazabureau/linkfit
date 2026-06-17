import Foundation
import Models
import AppCore

/// One parsed Server-Sent Event.
public struct SSEEvent: Sendable, Equatable {
    public let event: String?
    public let data: String

    public init(event: String?, data: String) {
        self.event = event
        self.data = data
    }
}

/// Long-lived Server-Sent Events client for realtime chat / notifications.
/// Exposes a back-pressure-free `AsyncStream`; reconnects automatically with
/// capped exponential backoff until the consuming task is cancelled.
public final class SSEClient: Sendable {
    private let baseURL: URL
    private let tokenStore: any TokenStoring
    private let session: URLSession

    public init(baseURL: URL, tokenStore: any TokenStoring, certPins: [String] = []) {
        self.baseURL = baseURL
        self.tokenStore = tokenStore
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = .infinity
        configuration.timeoutIntervalForResource = .infinity
        let delegate: URLSessionDelegate? = certPins.isEmpty ? nil : PinningDelegate(pins: certPins)
        self.session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    }

    public func stream(path: String, query: [String: String] = [:]) -> AsyncStream<SSEEvent> {
        AsyncStream { continuation in
            let task = Task { [baseURL, session, tokenStore] in
                var backoffSeconds: UInt64 = 1
                while !Task.isCancelled {
                    do {
                        var components = URLComponents(
                            url: baseURL.appendingPathComponent(path),
                            resolvingAgainstBaseURL: false
                        )
                        if !query.isEmpty {
                            components?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
                        }
                        guard let url = components?.url else { break }

                        var request = URLRequest(url: url)
                        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                        if let token = await tokenStore.currentAccessToken() {
                            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                        }

                        let (bytes, response) = try await session.bytes(for: request)
                        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                            throw URLError(.badServerResponse)
                        }
                        backoffSeconds = 1  // healthy connection — reset backoff

                        var eventName: String?
                        var dataLines: [String] = []
                        for try await line in bytes.lines {
                            if line.isEmpty {
                                if !dataLines.isEmpty {
                                    continuation.yield(SSEEvent(event: eventName, data: dataLines.joined(separator: "\n")))
                                }
                                eventName = nil
                                dataLines = []
                            } else if line.hasPrefix(":") {
                                continue  // comment / heartbeat
                            } else if let value = line.fieldValue(prefix: "event:") {
                                eventName = value
                            } else if let value = line.fieldValue(prefix: "data:") {
                                dataLines.append(value)
                            }
                        }
                    } catch {
                        AppLog.debug("SSE disconnected: \(error.localizedDescription)", category: "sse")
                    }

                    if Task.isCancelled { break }
                    try? await Task.sleep(nanoseconds: backoffSeconds * 1_000_000_000)
                    backoffSeconds = min(backoffSeconds * 2, 30)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

private extension String {
    func fieldValue(prefix: String) -> String? {
        guard hasPrefix(prefix) else { return nil }
        return String(dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
    }
}
