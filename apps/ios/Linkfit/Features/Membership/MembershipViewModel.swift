import Foundation
import Observation
import UIKit

/// Drives the Membership screen.
///
/// Three operations:
///   - `load()`           — fetches `/me/membership`
///   - `subscribe(tier:)` — POSTs to `/membership/subscribe`. If the server
///                          returns `mode == "checkout"` with a URL we open
///                          Safari; if `mode == "demo"` we just refresh.
///   - `cancel()`         — POSTs to `/membership/cancel`
///
/// Each mutation operates with optimistic UX (the user sees a spinner on
/// the row they tapped) and reloads `state` from the source of truth on
/// completion so the displayed period_end / cancel_flag are accurate.
@Observable
@MainActor
final class MembershipViewModel {
    private(set) var state: ViewState<MembershipState> = .idle
    /// Set while a subscribe/cancel network call is in flight. Disables
    /// every CTA so the user can't double-tap.
    private(set) var isMutating: Bool = false
    /// Tier currently being subscribed to — drives the per-card spinner.
    /// `nil` means no active mutation.
    private(set) var mutatingTier: MembershipTier?
    /// Last error from a subscribe/cancel call. Cleared on the next load.
    /// Surfaced via a banner; the screen overall stays interactive.
    var lastErrorMessage: String?
    /// One-shot toast trigger. The view watches this and renders a
    /// transient "Plus aktivləşdirildi" message when set.
    var lastSuccessMessage: String?

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Initial fetch. Idempotent — safe to call from `.task` or
    /// `.refreshable`. We move to `.loading` on first call so the UI
    /// shows a spinner; subsequent reloads keep the loaded payload
    /// visible to avoid layout jumps.
    func load() async {
        if case .loaded = state {} else { state = .loading }
        do {
            let resp = try await apiClient.send(Endpoint<MembershipState>.myMembership)
            state = .loaded(resp)
            lastErrorMessage = nil
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.errorDescription ?? String(localized: "membership.error.load"))
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    /// Subscribe to `tier`. In demo mode the server flips the row server-
    /// side and we just refresh; in live mode the server hands back a
    /// Stripe Checkout URL we open with `UIApplication.shared.open`. The
    /// app re-loads its state on `scenePhase`→`.active` so a successful
    /// checkout is reflected without explicit polling.
    func subscribe(to tier: MembershipTier) async {
        guard tier != .free else { return }
        isMutating = true
        mutatingTier = tier
        defer {
            isMutating = false
            mutatingTier = nil
        }

        do {
            let resp = try await apiClient.send(Endpoint<SubscribeResponse>.subscribeMembership(tier: tier))
            switch resp.mode {
            case .demo:
                await load()
                lastSuccessMessage = String(localized: "membership.toast.upgraded")
            case .checkout:
                if let urlString = resp.checkout_url, let url = URL(string: urlString) {
                    await UIApplication.shared.open(url)
                    // The user is now in Safari. We refresh state on
                    // return — the SceneDelegate's foreground hook will
                    // call `load()` again. As a fallback we also schedule
                    // a refresh in 2s so the first appearance shows the
                    // pending Stripe handshake.
                    Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 2_000_000_000)
                        await self.load()
                    }
                } else {
                    lastErrorMessage = String(localized: "membership.error.no_checkout_url")
                }
            }
        } catch let error as APIError {
            lastErrorMessage = error.errorDescription ?? String(localized: "membership.error.subscribe")
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    /// Cancel the active subscription. The row keeps its tier until
    /// `current_period_end` — the cancel CTA flips to "Cancellation
    /// scheduled" once this succeeds.
    func cancel() async {
        isMutating = true
        defer { isMutating = false }
        do {
            _ = try await apiClient.send(Endpoint<CancelMembershipResponse>.cancelMembership)
            await load()
            lastSuccessMessage = String(localized: "membership.toast.cancelled")
        } catch let error as APIError {
            lastErrorMessage = error.errorDescription ?? String(localized: "membership.error.cancel")
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    // MARK: - View helpers (called from `MembershipView`)

    /// Server-emitted tier-card definitions. We project them off the
    /// state so the cards stay rendered even when reloading (the view
    /// caches the last `.loaded` payload for that purpose). Order is
    /// always free → plus → premium so the layout is stable.
    static func staticCards() -> [TierCardModel] {
        [
            .init(
                tier: .free,
                priceMinor: 0,
                currency: "AZN",
                titleKey: "membership.tier.free.title",
                subtitleKey: "membership.tier.free.subtitle",
                accentSymbol: "person.fill",
            ),
            .init(
                tier: .plus,
                priceMinor: 999,
                currency: "AZN",
                titleKey: "membership.tier.plus.title",
                subtitleKey: "membership.tier.plus.subtitle",
                accentSymbol: "sparkles",
            ),
            .init(
                tier: .premium,
                priceMinor: 1999,
                currency: "AZN",
                titleKey: "membership.tier.premium.title",
                subtitleKey: "membership.tier.premium.subtitle",
                accentSymbol: "crown.fill",
            ),
        ]
    }
}

/// Static representation of a tier card. Pricing + copy come from the
/// client because the cards render before the network responds (skeleton
/// → loaded). The `MembershipState.benefits` payload is the authoritative
/// source for the *current user's* unlocked benefits when we render the
/// "Active" pill — see `BenefitsList`.
struct TierCardModel: Identifiable, Hashable {
    let tier: MembershipTier
    let priceMinor: Int
    let currency: String
    let titleKey: String
    let subtitleKey: String
    let accentSymbol: String

    var id: MembershipTier { tier }
}
