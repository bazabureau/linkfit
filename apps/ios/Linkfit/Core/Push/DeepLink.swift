import Foundation

/// Logical destinations the push tap-handler can route to. The cases mirror
/// the backend's `NotificationType` plus the entity-id needed to pull the
/// detail view. We keep this enum string-stable so older app installs can
/// still parse newer payloads without crashing.
enum DeepLink: Equatable, Hashable, Sendable {
    case gameDetail(id: String)
    case ratingsForGame(id: String)
    case conversation(id: String)
    case tournament(id: String)
    case profile(userId: String)
    case notificationsInbox
    /// Opens the Inbox sheet and lands on the Invitations tab. Used by
    /// `game_invite` pushes — tapping the notification should drop the
    /// invitee straight into the screen that lets them accept/decline,
    /// not the game detail (where the only useful action would be
    /// "join", but they're not yet a participant).
    case invitationsInbox
    /// Universal Link destinations. These don't appear in push payloads —
    /// they're produced by `from(url:)` when the OS hands us an
    /// `NSUserActivityTypeBrowsingWeb` activity from a tapped
    /// `https://linkfit.az/...` link. The push pipeline never emits
    /// these cases; they live in the same enum so the router code stays
    /// the single switch-on-`DeepLink` surface.
    case squad(id: String)
    case referralSignup(code: String)
    case venue(id: String)

    /// Best-effort decoder for an APS userInfo dictionary. The backend ships
    /// `type` + an entity-id (under a well-known key OR `entity_id`). Anything
    /// we can't classify falls back to the notifications inbox so the user
    /// still lands on a useful screen instead of nowhere.
    static func from(userInfo: [AnyHashable: Any]) -> DeepLink {
        let type = (userInfo["type"] as? String) ?? ""
        let entityId = (userInfo["entity_id"] as? String) ?? ""
        // Game-invite payloads piggy-back on the existing
        // `tournament_invite` notification type (see invitations.service:
        // we reuse the closest existing type so iOS routing/icons keep
        // working on older app installs). The discriminator is
        // `payload.kind == "game_invite"`. When we see that, route to
        // the Invitations inbox tab rather than the tournament screen.
        let kind = (userInfo["kind"] as? String) ?? ""
        if kind == "game_invite" {
            return .invitationsInbox
        }
        switch type {
        case "game_joined", "game_cancelled", "game_reminder":
            let id = (userInfo["game_id"] as? String) ?? entityId
            return id.isEmpty ? .notificationsInbox : .gameDetail(id: id)
        case "rating_received":
            let id = (userInfo["game_id"] as? String) ?? entityId
            return id.isEmpty ? .notificationsInbox : .ratingsForGame(id: id)
        case "message_received":
            let id = (userInfo["conversation_id"] as? String) ?? entityId
            return id.isEmpty ? .notificationsInbox : .conversation(id: id)
        case "tournament_invite":
            // Real tournament invites still route to the tournament
            // detail. Game-invites (kind=="game_invite") were
            // short-circuited above.
            let id = (userInfo["tournament_id"] as? String) ?? entityId
            return id.isEmpty ? .notificationsInbox : .tournament(id: id)
        case "game_invite":
            // Future-proof: if the backend ever ships a dedicated
            // `game_invite` type, route the same way.
            return .invitationsInbox
        case "system":
            if let follower = userInfo["follower_user_id"] as? String, !follower.isEmpty {
                return .profile(userId: follower)
            }
            return .notificationsInbox
        default:
            return .notificationsInbox
        }
    }

    /// Best-effort decoder for a Universal Link URL. The AASA file at
    /// `https://linkfit.az/.well-known/apple-app-site-association` claims
    /// the following path prefixes; we mirror them here:
    ///
    /// - `/g/<id>`   → game detail
    /// - `/p/<id>`   → user profile
    /// - `/s/<id>`   → conversation (chat) — `s` for "session"
    /// - `/sq/<id>`  → squad detail
    /// - `/r/<code>` → referral signup (code, not an id)
    /// - `/v/<id>`   → venue detail
    ///
    /// Unknown paths return `nil` so the caller can fall back to opening
    /// the web URL in Safari rather than swallowing the tap. The host
    /// check is loose on purpose — Apple already validates the apex
    /// (`linkfit.az`) against the entitlement before this code runs.
    static func from(url: URL) -> DeepLink? {
        // `pathComponents` for `/g/abc` yields `["/", "g", "abc"]`. We
        // drop the leading slash and work with the rest.
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count >= 2 else { return nil }
        let prefix = parts[0]
        let value = parts[1]
        guard !value.isEmpty else { return nil }
        switch prefix {
        case "g":
            return .gameDetail(id: value)
        case "p":
            return .profile(userId: value)
        case "s":
            return .conversation(id: value)
        case "sq":
            return .squad(id: value)
        case "r":
            return .referralSignup(code: value)
        case "v":
            return .venue(id: value)
        case "t", "tournaments", "tour":
            return .tournament(id: value)
        default:
            return nil
        }
    }
}

/// Broadcaster for deep-link events. The app listens via a Combine-free
/// AsyncStream so views can `.task { for await link in DeepLinkRouter.shared.links { ... } }`.
@MainActor
final class DeepLinkRouter {
    static let shared = DeepLinkRouter()

    private var continuation: AsyncStream<DeepLink>.Continuation?
    let links: AsyncStream<DeepLink>

    private init() {
        var captured: AsyncStream<DeepLink>.Continuation!
        self.links = AsyncStream { c in captured = c }
        self.continuation = captured
    }

    /// Publishes a deep-link to any active listener. Safe to call from any
    /// thread — the AsyncStream coordinates delivery onto the consumer's
    /// awaiting task.
    func route(_ link: DeepLink) {
        continuation?.yield(link)
    }
}
