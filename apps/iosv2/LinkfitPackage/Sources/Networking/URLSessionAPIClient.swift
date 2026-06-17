import Foundation
import Models
import AppCore

/// Production `APIClient`. Owns the `URLSession` (optionally cert-pinned), attaches
/// bearer tokens, performs proactive + reactive token refresh, and maps the
/// backend error envelope to `APIError`.
public final class URLSessionAPIClient: APIClient {
    private let baseURL: URL
    private let tokenStore: any TokenStoring
    private let session: URLSession
    private let refresher: TokenRefresher
    private let onUnauthorized: @Sendable () -> Void

    /// - Parameter onUnauthorized: invoked once when refresh definitively fails,
    ///   so the app can clear the session and route to login.
    public init(
        baseURL: URL,
        tokenStore: any TokenStoring,
        certPins: [String] = [],
        configuration: URLSessionConfiguration? = nil,
        onUnauthorized: @escaping @Sendable () -> Void = {}
    ) {
        self.baseURL = baseURL
        self.tokenStore = tokenStore
        self.onUnauthorized = onUnauthorized

        let resolved = configuration ?? {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 30
            config.waitsForConnectivity = true
            config.httpAdditionalHeaders = ["Accept": "application/json"]
            return config
        }()

        let delegate: URLSessionDelegate? = certPins.isEmpty ? nil : PinningDelegate(pins: certPins)
        self.session = URLSession(configuration: resolved, delegate: delegate, delegateQueue: nil)

        let capturedBase = baseURL
        let capturedSession = self.session
        self.refresher = TokenRefresher(tokenStore: tokenStore) { refreshToken in
            try await URLSessionAPIClient.rawRefresh(
                baseURL: capturedBase,
                session: capturedSession,
                refreshToken: refreshToken
            )
        }
    }

    // MARK: APIClient

    public func send<T: Decodable & Sendable>(_ endpoint: Endpoint, as type: T.Type) async throws -> T {
        let data = try await rawData(for: endpoint, allowRefresh: true)
        if data.isEmpty, let empty = EmptyResponse() as? T { return empty }
        do {
            return try JSON.decoder.decode(T.self, from: data)
        } catch {
            AppLog.error("Decoding \(T.self) failed: \(error)", category: "net")
            throw APIError.decoding(String(describing: error))
        }
    }

    public func send(_ endpoint: Endpoint) async throws {
        _ = try await rawData(for: endpoint, allowRefresh: true)
    }

    public func upload(image data: Data, to path: String) async throws -> URL {
        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let token = await tokenStore.currentAccessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        var body = Data()
        body.appendString("--\(boundary)\r\n")
        body.appendString("Content-Disposition: form-data; name=\"image\"; filename=\"upload.jpg\"\r\n")
        body.appendString("Content-Type: image/jpeg\r\n\r\n")
        body.append(data)
        body.appendString("\r\n--\(boundary)--\r\n")
        request.httpBody = body

        let (respData, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw serverError(from: respData, status: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        guard
            let object = try? JSONSerialization.jsonObject(with: respData) as? [String: Any]
        else {
            throw APIError.decoding("upload: response was not a JSON object")
        }
        for key in ["url", "media_url", "photo_url", "image_url"] {
            if let value = object[key] as? String, let url = URL(string: value) { return url }
        }
        throw APIError.decoding("upload: no media url in response")
    }

    // MARK: Core request pipeline

    private func rawData(for endpoint: Endpoint, allowRefresh: Bool) async throws -> Data {
        // Proactive refresh: avoid a guaranteed 401 round-trip when we know the
        // access token is about to expire.
        if endpoint.requiresAuth, allowRefresh,
           let current = await tokenStore.tokens(), current.isExpiring() {
            _ = try? await refresher.refresh()
        }

        let request = try await makeRequest(for: endpoint)
        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else { throw APIError.unknown }

        switch http.statusCode {
        case 200..<300:
            return data
        case 401 where endpoint.requiresAuth && allowRefresh:
            do {
                _ = try await refresher.refresh()
            } catch {
                onUnauthorized()
                throw APIError.unauthorized
            }
            return try await rawData(for: endpoint, allowRefresh: false)
        case 401:
            onUnauthorized()
            throw APIError.unauthorized
        case 422:
            throw validationError(from: data)
        default:
            throw serverError(from: data, status: http.statusCode)
        }
    }

    private func perform(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch let urlError as URLError {
            throw APIError.map(urlError)
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
    }

    private func makeRequest(for endpoint: Endpoint) async throws -> URLRequest {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(endpoint.path),
            resolvingAgainstBaseURL: false
        )
        if !endpoint.query.isEmpty {
            components?.queryItems = endpoint.query
                .sorted { $0.key < $1.key }
                .map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components?.url else { throw APIError.unknown }

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = endpoint.body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSON.encoder.encode(body)
        }
        if endpoint.requiresAuth, let token = await tokenStore.currentAccessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    // MARK: Error mapping

    private func validationError(from data: Data) -> APIError {
        if let envelope = try? JSON.decoder.decode(APIErrorEnvelope.self, from: data) {
            return .validation(envelope.error.fields ?? [:])
        }
        return .validation([:])
    }

    private func serverError(from data: Data, status: Int) -> APIError {
        if let envelope = try? JSON.decoder.decode(APIErrorEnvelope.self, from: data) {
            return .server(
                code: envelope.error.code,
                message: envelope.error.message,
                requestID: envelope.error.requestId
            )
        }
        return .server(code: "http_\(status)", message: "Request failed (\(status)).", requestID: nil)
    }

    // MARK: Refresh (raw — bypasses interception to avoid recursion)

    static func rawRefresh(
        baseURL: URL,
        session: URLSession,
        refreshToken: String
    ) async throws -> AuthSessionDTO {
        var request = URLRequest(url: baseURL.appendingPathComponent("/api/v1/auth/refresh"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSON.encoder.encode(RefreshRequest(refreshToken: refreshToken))

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch let urlError as URLError {
            throw APIError.map(urlError)
        }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.unauthorized
        }
        return try JSON.decoder.decode(AuthSessionDTO.self, from: data)
    }
}

private extension Data {
    mutating func appendString(_ string: String) {
        if let data = string.data(using: .utf8) { append(data) }
    }
}
