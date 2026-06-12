import Foundation

// MARK: - Session models
//
// "Logged-in devices" / Active sessions endpoints.
// Backed by /api/v1/me/sessions and friends; revocation maps to refresh-token
// rows on the server, so revoking a session invalidates the device's auth
// without needing to send any body in the DELETE.

/// One active refresh-token row, exposed to the user as "a device that
/// is signed in." `is_current` marks the session that issued the
/// current access token — the UI uses it to disable the destructive
/// swipe action so the user can't accidentally sign themselves out of
/// the very device they're holding.
///
/// `user_agent` is the raw client-supplied UA string. The client parses
/// it cosmetically (iPhone vs iPad vs Mac vs Web) to pick an icon. The
/// server makes no promises about the format, so the parser is
/// best-effort and falls back to a generic "Device" pill on miss.
struct SessionInfo: Decodable, Equatable, Identifiable {
    let id: String
    let user_agent: String?
    let created_at: String
    let last_used_at: String?
    let is_current: Bool
}

/// Envelope for `GET /api/v1/me/sessions`. Matches the `{ items: [...] }`
/// shape the other endpoints in the file use.
struct SessionsResponse: Decodable, Equatable {
    let items: [SessionInfo]
}

// MARK: - Endpoints

extension Endpoint where Response == SessionsResponse {
    /// `GET /api/v1/me/sessions` — list every active refresh-token for the
    /// signed-in user, including the one issued to this device.
    static func sessions() -> Endpoint<SessionsResponse> {
        Endpoint(method: .get, path: "/api/v1/me/sessions", requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    /// `DELETE /api/v1/me/sessions/:id` — revoke a single session. Server
    /// returns 204. The current device's session can be revoked too, but
    /// the UI disables that swipe to keep "sign me out of THIS phone" off
    /// the active-devices screen — that's what the Settings logout button
    /// is for.
    static func revokeSession(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete, path: "/api/v1/me/sessions/\(id)", requiresAuth: true)
    }

    /// `DELETE /api/v1/me/sessions` — revoke every session except the
    /// current one. Server returns 204. Used by "Sign out everywhere
    /// else" in the toolbar.
    static func revokeAllOtherSessions() -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete, path: "/api/v1/me/sessions", requiresAuth: true)
    }
}
