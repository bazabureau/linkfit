import Foundation

// MARK: - Invite friends / share

/// Payload returned from `GET /api/v1/me/referrals/share`. Owned by the
/// backend "referral share" agent — the response ships the caller's own
/// code, the canonical deep-link URL, and pre-rendered share copy in each
/// of the three app languages (so we never have to do client-side
/// templating for marketing-tuned text).
///
/// Kept in its own file (`Endpoint+Referrals.swift`) rather than folded
/// into the central `Endpoint.swift` so the Invite Friends feature can
/// evolve without touching the giant shared endpoint module — same
/// convention `Endpoint+Privacy.swift` already follows.
///
/// `Equatable` makes it easy to assert against in `ViewState` transitions
/// and unit tests.
struct ReferralShareResponse: Decodable, Equatable {
    let code: String
    let share_url: String
    let share_text: String
    let share_text_az: String
    let share_text_ru: String
}

extension Endpoint where Response == ReferralShareResponse {
    /// GET /api/v1/me/referrals/share — fetches the caller's personalised
    /// share copy (one localized variant per supported app language) plus
    /// the deep-link URL that drops a tapper straight into the App Store
    /// listing / app. Requires an auth session; the server lazily mints the
    /// referral code on first call so this endpoint is always safe to hit.
    static func referralShare() -> Endpoint<ReferralShareResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/me/referrals/share",
                 requiresAuth: true)
    }
}
