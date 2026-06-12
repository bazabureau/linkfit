import Foundation
import Observation

/// Drives the Referrals screen. Owns the dashboard `MyReferralsResponse`
/// (code + referred users) plus a tiny status surface for the redeem sheet
/// so the parent screen can show inline success/error banners.
///
/// All mutations go through the `APIClient`; the view never touches network
/// directly. We deliberately keep the state model dumb-and-flat: a single
/// `ViewState<MyReferralsResponse>` for the dashboard, a separate
/// `redeemError` / `redeemSuccess` pair for the sheet's outcome.
@Observable
@MainActor
final class ReferralsViewModel {
    private(set) var state: ViewState<MyReferralsResponse> = .idle
    /// Set to a non-nil string when the most recent redeem attempt failed.
    /// Cleared by `clearRedeemFeedback()` once the parent surface displays it.
    private(set) var redeemError: String?
    /// Display name of the referrer when a redeem just succeeded; used in
    /// the "Welcome — referred by X" toast. Cleared with `clearRedeemFeedback()`.
    private(set) var redeemSuccess: String?

    private let apiClient: APIClient
    let container: AppContainer

    init(apiClient: APIClient, container: AppContainer) {
        self.apiClient = apiClient
        self.container = container
    }

    /// Fetch the dashboard. Idempotent — safe to call from both `.task` and
    /// `.refreshable`. We always go through `.loading` so the user sees a
    /// spinner instead of a stale code when the network is slow.
    func load() async {
        // Preserve `.loaded` across pull-to-refresh — flicker is worse than
        // a brief stale read here. Only show `.loading` on first call.
        if case .loaded = state {} else { state = .loading }
        do {
            let resp = try await apiClient.send(.myReferrals)
            state = .loaded(resp)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.localizedMessage)
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    /// Submit a code on behalf of the current user. Returns `true` on
    /// success so the sheet can dismiss; `false` keeps the sheet open so
    /// the user can fix the code.
    @discardableResult
    func redeem(code: String) async -> Bool {
        redeemError = nil
        redeemSuccess = nil
        let normalised = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard normalised.count == 6 else {
            redeemError = String(localized: "referrals.redeem.error.format")
            return false
        }
        do {
            let resp = try await apiClient.send(.redeemReferral(code: normalised))
            redeemSuccess = resp.referrer_display_name
            // Reload the dashboard so the count picks up (mainly used when
            // RedeemCodeSheet is opened from inside the Referrals tab — the
            // count on the hero card needs to refresh).
            await load()
            return true
        } catch let error as APIError {
            redeemError = error.localizedMessage
            return false
        } catch {
            redeemError = error.localizedDescription
            return false
        }
    }

    /// Called by the view after surfacing toast feedback, so the next
    /// open-redeem-sheet starts clean.
    func clearRedeemFeedback() {
        redeemError = nil
        redeemSuccess = nil
    }
}
