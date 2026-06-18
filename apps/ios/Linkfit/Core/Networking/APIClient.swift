import Foundation

// MARK: - Error-handling convention (Wave-10 startup polish)
//
// The networking layer now distinguishes between *transient* and *terminal*
// failures so the UI can offer a one-tap retry instead of silently failing.
//
// • Mutations (POST/PATCH/PUT/DELETE) auto-retry **once** inside `send(...)`
//   on transient errors (offline, timeout, 502/503/504). Idempotency on the
//   server side is the caller's responsibility — most of our writes are
//   idempotent (upserts on like/unlike, follow/unfollow, etc.). One retry is
//   the sweet spot between resilience and accidental double-write.
//
// • GETs stay one-shot here. Important fetches (feed, profile, leaderboard)
//   should opt into `RequestRetry.run { ... }` from the ViewModel so the
//   retry ladder is a decision the screen owner makes, not a hidden cost on
//   every list paint.
//
// ViewModel convention (do NOT auto-sweep — adopt incrementally):
//
// ```
// do {
//     let data = try await RequestRetry.run { try await self.api.send(...) }
//     self.state = .loaded(data)
// } catch is CancellationError {
//     // navigated away — ignore
// } catch {
//     await ToastCenter.shared.errorWithRetry(
//         message: (error as? APIError)?.localizedMessage
//                  ?? String(localized: "error.generic")
//     ) { [weak self] in await self?.load() }
// }
// ```
//
// `ToastCenter.errorWithRetry(...)` renders a red-tinted pill with an inline
// "Yenidən cəhd et" button. The retry closure should call back into the VM's
// existing load path — not duplicate request setup.

protocol APIClient: Sendable {
    func send<R: Decodable>(_ endpoint: Endpoint<R>) async throws -> R

    /// Upload an in-memory image as `multipart/form-data` to
    /// `/api/v1/messages/upload-image`. Returns the server-issued absolute
    /// URL the client can stash on a Message.
    ///
    /// `imageData` must be a fully encoded JPEG/PNG payload — no transformation
    /// happens here. `mimeType` should mirror what the data actually contains;
    /// the server rejects anything outside the standard image set with 400.
    func uploadImage(imageData: Data, mimeType: String, filename: String) async throws -> UploadImageResponse
}

/// Single-flight refresh actor: many requests can race a 401 simultaneously
/// (e.g. screen mount fires 3 GETs); only ONE refresh round-trip should
/// happen — the rest await its result. Without this, a refresh-token family
/// can churn through several rotations in a single tick and trigger the
/// backend's reuse-detection defense for no reason.
actor RefreshCoordinator {
    private var inFlight: Task<Void, Error>?
    private let perform: () async throws -> Void

    init(perform: @escaping () async throws -> Void) {
        self.perform = perform
    }

    func refresh() async throws {
        if let task = inFlight {
            try await task.value
            return
        }
        let task = Task { try await perform() }
        inFlight = task
        defer { inFlight = nil }
        try await task.value
    }
}

final class URLSessionAPIClient: APIClient, @unchecked Sendable {
    typealias AuthLostHandler = @Sendable () -> Void

    private let baseURL: URL
    private let session: URLSession
    private let tokenStore: TokenStoring
    private let lock = NSLock()
    private var _authLostHandler: AuthLostHandler?
    private var authLostHandler: AuthLostHandler? {
        get {
            lock.lock()
            defer { lock.unlock() }
            return _authLostHandler
        }
        set {
            lock.lock()
            defer { lock.unlock() }
            _authLostHandler = newValue
        }
    }

    private func triggerAuthLost() {
        let handler = authLostHandler
        handler?()
    }
    private var coordinator: RefreshCoordinator!

    init(baseURL: URL, tokenStore: TokenStoring, session: URLSession? = nil) {
        self.baseURL = baseURL
        self.session = session ?? Self.makeDefaultSession()
        self.tokenStore = tokenStore
        self.coordinator = RefreshCoordinator(perform: { [weak self] in
            try await self?.performRefresh()
        })
    }

    func attachAuthDelegate(_ onAuthLost: @escaping AuthLostHandler) {
        self.authLostHandler = onAuthLost
    }

    func send<R: Decodable>(_ endpoint: Endpoint<R>) async throws -> R {
        // Mutations (POST/PATCH/PUT/DELETE) get one transient-error retry
        // built in: a 503 mid-deploy or a timed-out cellular hop is exactly
        // the kind of thing where blindly re-sending — once — gives a
        // dramatically better experience than failing the user back to the
        // screen with a generic error. Most of our writes are idempotent
        // (upserts), so a duplicate POST is safe.
        //
        // GETs stay one-shot here. Calling code that *wants* a retry ladder
        // for reads should wrap the call in `RequestRetry.run { ... }`.
        let shouldRetryTransient = endpoint.method != .get
        let initialToken = tokenStore.accessToken()

        do {
            return try await sendOnce(endpoint, retried: false)
        } catch APIError.unauthorized where endpoint.requiresAuth {
            // Guard: If the access token has already been changed in the store by another
            // concurrent request's successful refresh, we can retry immediately with the
            // new token without triggering a redundant refresh.
            let currentToken = tokenStore.accessToken()
            if currentToken != initialToken {
                return try await sendOnce(endpoint, retried: true)
            }

            do {
                try await coordinator.refresh()
            } catch {
                if case APIError.unauthorized = error {
                    triggerAuthLost()
                }
                throw error
            }
            return try await sendOnce(endpoint, retried: true)
        } catch let error where shouldRetryTransient && Self.isTransient(error) {
            // One short backoff before the second attempt. Anything more
            // is the caller's responsibility via `RequestRetry.run`.
            try? await Task.sleep(nanoseconds: 500_000_000)
            return try await sendOnce(endpoint, retried: false)
        }
    }

    func uploadImage(imageData: Data, mimeType: String, filename: String) async throws -> UploadImageResponse {
        try await uploadImage(imageData: imageData, mimeType: mimeType, filename: filename, path: "/api/v1/messages/upload-image")
    }

    func uploadImage(imageData: Data, mimeType: String, filename: String, path: String) async throws -> UploadImageResponse {
        let initialToken = tokenStore.accessToken()
        do {
            return try await uploadImageOnce(data: imageData, mimeType: mimeType, filename: filename, path: path, retried: false)
        } catch APIError.unauthorized {
            let currentToken = tokenStore.accessToken()
            if currentToken != initialToken {
                return try await uploadImageOnce(data: imageData, mimeType: mimeType, filename: filename, path: path, retried: true)
            }
            do {
                try await coordinator.refresh()
            } catch {
                if case APIError.unauthorized = error {
                    triggerAuthLost()
                }
                throw error
            }
            return try await uploadImageOnce(data: imageData, mimeType: mimeType, filename: filename, path: path, retried: true)
        }
    }

    func downloadData(path: String, query: [URLQueryItem] = [], requiresAuth: Bool = true) async throws -> Data {
        let endpoint = Endpoint<EmptyResponse>(method: .get, path: path, query: query, requiresAuth: requiresAuth)
        let request = try buildRequest(endpoint)
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.unknown(message: "Non-HTTP response")
            }
            guard (200..<300).contains(http.statusCode) else {
                let localDecoder = makeDecoder()
                if let envelope = try? localDecoder.decode(APIErrorEnvelope.self, from: data) {
                    throw APIError.from(envelope: envelope, status: http.statusCode)
                }
                throw APIError.server(status: http.statusCode, code: nil, message: "Download failed")
            }
            return data
        } catch let error as APIError {
            throw error
        } catch {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
                throw CancellationError()
            }
            throw Self.mapTransportError(error)
        }
    }

    private func uploadImageOnce(data: Data, mimeType: String, filename: String, path: String, retried: Bool) async throws -> UploadImageResponse {
        // RFC 2046 boundary. Use UUID for collision-freeness across concurrent uploads.
        let boundary = "----linkfit-\(UUID().uuidString)"
        var body = Data()
        // Sanitize filename — only ASCII letters/digits/.- survive; everything
        // else collapses to "_". Prevents header injection via filename.
        let safeName = filename.unicodeScalars.map { scalar -> String in
            let isAllowed = CharacterSet.alphanumerics.contains(scalar) ||
                scalar == "." || scalar == "-" || scalar == "_"
            return isAllowed ? String(scalar) : "_"
        }.joined()
        let header =
            "--\(boundary)\r\n" +
            "Content-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n" +
            "Content-Type: \(mimeType)\r\n\r\n"
        body.append(Data(header.utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        var request = URLRequest(url: baseURL.appendingPathComponent(path),
                                 cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: 60)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = tokenStore.accessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let responseData: Data
        let response: URLResponse
        do {
            (responseData, response) = try await session.data(for: request)
        } catch {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
                throw CancellationError()
            }
            throw Self.mapTransportError(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.unknown(message: "Non-HTTP response")
        }
        if (200..<300).contains(http.statusCode) {
            do {
                let localDecoder = makeDecoder()
                return try localDecoder.decode(UploadImageResponse.self, from: responseData)
            } catch {
                throw APIError.decoding(underlying: String(describing: error))
            }
        }
        let localDecoder = makeDecoder()
        if let envelope = try? localDecoder.decode(APIErrorEnvelope.self, from: responseData) {
            let mapped = APIError.from(envelope: envelope, status: http.statusCode)
            if case .unauthorized = mapped, retried {
                triggerAuthLost()
            }
            throw mapped
        }
        throw APIError.server(status: http.statusCode, code: nil, message: "Upload failed")
    }

    /// Upload variant that reports per-byte progress via `onProgress`.
    /// Mirrors `uploadImage(...)`'s 401-refresh-retry flow but routes
    /// through a one-shot session with a `URLSessionTaskDelegate`
    /// attached. Called only via the `APIClient` extension above.
    func uploadImageReportingProgress(
        imageData: Data,
        mimeType: String,
        filename: String,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> UploadImageResponse {
        let initialToken = tokenStore.accessToken()
        do {
            return try await uploadImageProgressOnce(
                data: imageData,
                mimeType: mimeType,
                filename: filename,
                onProgress: onProgress,
                retried: false
            )
        } catch APIError.unauthorized {
            let currentToken = tokenStore.accessToken()
            if currentToken != initialToken {
                return try await uploadImageProgressOnce(
                    data: imageData,
                    mimeType: mimeType,
                    filename: filename,
                    onProgress: onProgress,
                    retried: true
                )
            }
            do {
                try await coordinator.refresh()
            } catch {
                if case APIError.unauthorized = error {
                    triggerAuthLost()
                }
                throw error
            }
            return try await uploadImageProgressOnce(
                data: imageData,
                mimeType: mimeType,
                filename: filename,
                onProgress: onProgress,
                retried: true
            )
        }
    }

    private func uploadImageProgressOnce(
        data: Data,
        mimeType: String,
        filename: String,
        onProgress: @escaping @Sendable (Double) -> Void,
        retried: Bool
    ) async throws -> UploadImageResponse {
        // Mirror of `uploadImageOnce`'s multipart construction. Keep the
        // two in sync if either changes.
        let boundary = "----linkfit-\(UUID().uuidString)"
        var body = Data()
        let safeName = filename.unicodeScalars.map { scalar -> String in
            let isAllowed = CharacterSet.alphanumerics.contains(scalar) ||
                scalar == "." || scalar == "-" || scalar == "_"
            return isAllowed ? String(scalar) : "_"
        }.joined()
        let header =
            "--\(boundary)\r\n" +
            "Content-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n" +
            "Content-Type: \(mimeType)\r\n\r\n"
        body.append(Data(header.utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        var request = URLRequest(url: baseURL.appendingPathComponent("/api/v1/messages/upload-image"),
                                 cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: 60)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = tokenStore.accessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        // Dedicated ephemeral session for the delegate. Tear it down
        // after use so we don't pollute the shared cache or hold
        // background sockets open.
        let progressDelegate = UploadProgressDelegate(onProgress: onProgress)
        let uploadSession = URLSession(
            configuration: .ephemeral,
            delegate: progressDelegate,
            delegateQueue: nil
        )
        defer { uploadSession.finishTasksAndInvalidate() }

        let responseData: Data
        let response: URLResponse
        do {
            (responseData, response) = try await uploadSession.upload(for: request, from: body)
        } catch {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
                throw CancellationError()
            }
            throw Self.mapTransportError(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.unknown(message: "Non-HTTP response")
        }
        if (200..<300).contains(http.statusCode) {
            // Belt-and-braces: deliver a final 1.0 so the UI lands on a
            // full circle even if the delegate stopped a byte short.
            onProgress(1.0)
            do {
                let localDecoder = makeDecoder()
                return try localDecoder.decode(UploadImageResponse.self, from: responseData)
            } catch {
                throw APIError.decoding(underlying: String(describing: error))
            }
        }
        let localDecoder = makeDecoder()
        if let envelope = try? localDecoder.decode(APIErrorEnvelope.self, from: responseData) {
            let mapped = APIError.from(envelope: envelope, status: http.statusCode)
            if case .unauthorized = mapped, retried {
                triggerAuthLost()
            }
            throw mapped
        }
        throw APIError.server(status: http.statusCode, code: nil, message: "Upload failed")
    }

    // MARK: - Private

    private func sendOnce<R: Decodable>(_ endpoint: Endpoint<R>, retried: Bool) async throws -> R {
        let request = try buildRequest(endpoint)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
                throw CancellationError()
            }
            throw Self.mapTransportError(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.unknown(message: "Non-HTTP response")
        }

        if (200..<300).contains(http.statusCode) {
            if R.self == EmptyResponse.self, let empty = EmptyResponse() as? R {
                return empty
            }
            do {
                let localDecoder = makeDecoder()
                return try localDecoder.decode(R.self, from: data)
            } catch {
                throw APIError.decoding(underlying: String(describing: error))
            }
        }

        let localDecoder = makeDecoder()
        if let envelope = try? localDecoder.decode(APIErrorEnvelope.self, from: data) {
            let mapped = APIError.from(envelope: envelope, status: http.statusCode)
            if case .unauthorized = mapped, retried {
                triggerAuthLost()
            }
            throw mapped
        }
        let bodyText = String(data: data, encoding: .utf8) ?? ""
        throw APIError.server(status: http.statusCode, code: nil,
                              message: bodyText.isEmpty ? "Server error" : bodyText)
    }

    private func makeDecoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }

    private func performRefresh() async throws {
        guard let refresh = tokenStore.refreshToken() else {
            throw APIError.unauthorized
        }
        let session = try await sendOnce(Endpoint<AuthSession>.refresh(refreshToken: refresh), retried: true)
        try tokenStore.save(access: session.access_token, refresh: session.refresh_token)
    }

    private func buildRequest<R>(_ endpoint: Endpoint<R>) throws -> URLRequest {
        var components = URLComponents(url: baseURL.appendingPathComponent(endpoint.path),
                                       resolvingAgainstBaseURL: false)
        if !endpoint.query.isEmpty {
            components?.queryItems = endpoint.query
        }
        guard let url = components?.url else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url,
                                 cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: 20)
        request.httpMethod = endpoint.method.rawValue
        request.httpBody = endpoint.body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if endpoint.body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if endpoint.requiresAuth, let token = tokenStore.accessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    /// Default session configured with a sized `URLCache` (16 MB RAM / 64 MB
    /// disk). This applies to API responses that opt in via cache-control;
    /// raw image fetching has its own two-tier cache in `ImageCache`.
    private static func makeDefaultSession() -> URLSession {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 16 * 1024 * 1024,
                                   diskCapacity: 64 * 1024 * 1024,
                                   diskPath: "az.linkfit.app.urlcache")
        config.requestCachePolicy = .useProtocolCachePolicy
        return URLSession(configuration: config)
    }

    /// Whether `error` represents a hiccup that's worth one immediate
    /// re-send: device offline, request timed out, or the LB/edge sent
    /// 502 / 503 / 504. Anything else (4xx, decoding, unexpected 5xx) is
    /// terminal — retrying it would just delay the user's feedback.
    ///
    /// Kept as a static so the same classification is available to
    /// `RequestRetry.isTransient`; both share the same policy so a
    /// VM-side retry ladder and the client's inline retry agree on what
    /// counts as flakiness vs. a real failure.
    static func isTransient(_ error: Error) -> Bool {
        if let api = error as? APIError {
            switch api {
            case .offline, .timeout:
                return true
            case .server(let status, _, _):
                return status == 502 || status == 503 || status == 504
            default:
                return false
            }
        }
        return false
    }

    private static func mapTransportError(_ error: Error) -> APIError {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorNotConnectedToInternet,
                 NSURLErrorNetworkConnectionLost,
                 NSURLErrorDataNotAllowed,
                 NSURLErrorInternationalRoamingOff:
                return .offline
            case NSURLErrorTimedOut:
                return .timeout
            case NSURLErrorCannotConnectToHost,
                 NSURLErrorCannotFindHost,
                 NSURLErrorDNSLookupFailed,
                 NSURLErrorResourceUnavailable,
                 NSURLErrorBadServerResponse,
                 NSURLErrorSecureConnectionFailed:
                return .server(status: 0, code: "UNREACHABLE",
                               message: String(localized: "api.error.unreachable"))
            default:
                break
            }
        }
        return .unknown(message: error.localizedDescription)
    }
}

// MARK: - Upload-progress variant
//
// Layered on top of the existing `uploadImage(...)` method as an opt-in
// extension so callers that want to render a progress UI can subscribe
// to per-byte sent events. The original `uploadImage(...)` is untouched —
// callers that don't care about progress keep working as before.
//
// Per-byte progress is driven by a `URLSessionTaskDelegate` attached
// to a one-shot ephemeral session. Real progress is only available for
// the real `URLSessionAPIClient`; stub clients (`HomeNullClient`,
// `VersionGatePlaceholderClient`) fall back to the non-progress
// `uploadImage(...)` and synthesize boundary events so the caller's
// progress UI still completes.
extension APIClient {
    func downloadMyBookingsExport(
        status: String? = nil,
        timeframe: String? = nil,
        from: String? = nil,
        to: String? = nil,
        venueId: String? = nil,
        sport: String? = nil
    ) async throws -> Data {
        guard let real = self as? URLSessionAPIClient else {
            throw APIError.offline
        }
        var query: [URLQueryItem] = []
        if let status { query.append(.init(name: "status", value: status)) }
        if let timeframe { query.append(.init(name: "timeframe", value: timeframe)) }
        if let from { query.append(.init(name: "from", value: from)) }
        if let to { query.append(.init(name: "to", value: to)) }
        if let venueId { query.append(.init(name: "venue_id", value: venueId)) }
        if let sport { query.append(.init(name: "sport", value: sport)) }
        return try await real.downloadData(path: "/api/v1/bookings/me/export", query: query, requiresAuth: true)
    }

    /// Generic media upload endpoint for user-owned media assets.
    func uploadMediaImage(
        imageData: Data,
        mimeType: String,
        filename: String
    ) async throws -> UploadImageResponse {
        if let real = self as? URLSessionAPIClient {
            return try await real.uploadImage(
                imageData: imageData,
                mimeType: mimeType,
                filename: filename,
                path: "/api/v1/media"
            )
        }
        return try await uploadImage(imageData: imageData, mimeType: mimeType, filename: filename)
    }

    /// Upload story media to the stories-specific media endpoint. Non-real
    /// clients fall back to the generic image upload so previews/tests do not
    /// need to implement another protocol method.
    func uploadStoryImage(
        imageData: Data,
        mimeType: String,
        filename: String,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> UploadImageResponse {
        if let real = self as? URLSessionAPIClient {
            onProgress(0.0)
            let result = try await real.uploadImage(
                imageData: imageData,
                mimeType: mimeType,
                filename: filename,
                path: "/api/v1/stories/upload-image"
            )
            onProgress(1.0)
            return result
        }
        onProgress(0.0)
        let result = try await uploadImage(imageData: imageData, mimeType: mimeType, filename: filename)
        onProgress(1.0)
        return result
    }

    /// Upload an image with per-byte progress reporting.
    ///
    /// `onProgress` is fed values in `0.0...1.0` from URLSession's
    /// delegate queue — the caller MUST hop to the main actor before
    /// touching SwiftUI state. Several updates per second is typical
    /// on a normal link.
    func uploadImage(
        imageData: Data,
        mimeType: String,
        filename: String,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> UploadImageResponse {
        if let real = self as? URLSessionAPIClient {
            return try await real.uploadImageReportingProgress(
                imageData: imageData,
                mimeType: mimeType,
                filename: filename,
                onProgress: onProgress
            )
        }
        // Stub clients — emit a 0.0/1.0 boundary so progress UIs still
        // settle to "done" instead of dangling.
        onProgress(0.0)
        let result = try await uploadImage(
            imageData: imageData,
            mimeType: mimeType,
            filename: filename
        )
        onProgress(1.0)
        return result
    }
}

/// Per-task delegate that forwards URLSession's byte-counter callbacks
/// into a Swift closure. NSObject + `URLSessionTaskDelegate` is the only
/// way Foundation exposes upload progress; the async/await transcript
/// alone doesn't fire intermediate events.
final class UploadProgressDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let onProgress: @Sendable (Double) -> Void

    init(onProgress: @escaping @Sendable (Double) -> Void) {
        self.onProgress = onProgress
        super.init()
    }

    func urlSession(_ session: URLSession,
                    task: URLSessionTask,
                    didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64,
                    totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        let raw = Double(totalBytesSent) / Double(totalBytesExpectedToSend)
        let clamped = min(max(raw, 0.0), 1.0)
        onProgress(clamped)
    }
}
