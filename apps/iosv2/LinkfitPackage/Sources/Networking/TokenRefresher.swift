import Foundation
import Models

struct RefreshRequest: Encodable, Sendable {
    let refreshToken: String
}

/// Coordinates access-token refresh with **single-flight** semantics: if ten
/// requests get a 401 at once, only one `POST /auth/refresh` goes out and the
/// rest await its result. Being an `actor` is what makes that race-free.
actor TokenRefresher {
    private let tokenStore: any TokenStoring
    private let performRefresh: @Sendable (_ refreshToken: String) async throws -> AuthSessionDTO
    private var inFlight: Task<AuthTokens, Error>?

    init(
        tokenStore: any TokenStoring,
        performRefresh: @escaping @Sendable (_ refreshToken: String) async throws -> AuthSessionDTO
    ) {
        self.tokenStore = tokenStore
        self.performRefresh = performRefresh
    }

    func refresh() async throws -> AuthTokens {
        if let existing = inFlight {
            return try await existing.value
        }
        let task = Task { [tokenStore, performRefresh] () throws -> AuthTokens in
            guard let current = await tokenStore.tokens() else { throw APIError.unauthorized }
            let dto = try await performRefresh(current.refreshToken)
            let fresh = dto.tokens()
            await tokenStore.save(fresh)
            return fresh
        }
        inFlight = task
        defer { inFlight = nil }
        return try await task.value
    }
}
