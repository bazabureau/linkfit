import Foundation

// MARK: - Privacy / GDPR models
//
// GDPR-flavored "right to access" + "right to be forgotten" surface. Both
// endpoints are owned by FAZA 2.1 / FAZA 2.4 on the backend and return
// long-lived request records (the export blob lives in S3-style storage,
// the deletion is gated by a 30-day grace window).
//
// Kept in this dedicated file (rather than merged into the big
// `Endpoint.swift`) so the Privacy feature can evolve without touching
// the central endpoint module — see CLAUDE.md / project convention.

/// A user-initiated data-export request. Server-side state machine:
/// `queued`/`pending` → `ready` (download_url populated) → eventually expires
/// (`expires_at` past). Can also flip to `failed` on a worker error.
struct DataExportRequest: Decodable, Equatable {
    let id: String
    let status: String // "pending", "ready", "failed"
    let created_at: String
    let expires_at: String?
    let download_url: String?
}

/// A scheduled account-deletion request. `scheduled_at` is when the user
/// asked, `hard_delete_at` is the timestamp the backend will actually
/// erase the row (30-day grace window). Going from `scheduled` →
/// `cancelled` is a no-cost reversal as long as the user calls
/// `/me/delete/cancel` before `hard_delete_at`.
struct AccountDeletionRequest: Decodable, Equatable {
    let id: String
    let status: String // "scheduled", "cancelled", "completed"
    let scheduled_at: String?
    let hard_delete_at: String?
}

// MARK: - Endpoints

extension Endpoint where Response == DataExportRequest {
    /// POST /api/v1/me/data-export — kicks off a fresh export job.
    /// Idempotent on the backend within a short window; returns the
    /// in-flight record either way.
    static func requestDataExport() -> Endpoint<DataExportRequest> {
        Endpoint(method: .post,
                 path: "/api/v1/me/data-export",
                 requiresAuth: true)
    }

}

extension Endpoint where Response == DataExportRequest? {
    /// GET /api/v1/me/data-export — polls the most-recent export request
    /// for the caller. Backend returns JSON null when no export exists yet.
    static func dataExportStatus() -> Endpoint<DataExportRequest?> {
        Endpoint(method: .get,
                 path: "/api/v1/me/data-export",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == AccountDeletionRequest {
    /// POST /api/v1/me/delete — schedules a hard-delete in T+30 days.
    /// Idempotent: calling twice returns the same scheduled record.
    static func scheduleAccountDeletion() -> Endpoint<AccountDeletionRequest> {
        Endpoint(method: .post,
                 path: "/api/v1/me/delete",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == AccountDeletionRequest? {
    /// GET /api/v1/me/delete — returns the user's pending deletion
    /// record, or `nil` (decoded from `null`/empty) when no request is
    /// outstanding. Keeping the optional in the type means the caller
    /// can treat "no pending deletion" as a first-class state without
    /// inventing a sentinel value.
    static func accountDeletionStatus() -> Endpoint<AccountDeletionRequest?> {
        Endpoint(method: .get,
                 path: "/api/v1/me/delete",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    /// POST /api/v1/me/delete/cancel — reverses a pending deletion as
    /// long as it's still inside the 30-day grace window. Server returns
    /// 204 on success; we model that as `EmptyResponse`.
    static func cancelAccountDeletion() -> Endpoint<EmptyResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/me/delete/cancel",
                 requiresAuth: true)
    }
}
