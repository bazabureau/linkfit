import Foundation

// MARK: - Follow administration endpoints
//
// Owner-only follow-graph mutations. Distinct from the existing
// `followUser` / `unfollowUser` pair (which let the caller manage their
// OWN outgoing edges): these let the caller manage their INCOMING edges
// — i.e. force-remove someone from their followers list. Backend enforces
// `caller == :id` and returns 403 otherwise.
//
// Kept in a dedicated file (not merged into the big `Endpoint.swift`)
// per the project convention used for Privacy / Sessions / Referrals /
// Blocks. Keeps git blame for follow-admin features in one place.

extension Endpoint where Response == EmptyResponse {
    /// Force-remove a follower from the caller's followers list.
    /// Backend: DELETE /api/v1/users/:id/followers/:followerId. Returns 204.
    /// Caller must equal :id (else 403).
    static func removeFollower(profileUserId: String, followerUserId: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete,
                 path: "/api/v1/users/\(profileUserId)/followers/\(followerUserId)",
                 requiresAuth: true)
    }
}
