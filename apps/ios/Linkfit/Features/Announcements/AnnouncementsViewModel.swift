import Foundation
import Observation

/// State + load/dismiss logic for the slim top-of-Home announcement banner.
///
/// Surface is intentionally small: one mutable `current` field that the
/// banner view observes. `nil` → no active announcement → the LazyVStack
/// slot collapses and the banner reads as if it doesn't exist.
///
/// Flow:
///   * `load()` — single round-trip to `GET /api/v1/me/announcements`.
///                Idempotent and silent on failure (a network blip
///                should never surface as a red banner on Home).
///   * `dismiss()` — fires the server-side dismiss POST (idempotent,
///                   tolerant of unknown ids) and immediately clears
///                   the local `current` so the banner retracts within
///                   the same frame. Then re-loads to surface the
///                   next-priority active announcement if any.
///   * `openCTA()` — routes the announcement's `cta_url` through the
///                   shared `URLDeepLinkRouter` for `linkfit://` links,
///                   or hands it to the system openURL for `https://`.
///
/// Server-side audience filtering and dismissal ledger mean the iOS
/// VM doesn't need to track "what I've already dismissed" locally;
/// the server only returns rows the caller hasn't closed yet.
@Observable
@MainActor
final class AnnouncementsViewModel {
    /// The current banner to show, or `nil` when none qualifies. The
    /// banner view reads this once per render — no separate "loading"
    /// state because the banner is allowed to render zero-height while
    /// the first fetch resolves (no skeleton needed for a single row).
    private(set) var current: AnnouncementForUser?

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Fetch the highest-priority active announcement for the caller.
    /// Silent on failure — the banner stays hidden if the network is
    /// down, which is the right UX (announcements are best-effort).
    func load() async {
        do {
            let resp = try await apiClient.send(Endpoint.meAnnouncement())
            current = resp.announcement
        } catch is CancellationError {
            return
        } catch {
            // Best-effort surface. A 401 here means the auth session
            // is gone; the global APIClient will trigger the auth-lost
            // handler and the user is logged out anyway. Other errors
            // (offline, server outage) should not blow up Home.
            current = nil
        }
    }

    /// Record dismissal server-side and clear the local current banner.
    /// Re-fetches afterwards so the next-priority active announcement
    /// (if any) slides into the same banner slot. The local clear is
    /// optimistic — if the POST fails the banner still retracts (the
    /// server-side dedup will eventually clean up on the next load).
    func dismiss() async {
        guard let announcement = current else { return }
        // Optimistic clear so the banner retracts on tap, not after the
        // server round-trip resolves. The X button reads as instantly
        // responsive even on a slow network.
        current = nil
        _ = try? await apiClient.send(Endpoint.dismissAnnouncement(id: announcement.id))
        // Re-fetch to surface the next-priority active row (if any) so
        // a multi-banner queue drains naturally without a page refresh.
        await load()
    }
}

extension AnnouncementsViewModel {
    /// Resolve the announcement's `cta_url` into a deep-link / external
    /// open intent. Returns `nil` when there's no CTA or the URL is
    /// malformed. The banner view uses this on the CTA chevron tap.
    ///
    /// `linkfit://` custom-scheme URLs route through the existing
    /// `URLDeepLinkRouter.shared.handle(_:)` — same path push taps and
    /// Universal Links already use, so a deep link from an announcement
    /// lands the user exactly where a notification with the same target
    /// would. External `https://` URLs are returned as-is for the view
    /// to hand to `@Environment(\.openURL)`.
    enum CTAIntent {
        /// Custom-scheme deep link to route in-app.
        case deepLink(URL)
        /// External URL to hand to the system openURL.
        case external(URL)
    }

    func resolveCTA() -> CTAIntent? {
        guard let raw = current?.cta_url, !raw.isEmpty,
              let url = URL(string: raw) else { return nil }
        let scheme = url.scheme?.lowercased() ?? ""
        switch scheme {
        case "linkfit":
            return .deepLink(url)
        case "http", "https":
            return .external(url)
        default:
            // Unknown schemes are dropped silently — we don't want a
            // banner to launch an unexpected app via a `tel:` or `mailto:`
            // scheme an admin set by mistake. The X dismiss still works.
            return nil
        }
    }
}
