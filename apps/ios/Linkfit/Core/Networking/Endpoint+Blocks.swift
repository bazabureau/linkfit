import Foundation

// MARK: - Blocked-users models
//
// "Right to block" surface. Lists every user the caller has blocked,
// most-recent-first, so the user can review and undo individual blocks
// from Settings. Mirrors the existing `Endpoint.blockUser(id:)` /
// `Endpoint.unblockUser(id:)` pair in `Endpoint.swift` — those POST/DELETE
// the relationship; this one reads the current set.
//
// Kept in a dedicated file (not merged into the big `Endpoint.swift`)
// per the project convention used for Privacy / Sessions / Referrals.

/// A single row in the blocked-users list. `blocked_at` is the ISO-8601
/// timestamp the block was created — the view renders it as a relative
/// "5 m ago" caption beside the avatar.
struct BlockedUser: Decodable, Identifiable, Equatable {
    let user_id: String
    let display_name: String
    let photo_url: String?
    let blocked_at: String
    var id: String { user_id }
}

/// Envelope returned by `GET /api/v1/me/blocks`. Server orders rows
/// newest-first; we render them in the same order without resorting.
struct BlockedUsersResponse: Decodable, Equatable {
    let items: [BlockedUser]
}

// MARK: - Endpoints

extension Endpoint where Response == BlockedUsersResponse {
    /// GET /api/v1/me/blocks — fetches the caller's full block list.
    /// Backed by FAZA 2 / privacy work. The unblock action reuses the
    /// existing `Endpoint.unblockUser(id:)` (DELETE /users/{id}/block),
    /// so this file only owns the read path.
    static func blockedUsers() -> Endpoint<BlockedUsersResponse> {
        Endpoint(method: .get, path: "/api/v1/me/blocks", requiresAuth: true)
    }
}
