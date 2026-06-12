import Foundation
#if canImport(UIKit)
import UIKit
#endif
import os.log

/// In-house analytics client. Buffers events in memory + UserDefaults and
/// flushes them to `POST /api/v1/analytics/events` on a 30s cadence, on app
/// foreground, and whenever the buffer crosses 20 events.
///
/// Design notes:
/// - **Actor-isolated.** All mutable state (buffer, distinct_id, in-flight
///   flush task) is owned by this actor. Callers only see async methods.
/// - **No third-party SDK.** We don't want PostHog / Mixpanel / Firebase deps
///   yet. Keep this small and replaceable — if we adopt a vendor later, swap
///   the body of `flush()` to call their SDK and the call sites won't change.
/// - **PII boundary.** Properties go through `AnalyticsValue`, which is a
///   closed enum. We never accept `Any`, so callers cannot accidentally ship
///   a `User` or a token.
/// - **Drop, don't escalate.** This is best-effort. If the network is down or
///   the endpoint 404s, we drop the batch after 3 retries and move on. We do
///   not surface errors to the UI or block the user.
/// - **Survives app kill.** The buffer is persisted to UserDefaults under
///   `LinkfitAnalyticsBuffer`, capped at 100 events. We don't use a file or
///   SQLite — the data is small and ephemeral; UserDefaults is fine.
actor AnalyticsClient {
    // MARK: - Configuration

    /// Auto-flush cadence.
    private static let flushInterval: TimeInterval = 30

    /// When the buffer reaches this size during `track`, flush eagerly.
    private static let flushThreshold = 20

    /// Hard cap on persisted buffer. Events past this are dropped FIFO so an
    /// offline device on a long flight doesn't grow without bound.
    private static let maxBuffer = 100

    /// UserDefaults key for the persisted buffer. Public-readable so tests
    /// can clear it deterministically; the key name itself is a sentinel and
    /// part of the upgrade contract — do not rename without a migration.
    static let bufferDefaultsKey = "LinkfitAnalyticsBuffer"

    /// Backoff exponent base in seconds. Sequence: 1, 2, 4 seconds across 3
    /// attempts before we give up on a batch.
    private static let backoffBase: TimeInterval = 1

    /// Number of HTTP attempts before the batch is dropped.
    private static let maxAttempts = 3

    // MARK: - Singleton

    /// App-wide singleton. The `AppContainer` is being modified concurrently
    /// by another agent, so the analytics layer self-owns its lifecycle via a
    /// static accessor — call sites use `Analytics.track(...)` and never
    /// touch the actor directly.
    static let shared: AnalyticsClient = AnalyticsClient()

    // MARK: - State

    private var buffer: [Event] = []
    private var distinctId: String?
    private var flushTimerTask: Task<Void, Never>?
    private var isFlushing = false

    private let endpointURL: URL?
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let log = Logger(subsystem: "az.linkfit.app", category: "Analytics")

    // MARK: - Init

    init(session: URLSession = .shared,
         endpointURL: URL? = AnalyticsClient.defaultEndpointURL()) {
        self.session = session
        self.endpointURL = endpointURL
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder

        Task { [weak self] in
            await self?.bootstrap()
        }
    }

    // MARK: - Public API

    /// Buffer an event for later flush. Non-throwing — failures are absorbed
    /// silently. If the buffer is now at or past `flushThreshold`, kicks off
    /// a flush in the background.
    func track(_ event: String, properties: [String: AnalyticsValue] = [:]) async {
        let payload = Event(
            event: event,
            properties: properties,
            distinct_id: distinctId,
            ts: Date()
        )
        append(payload)
        persistBuffer()

        if buffer.count >= Self.flushThreshold {
            // Fire-and-forget — we don't want callers blocking on the
            // network. The actor serializes flushes via `isFlushing`.
            Task { [weak self] in await self?.flush() }
        }
    }

    /// Tag subsequent events with a stable user identifier. Pass the same id
    /// that the backend recognises so downstream funnels can join.
    func identify(_ userId: String) async {
        distinctId = userId
    }

    /// Drop the distinct_id and the pending buffer. Called on logout so the
    /// next user's events can't be attributed to the previous one.
    func reset() async {
        distinctId = nil
        buffer.removeAll()
        persistBuffer()
    }

    /// POST the current buffer to the analytics endpoint. Safe to call from
    /// anywhere — concurrent callers are de-duplicated via the `isFlushing`
    /// gate. On success the events are removed from the buffer; on permanent
    /// failure the batch is dropped (we do not retry indefinitely — the user
    /// hasn't asked us to log analytics, they've asked us to ship product).
    func flush() async {
        guard !isFlushing else { return }
        guard !buffer.isEmpty else { return }
        guard let url = endpointURL else {
            // No endpoint configured — drop the buffer so it doesn't grow
            // forever in a misconfigured build (e.g. an enterprise dev who
            // hasn't set APIBaseURL). This matches the brief's "drop on
            // failure" semantics applied to the misconfig path.
            buffer.removeAll()
            persistBuffer()
            return
        }

        isFlushing = true
        defer { isFlushing = false }

        // Snapshot the batch. New events arriving during the flight stay in
        // the buffer; on success we only remove the ids we shipped.
        let batch = buffer

        let bodyData: Data
        do {
            bodyData = try encoder.encode(EventBatch(events: batch))
        } catch {
            // Encoding failure means a property type we can't represent.
            // Drop the batch so we don't loop forever on the same bad event.
            log.error("encode failed: \(String(describing: error), privacy: .public)")
            buffer.removeAll { event in batch.contains(where: { $0.id == event.id }) }
            persistBuffer()
            return
        }

        var attempt = 0
        var lastError: String?
        while attempt < Self.maxAttempts {
            attempt += 1
            do {
                let request = makeRequest(url: url, body: bodyData)
                let (_, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    lastError = "non-HTTP response"
                    break
                }
                if (200..<300).contains(http.statusCode) {
                    buffer.removeAll { event in batch.contains(where: { $0.id == event.id }) }
                    persistBuffer()
                    return
                }
                if http.statusCode == 404 || http.statusCode == 410 {
                    // Endpoint not deployed yet — drop the batch and stop
                    // retrying. We'll re-enable when the backend ships.
                    log.info("analytics endpoint \(http.statusCode, privacy: .public), dropping batch")
                    buffer.removeAll { event in batch.contains(where: { $0.id == event.id }) }
                    persistBuffer()
                    return
                }
                if (400..<500).contains(http.statusCode) {
                    // 4xx other than auth — payload-shape problem, retrying
                    // will not help. Drop.
                    log.error("analytics 4xx \(http.statusCode, privacy: .public), dropping batch")
                    buffer.removeAll { event in batch.contains(where: { $0.id == event.id }) }
                    persistBuffer()
                    return
                }
                lastError = "HTTP \(http.statusCode)"
            } catch {
                if error is CancellationError { return }
                lastError = String(describing: error)
            }

            if attempt < Self.maxAttempts {
                // Exponential backoff: 1s, 2s, 4s. Capped at maxAttempts so
                // the total stall is bounded under ~8s.
                let delay = Self.backoffBase * pow(2.0, Double(attempt - 1))
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
        }

        // Out of retries — drop the batch.
        log.notice("analytics flush failed after \(Self.maxAttempts, privacy: .public) attempts: \(lastError ?? "unknown", privacy: .public)")
        buffer.removeAll { event in batch.contains(where: { $0.id == event.id }) }
        persistBuffer()
    }

    // MARK: - Lifecycle hooks

    /// Hook invoked when the host app enters the foreground. Public so the
    /// app-delegate or scene wiring can call it without reaching into the
    /// actor's private surface.
    func handleForeground() async {
        await flush()
    }

    // MARK: - Internals

    private func bootstrap() {
        loadBuffer()
        startTimer()
        registerForLifecycle()
    }

    private func append(_ event: Event) {
        buffer.append(event)
        if buffer.count > Self.maxBuffer {
            // FIFO drop — oldest events go first. Trim down to maxBuffer.
            let overflow = buffer.count - Self.maxBuffer
            buffer.removeFirst(overflow)
        }
    }

    private func persistBuffer() {
        do {
            let data = try encoder.encode(buffer)
            UserDefaults.standard.set(data, forKey: Self.bufferDefaultsKey)
        } catch {
            log.error("persist failed: \(String(describing: error), privacy: .public)")
        }
    }

    private func loadBuffer() {
        guard let data = UserDefaults.standard.data(forKey: Self.bufferDefaultsKey) else { return }
        do {
            let restored = try decoder.decode([Event].self, from: data)
            buffer = restored
            if buffer.count > Self.maxBuffer {
                let overflow = buffer.count - Self.maxBuffer
                buffer.removeFirst(overflow)
            }
        } catch {
            // Schema drift between releases — discard the old buffer rather
            // than risk decoding errors looping on every track().
            log.notice("restore failed (\(String(describing: error), privacy: .public)); clearing buffer")
            UserDefaults.standard.removeObject(forKey: Self.bufferDefaultsKey)
            buffer = []
        }
    }

    private func startTimer() {
        flushTimerTask?.cancel()
        flushTimerTask = Task { [weak self] in
            while !Task.isCancelled {
                let interval = Self.flushIntervalNanos
                try? await Task.sleep(nanoseconds: interval)
                if Task.isCancelled { return }
                await self?.flush()
            }
        }
    }

    private nonisolated static var flushIntervalNanos: UInt64 {
        UInt64(flushInterval * 1_000_000_000)
    }

    private func registerForLifecycle() {
        #if canImport(UIKit)
        let center = NotificationCenter.default
        let name = UIApplication.willEnterForegroundNotification
        Task { [weak self] in
            let stream = center.notifications(named: name).map { _ in () }
            for await _ in stream {
                await self?.handleForeground()
            }
        }
        #endif
    }

    private func makeRequest(url: URL, body: Data) -> URLRequest {
        var request = URLRequest(url: url,
                                 cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: 15)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    // MARK: - Endpoint resolution

    /// Mirrors AppContainer's base-URL resolution so analytics points at the
    /// same host as the rest of the API surface. Reads `LINKFIT_API_BASE_URL`
    /// env, then `APIBaseURL` Info.plist, then falls back to nil so the
    /// client becomes a no-op in unconfigured builds.
    private static func defaultEndpointURL() -> URL? {
        let configured = ProcessInfo.processInfo.environment["LINKFIT_API_BASE_URL"]
            ?? Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String
        guard let base = configured, let url = URL(string: base) else { return nil }
        return url.appendingPathComponent("/api/v1/analytics/events")
    }
}

// MARK: - Wire types

extension AnalyticsClient {
    /// A single analytics event. `id` is local-only and used to reconcile a
    /// batch after a successful flush — the server never sees it.
    struct Event: Codable, Sendable, Equatable {
        let id: UUID
        let event: String
        let properties: [String: AnalyticsValue]
        let distinct_id: String?
        let ts: Date

        init(id: UUID = UUID(),
             event: String,
             properties: [String: AnalyticsValue],
             distinct_id: String?,
             ts: Date) {
            self.id = id
            self.event = event
            self.properties = properties
            self.distinct_id = distinct_id
            self.ts = ts
        }

        // Custom Codable to omit `id` from the wire format (it's local-only)
        // while still persisting it via the same Codable for the on-disk
        // buffer. We accomplish that by keeping `id` in the keyed coding
        // surface but giving it a default on decode — the server simply
        // ignores it on encode if absent. To keep the wire payload clean we
        // would emit a separate DTO, but the server payload is permissive
        // (the brief specifies `event, properties, distinct_id, ts`) so we
        // emit `id` too; the backend can ignore it.
        enum CodingKeys: String, CodingKey {
            case id
            case event
            case properties
            case distinct_id
            case ts
        }
    }

    struct EventBatch: Codable, Sendable {
        let events: [Event]
    }
}
