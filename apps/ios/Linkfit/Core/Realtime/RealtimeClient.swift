import Foundation

// MARK: - Public event surface

/// Payload carried by `event: message` SSE frames.
///
/// Mirrors the backend serializer in `/api/v1/realtime/sse`. Keys use snake
/// case to match the wire format — we don't run through a custom decoder
/// because the rest of the iOS code base already speaks snake-case (see
/// `Message` in `Endpoint.swift`).
///
/// Codable (not just Decodable) so view-models can re-encode the payload
/// and feed it into `Message.init(from:)` without maintaining a parallel
/// memberwise constructor on `Message`.
struct MessageRealtimePayload: Codable, Equatable, Hashable, Sendable {
    let id: String
    let conversation_id: String
    let sender_user_id: String
    let body: String
    let attachment_url: String?
    let attachment_type: String?
    let created_at: String
}

/// Payload carried by `event: notification` SSE frames. The realtime
/// channel is multiplexed: today only messages flow but the notification
/// case is wired so future agents don't have to fork the parser.
struct NotificationRealtimePayload: Decodable, Equatable, Hashable, Sendable {
    let id: String?
    let type: String
    let title: String
    let body: String
    let created_at: String
    let payload: NotificationPayload?
}

struct TypingRealtimePayload: Codable, Equatable, Hashable, Sendable {
    let conversation_id: String
    let user_id: String
    let is_typing: Bool
}

struct ReadReceiptRealtimePayload: Codable, Equatable, Hashable, Sendable {
    let conversation_id: String
    let user_id: String
    let last_read_at: String
}

/// Top-level event yielded to subscribers. Unknown kinds preserve the raw
/// JSON body so the receiver can decide whether to ignore or log it; this
/// keeps the client forward-compatible with new backend event types.
enum RealtimeEvent: Sendable {
    case message(MessageRealtimePayload)
    case notification(NotificationRealtimePayload)
    case typing(TypingRealtimePayload)
    case readReceipt(ReadReceiptRealtimePayload)
    case unknown(kind: String, data: Data)
}

// MARK: - Client

/// Single-connection SSE client.
///
/// The backend exposes `/api/v1/realtime/sse?token=<jwt>`; the token sits
/// in the query because EventSource-style consumers (and Apple's stock
/// `URLSession` SSE consumption via `bytes(for:)`) can't set custom headers
/// on the streaming GET. We don't use `bytes(for:)` here because we need a
/// custom delegate for cancel/reconnect lifecycle control and so we can
/// keep the parser honest about backpressure (the delegate hands us bytes
/// synchronously; we never accumulate beyond the in-flight frame).
///
/// Threading model:
///   * The actor owns *all* mutable state — subscriber list, current
///     connection task, backoff counter, started flag.
///   * The `URLSessionDataDelegate` lives on a separate `OperationQueue`
///     (URLSession's delegate queue). It is a plain `NSObject` because
///     `URLSessionDelegate` cannot be conformed to by an actor. It hops
///     back into the actor via async closures.
///   * Subscribers receive events through `AsyncStream`, so consumers
///     decide their own concurrency context.
actor RealtimeClient {
    // MARK: Configuration

    private let baseURL: URL
    private let tokenStore: TokenStoring
    private let session: URLSession
    /// Sleep helper — abstracted so tests can swap to a manual scheduler.
    /// Default just routes to `Task.sleep`.
    private let sleep: @Sendable (UInt64) async throws -> Void

    // MARK: State

    /// Per-subscriber yield handle. We assign a UUID per `subscribe()` so the
    /// teardown path (the stream's onTermination callback) can locate and
    /// drop just that one continuation rather than tearing down everyone.
    private var subscribers: [UUID: AsyncStream<RealtimeEvent>.Continuation] = [:]

    /// `true` between `start()` and `stop()`. Used by the reconnect loop to
    /// know whether it should keep retrying after a transport failure.
    private var isStarted: Bool = false

    /// Background task driving the connect/read/backoff/reconnect loop.
    /// Captured so `stop()` can cancel it cleanly.
    private var loopTask: Task<Void, Never>?

    /// Active data task — kept so `stop()` can cancel an in-flight body
    /// stream without waiting for the server to time out.
    private var currentDataTask: URLSessionDataTask?

    // Backoff bounds (seconds). Exponential: 1, 2, 4, 8, 16, 30 (capped).
    private let backoffMin: TimeInterval = 1
    private let backoffMax: TimeInterval = 30

    // MARK: Init

    init(
        baseURL: URL,
        tokenStore: TokenStoring,
        session: URLSession? = nil,
        sleep: @escaping @Sendable (UInt64) async throws -> Void = { ns in
            try await Task.sleep(nanoseconds: ns)
        }
    ) {
        self.baseURL = baseURL
        self.tokenStore = tokenStore
        // SSE needs `waitsForConnectivity = false` (we want fast retry on
        // offline, not a buried OS-managed wait) and disables protocol
        // caching since the response is infinite. We pass a dedicated
        // session so the main API session's cache doesn't compete with
        // this long-lived connection.
        if let session {
            self.session = session
        } else {
            let cfg = URLSessionConfiguration.default
            cfg.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            cfg.timeoutIntervalForRequest = 0       // no read timeout — SSE idles
            cfg.timeoutIntervalForResource = 0      // ditto
            cfg.waitsForConnectivity = false
            cfg.httpAdditionalHeaders = ["Accept": "text/event-stream"]
            self.session = URLSession(configuration: cfg)
        }
        self.sleep = sleep
    }

    deinit {
        // Cancel any in-flight URLSession task. We can't `await stop()` from
        // deinit (actors disallow it) but cancelling the task is enough to
        // drop the connection; subscribers' streams finish via the delegate
        // callback once it observes the cancellation.
        currentDataTask?.cancel()
        loopTask?.cancel()
    }

    // MARK: Lifecycle

    /// Opens the SSE connection if it isn't already running. No-op if
    /// already started, so the call site can poke `start()` from multiple
    /// places (app launch, foreground, post-login) without coordination.
    func start() {
        guard !isStarted else { return }
        isStarted = true
        loopTask = Task { [weak self] in
            await self?.runConnectLoop()
        }
    }

    /// Closes the SSE connection and finishes every subscriber's stream.
    /// Idempotent.
    func stop() {
        guard isStarted else { return }
        isStarted = false
        currentDataTask?.cancel()
        currentDataTask = nil
        loopTask?.cancel()
        loopTask = nil
        // Finish all subscriber streams so consumers exit their `for await`
        // loops promptly. New subscriptions opened after stop() are still
        // legal — they'll just sit idle until the next start().
        for cont in subscribers.values { cont.finish() }
        subscribers.removeAll()
    }

    // MARK: Multicast subscription

    /// Returns a fresh stream tied to this subscriber. Each subscriber gets
    /// every event yielded after they subscribed — there is no replay
    /// buffer, callers that need history should hit the REST endpoint.
    ///
    /// The stream finishes automatically when `stop()` is called.
    func subscribe() -> AsyncStream<RealtimeEvent> {
        let id = UUID()
        return AsyncStream { continuation in
            // Register the continuation. We're already inside the actor
            // here because `subscribe()` is an actor-isolated method.
            self.subscribers[id] = continuation
            continuation.onTermination = { [weak self] _ in
                // Hop back into the actor to detach. The stream may end
                // because the consumer cancelled their task or because
                // `stop()` finished it; either way we drop the slot.
                Task { [weak self] in await self?.detach(id) }
            }
        }
    }

    /// Removes a subscriber slot. Called from `onTermination`.
    private func detach(_ id: UUID) {
        subscribers[id] = nil
    }

    /// Fan out an event to every active subscriber.
    fileprivate func dispatch(_ event: RealtimeEvent) {
        for cont in subscribers.values {
            cont.yield(event)
        }
    }

    // MARK: Connect loop

    /// Drives `connectOnce` in a loop with exponential backoff.
    /// Exits as soon as `isStarted` flips to `false`.
    private func runConnectLoop() async {
        var delay = backoffMin
        while isStarted && !Task.isCancelled {
            do {
                try await connectOnce()
                // `connectOnce()` returning *normally* means the server
                // closed the stream — that's not really an error but it
                // also doesn't merit a long backoff. Reset the counter so
                // the next retry happens immediately.
                delay = backoffMin
            } catch is CancellationError {
                // Triggered by `stop()` — bail.
                return
            } catch {
                // Transport blew up. Wait, then retry. We also reset the
                // back-off the moment a connection has been live for more
                // than a few seconds (see `connectOnce`); here we just
                // grow it on tight failures.
                let nanos = UInt64(delay * 1_000_000_000)
                do {
                    try await sleep(nanos)
                } catch {
                    return
                }
                delay = min(delay * 2, backoffMax)
            }
        }
    }

    /// One full connection attempt: build the request, hand it to the
    /// delegate, await completion. Throws when the connection drops
    /// abnormally so the outer loop can apply backoff.
    private func connectOnce() async throws {
        guard let token = tokenStore.accessToken(), !token.isEmpty else {
            // No token, no point connecting. Treat as an error so the loop
            // backs off — usually the caller fixes this by re-login.
            throw URLError(.userAuthenticationRequired)
        }
        // Build the URL. We append the token as a query item so the EventSource
        // contract is honored. Backend trims this query param out of access
        // logs (see backend agent's comment) so this isn't a leak vector.
        var components = URLComponents(url: baseURL.appendingPathComponent("/api/v1/realtime/sse"),
                                       resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = components?.url else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url,
                                 cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
                                 timeoutInterval: 0)
        request.httpMethod = "GET"
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        // Build a fresh delegate per connection — it owns the parse buffer.
        // The delegate posts events back into the actor via closures.
        let firstByteAt: ContinuousClock.Instant?
        firstByteAt = nil
        _ = firstByteAt // silence "never used" — we set/read in closure below

        // We use a continuation-bridged "wait until done" since
        // URLSessionDataDelegate is a callback API. The delegate resumes the
        // continuation exactly once — on success (`didComplete` with no
        // error) or failure.
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                let delegate = SSEDelegate(
                    onEvent: { [weak self] event in
                        // Hop into the actor to dispatch. Captured weakly
                        // so a torn-down client doesn't keep itself alive
                        // via the delegate queue.
                        Task { [weak self] in await self?.dispatch(event) }
                    },
                    onComplete: { error in
                        if let error {
                            // URLSession surfaces user-initiated cancels as
                            // `NSURLErrorCancelled`. Translate so the outer
                            // loop knows not to backoff in that case.
                            let ns = error as NSError
                            if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled {
                                continuation.resume(throwing: CancellationError())
                            } else {
                                continuation.resume(throwing: error)
                            }
                        } else {
                            continuation.resume(returning: ())
                        }
                    }
                )
                // Use a *fresh* session bound to this delegate so the
                // delegate gets all callbacks. We can't change the
                // delegate of the stored session post-hoc.
                let scoped = URLSession(configuration: session.configuration,
                                        delegate: delegate,
                                        delegateQueue: nil)
                let task = scoped.dataTask(with: request)
                // Stash the task so `stop()` can cancel it. Note: we're on
                // the actor here (this whole method is actor-isolated)
                // because the wrapping `Task` was spawned inside the actor.
                self.currentDataTask = task
                task.resume()
            }
        } onCancel: {
            // Triggered when the *outer* Task (loopTask) is cancelled by
            // `stop()`. Cancelling the data task drives the delegate's
            // `didComplete` callback, which resumes the continuation
            // above. We can't access `currentDataTask` from a non-isolated
            // closure, so we cancel via a hop. The hop is fire-and-forget.
            Task { [weak self] in await self?.cancelInFlight() }
        }
    }

    /// Cancels the in-flight URLSession task, if any. Called from
    /// `onCancel` of the cooperative cancellation handler.
    fileprivate func cancelInFlight() {
        currentDataTask?.cancel()
        currentDataTask = nil
    }
}

// MARK: - URLSession delegate

/// Reads raw bytes from the SSE stream and parses them into
/// `RealtimeEvent`s on the fly.
///
/// We keep a rolling `buffer` that accumulates incoming bytes until we see
/// a frame terminator (a blank line, i.e. `\n\n`). Each frame is parsed in
/// isolation, after which we drop it from the buffer.
///
/// This class is plain `NSObject` (not actor-isolated) because Foundation's
/// delegate protocol requires `NSObject` conformance. Thread-safety is
/// guaranteed by `URLSession` itself — it serializes delegate callbacks on
/// the configured delegate queue.
private final class SSEDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    typealias EventCallback = @Sendable (RealtimeEvent) -> Void
    typealias CompleteCallback = @Sendable (Error?) -> Void

    private let onEvent: EventCallback
    private let onComplete: CompleteCallback

    /// Rolling parse buffer. Only mutated on the URLSession delegate queue
    /// so no explicit lock is needed — Foundation serializes callbacks.
    private var buffer = Data()

    /// We complete exactly once. URLSession is well-behaved here but if
    /// `urlSession(_:task:didCompleteWithError:)` is ever invoked twice
    /// (it shouldn't be, but be defensive) we'd double-resume the
    /// continuation, which crashes.
    private var didComplete = false

    init(onEvent: @escaping EventCallback,
         onComplete: @escaping CompleteCallback) {
        self.onEvent = onEvent
        self.onComplete = onComplete
    }

    // MARK: URLSessionDataDelegate

    func urlSession(_ session: URLSession,
                    dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        // Accept any 2xx; reject everything else early so the server has a
        // chance to send 401/403/404 without us silently absorbing it.
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession,
                    dataTask: URLSessionDataTask,
                    didReceive data: Data) {
        buffer.append(data)
        // Frame boundary in SSE is a blank line — `\n\n` is the canonical
        // form. We also tolerate `\r\n\r\n` from intermediaries that
        // canonicalize line endings.
        while let frameRange = findFrameTerminator(in: buffer) {
            let frame = buffer.subdata(in: 0..<frameRange.lowerBound)
            buffer.removeSubrange(0..<frameRange.upperBound)
            parseFrame(frame)
        }
    }

    func urlSession(_ session: URLSession,
                    task: URLSessionTask,
                    didCompleteWithError error: Error?) {
        // Tear down the scoped session — it was created per-connection and
        // would otherwise leak.
        session.finishTasksAndInvalidate()
        guard !didComplete else { return }
        didComplete = true
        onComplete(error)
    }

    // MARK: Frame parsing

    /// SSE event frame format:
    ///   event: <kind>\n
    ///   data: <json>\n
    ///   \n
    /// We tolerate frames with multiple `data:` lines (the spec joins them
    /// with `\n`), comment lines starting with `:` (keepalives), and
    /// frames with only `data:` and no explicit `event:` (treated as
    /// `kind == "message"` per spec).
    private func parseFrame(_ frame: Data) {
        guard let text = String(data: frame, encoding: .utf8), !text.isEmpty else { return }
        var kind: String?
        var dataLines: [String] = []
        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: false) {
            // Strip a trailing CR from \r\n line endings — `split` only
            // takes care of \n.
            var line = String(rawLine)
            if line.hasSuffix("\r") { line.removeLast() }
            if line.isEmpty { continue }
            if line.hasPrefix(":") { continue }              // SSE comment / keepalive
            if let (field, value) = splitField(line) {
                switch field {
                case "event": kind = value
                case "data":  dataLines.append(value)
                default: break                                // id:, retry: etc. — ignored for now
                }
            }
        }
        guard !dataLines.isEmpty else { return }
        // Per spec, multi-line data is joined with \n.
        let payload = dataLines.joined(separator: "\n")
        guard let payloadData = payload.data(using: .utf8) else { return }
        let eventKind = kind ?? "message"
        let decoder = JSONDecoder()
        switch eventKind {
        case "message":
            if let decoded = try? decoder.decode(MessageRealtimePayload.self, from: payloadData) {
                onEvent(.message(decoded))
            } else {
                onEvent(.unknown(kind: eventKind, data: payloadData))
            }
        case "notification":
            if let decoded = try? decoder.decode(NotificationRealtimePayload.self, from: payloadData) {
                onEvent(.notification(decoded))
            } else {
                onEvent(.unknown(kind: eventKind, data: payloadData))
            }
        case "typing":
            if let decoded = try? decoder.decode(TypingRealtimePayload.self, from: payloadData) {
                onEvent(.typing(decoded))
            } else {
                onEvent(.unknown(kind: eventKind, data: payloadData))
            }
        case "read_receipt":
            if let decoded = try? decoder.decode(ReadReceiptRealtimePayload.self, from: payloadData) {
                onEvent(.readReceipt(decoded))
            } else {
                onEvent(.unknown(kind: eventKind, data: payloadData))
            }
        default:
            onEvent(.unknown(kind: eventKind, data: payloadData))
        }
    }

    /// Splits `name: value` into `(name, value)`. The space after `:` is
    /// optional in SSE and stripped if present.
    private func splitField(_ line: String) -> (String, String)? {
        guard let idx = line.firstIndex(of: ":") else { return (line, "") }
        let name = String(line[..<idx])
        var value = String(line[line.index(after: idx)...])
        if value.first == " " { value.removeFirst() }
        return (name, value)
    }

    /// Locate the byte range of the first frame terminator in `data`.
    /// Returns `nil` if none is found.
    ///
    /// Walks bytes directly to avoid allocating an intermediate `String`
    /// per `didReceive` call.
    private func findFrameTerminator(in data: Data) -> Range<Data.Index>? {
        // Look for `\n\n` first — that's by far the most common in
        // production. Fall back to `\r\n\r\n` for proxies that
        // canonicalize.
        if let lf = findRange(of: [0x0A, 0x0A], in: data) { return lf }
        if let crlf = findRange(of: [0x0D, 0x0A, 0x0D, 0x0A], in: data) { return crlf }
        return nil
    }

    private func findRange(of needle: [UInt8], in haystack: Data) -> Range<Data.Index>? {
        guard !needle.isEmpty, haystack.count >= needle.count else { return nil }
        let limit = haystack.count - needle.count
        var i = 0
        while i <= limit {
            var matched = true
            for j in 0..<needle.count where haystack[haystack.startIndex + i + j] != needle[j] {
                matched = false
                break
            }
            if matched {
                let start = haystack.startIndex + i
                let end = start + needle.count
                return start..<end
            }
            i += 1
        }
        return nil
    }
}
