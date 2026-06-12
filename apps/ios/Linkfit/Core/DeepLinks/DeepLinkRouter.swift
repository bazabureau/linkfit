import Foundation
import Observation

// MARK: - URLDeepLinkRouter
//
// Central inbox for incoming `https://linkfit.app/...` Universal Links and
// `linkfit://` custom-scheme URLs. The router parses a URL into a typed
// `Destination` and stashes it as a pending value; the navigation layer
// (HomeView / RootView) consumes it on appear / on observation and pushes
// the right screen onto its NavigationPath.
//
// Two consumption paths are supported deliberately:
//
//   1. Imperative `consume()` — what we wire today from `LinkfitApp.task`.
//      Pulls the pending destination and clears it in one go. Used while
//      HomeView is being heavily refactored in parallel and we don't want
//      to introduce merge conflicts there.
//
//   2. Observable `pendingDestination` — once HomeView settles, it can
//      observe this property directly (`@State` lookup or `.onChange`) and
//      push onto its `NavigationPath`. The router is `@Observable` so any
//      assignment triggers SwiftUI invalidation automatically.
//
// Requires associated domains entitlement (`applinks:linkfit.app`) — set
// in project.yml / Linkfit.entitlements once the AASA file is published at
// https://linkfit.app/.well-known/apple-app-site-association. Without that
// entitlement, taps on `https://linkfit.app/...` from Safari/Messages/Mail
// will NOT route through `.onOpenURL` — they'll open Safari instead. The
// in-app router code below still works for the `linkfit://` custom scheme
// (widget taps, share-card buttons, etc.) regardless of AASA.
//
// Naming: a separate `DeepLinkRouter` already exists in
// `Core/Push/DeepLink.swift` for routing APS notification taps (a
// different surface — `userInfo`-payload classification, AsyncStream
// fan-out). This URL router is intentionally named `URLDeepLinkRouter`
// so the two coexist without colliding. They can be unified behind a
// single facade later; for now the push and URL paths stay independent.

@Observable
@MainActor
final class URLDeepLinkRouter {

    // MARK: Destination

    /// Typed deep-link target. Each case carries the minimum identifier the
    /// destination view needs to render — usually a server-side id. The
    /// view layer is responsible for fetching the rest of the record.
    enum Destination: Equatable, Sendable {
        case game(String)
        case user(String)
        case venue(String)
        case referral(String)
        case thread(String)
        case tournament(String)
        case squad(String)
    }

    // MARK: Singleton

    /// Single global instance. The router is intentionally process-wide
    /// because `.onOpenURL` callbacks fire from SwiftUI's scene plumbing,
    /// not from any one view, and we need a stable target across the
    /// app's lifetime (cold launch vs. warm hand-off both land here).
    static let shared = URLDeepLinkRouter()

    // MARK: State

    /// The most recently parsed destination that hasn't been consumed yet.
    /// `@Observable` makes this trigger SwiftUI dependency tracking for
    /// any view that reads it — though today we consume imperatively via
    /// `consume()` from the App scene to avoid touching HomeView while
    /// other agents are refactoring it (see top-of-file note).
    private(set) var pendingDestination: Destination?

    private init() {}

    // MARK: Inbox

    /// Entry point called from `.onOpenURL`. Returns `true` if the URL was
    /// recognized as a Linkfit deep link (and stashed for consumption),
    /// `false` if the URL is unknown — letting the caller fall through to
    /// other handlers (e.g. OAuth providers) without overwriting state.
    @discardableResult
    func handle(_ url: URL) -> Bool {
        guard let destination = Self.parse(url) else { return false }
        pendingDestination = destination
        return true
    }

    /// Push-tap entry point — called from `AppDelegate.userNotificationCenter
    /// (_:didReceive:)` with the APNs `userInfo` dict. We classify the
    /// payload's identifier keys (mirroring what
    /// `notifications.service.ts emit()` ships in `data`) and stash the
    /// result as a pending destination so HomeView's `.task` consumer can
    /// push the route onto the active tab's NavigationPath on next appear.
    ///
    /// Why this lives next to `handle(_ url:)`: URL-based and push-based
    /// deep links share the same downstream consumer (HomeView's
    /// `.consume()` poll). Routing them through one inbox means HomeView
    /// only has to learn about one router — keeping the existing
    /// `Core/Push/DeepLink.swift` AsyncStream side untouched for code that
    /// still listens there.
    ///
    /// Returns `true` if a destination was recognized and stashed.
    @discardableResult
    func handle(userInfo: [AnyHashable: Any]) -> Bool {
        guard let destination = Self.destination(fromUserInfo: userInfo) else { return false }
        pendingDestination = destination
        return true
    }

    /// Pure userInfo → Destination classifier. Recognizes the payload keys
    /// the backend emits (`notifications.service.ts emit()`):
    ///   - `conversation_id` → `.thread(id)`
    ///   - `game_id`         → `.game(id)`
    ///   - `follower_user_id` (preferred) or `user_id` → `.user(id)`
    ///   - `venue_id`        → `.venue(id)`
    ///
    /// Order is intentional: a `message_received` notification can carry
    /// both `conversation_id` and a `user_id` (the sender) — we route to
    /// the thread, not the sender's profile, since that's the action the
    /// user just signalled intent for. Likewise a `rating_received`
    /// carries `game_id` + `rating_id`; game wins.
    static func destination(fromUserInfo userInfo: [AnyHashable: Any]) -> Destination? {
        if let conversationId = userInfo["conversation_id"] as? String, !conversationId.isEmpty, UUID(uuidString: conversationId) != nil {
            return .thread(conversationId)
        }
        if let gameId = userInfo["game_id"] as? String, !gameId.isEmpty, UUID(uuidString: gameId) != nil {
            return .game(gameId)
        }
        // `follower_user_id` is the canonical key for `follow` events;
        // `user_id` is a tolerant fallback for older payload shapes.
        if let followerId = userInfo["follower_user_id"] as? String, !followerId.isEmpty, UUID(uuidString: followerId) != nil {
            return .user(followerId)
        }
        if let userId = userInfo["user_id"] as? String, !userId.isEmpty, UUID(uuidString: userId) != nil {
            return .user(userId)
        }
        if let venueId = userInfo["venue_id"] as? String, !venueId.isEmpty, UUID(uuidString: venueId) != nil {
            return .venue(venueId)
        }
        if let tournamentId = userInfo["tournament_id"] as? String, !tournamentId.isEmpty, UUID(uuidString: tournamentId) != nil {
            return .tournament(tournamentId)
        }
        if let squadId = userInfo["squad_id"] as? String, !squadId.isEmpty, UUID(uuidString: squadId) != nil {
            return .squad(squadId)
        }
        return nil
    }

    /// Pulls the pending destination and clears it atomically. Returns
    /// `nil` if nothing is pending. Call from a `.task` / `.onAppear` once
    /// the navigation stack is mounted and ready to push.
    func consume() -> Destination? {
        let pending = pendingDestination
        pendingDestination = nil
        return pending
    }

    // MARK: Parsing

    /// Pure URL → Destination parser. Pulled out of `handle` so it's unit-
    /// testable without touching the singleton. Recognizes both the
    /// Universal Link host (`linkfit.app`) and the `linkfit://` custom
    /// scheme used by widgets / share-card buttons, since both flow
    /// through the same `.onOpenURL`.
    ///
    /// Patterns handled:
    ///   - `https://linkfit.app/games/<id>` → `.game(<id>)`
    ///   - `https://linkfit.app/users/<id>` → `.user(<id>)`
    ///   - `https://linkfit.app/venues/<id>` → `.venue(<id>)`
    ///   - `https://linkfit.app/r/<code>` → `.referral(<code>)`
    ///   - `https://linkfit.app/threads/<id>` → `.thread(<id>)`
    ///
    /// Custom-scheme equivalents (`linkfit://g/<id>`, `linkfit://u/<id>`,
    /// `linkfit://v/<id>`, `linkfit://r/<code>`, `linkfit://t/<id>`) are
    /// accepted as shorter aliases — the widget agent already emits the
    /// `linkfit://g/<gameId>` form (see project.yml CFBundleURLTypes).
    static func parse(_ url: URL) -> Destination? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }

        // Reject schemes we don't own outright. We accept both http(s) for
        // Universal Links and `linkfit` for the custom scheme.
        let scheme = components.scheme?.lowercased() ?? ""
        switch scheme {
        case "https", "http":
            // Universal Links must come from the linkfit.app host (or a
            // www. variant). Anything else is a stray link that happens to
            // hit `.onOpenURL` — ignore.
            let host = components.host?.lowercased() ?? ""
            guard host == "linkfit.app" || host == "www.linkfit.app" else {
                return nil
            }
        case "linkfit":
            // Custom scheme — accept any host (the meaningful selector
            // lives in the host for some widget links like
            // `linkfit://matchmaking` and in the path for others).
            break
        default:
            return nil
        }

        // Build a unified `[scheme-specific].[path]` segment list so the
        // matching logic doesn't have to branch per scheme. For the custom
        // scheme, the "host" carries the type prefix (`g`, `u`, `v`, ...),
        // so we splice it in front of the path components.
        var segments: [String] = url.pathComponents.filter { $0 != "/" && !$0.isEmpty }
        if scheme == "linkfit", let host = components.host, !host.isEmpty {
            segments.insert(host, at: 0)
        }

        // We always need a type-tag + at least one identifier component.
        guard segments.count >= 2 else { return nil }

        let typeTag = segments[0].lowercased()
        // Take the SECOND segment as the id. Trailing segments (e.g.
        // `/games/<id>/leaderboard`) are tolerated but ignored — the view
        // layer can deep-link further once it has the root record.
        let identifier = segments[1]

        // Empty ids are a malformed link, not a routable destination.
        guard !identifier.isEmpty else { return nil }

        switch typeTag {
        case "games", "g":
            return UUID(uuidString: identifier) != nil ? .game(identifier) : nil
        case "users", "u":
            return UUID(uuidString: identifier) != nil ? .user(identifier) : nil
        case "venues", "v":
            return UUID(uuidString: identifier) != nil ? .venue(identifier) : nil
        case "r", "referral", "referrals":
            return .referral(identifier)
        case "threads", "t", "conversations":
            return UUID(uuidString: identifier) != nil ? .thread(identifier) : nil
        case "tournaments", "tour", "tournament":
            return UUID(uuidString: identifier) != nil ? .tournament(identifier) : nil
        case "squads", "sq", "squad":
            return UUID(uuidString: identifier) != nil ? .squad(identifier) : nil
        default:
            return nil
        }
    }
}
