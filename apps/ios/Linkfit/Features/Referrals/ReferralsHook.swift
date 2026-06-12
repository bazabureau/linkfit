import SwiftUI

/// Integration hook for the Referrals feature.
///
/// We own everything inside `Features/Referrals/**` exclusively. Auth /
/// Profile / Settings are off-limits to this agent (file-ownership rule)
/// — the helpers below document how those agents should surface the
/// Referrals entry points without us ever touching their files.
///
/// Two integration shapes:
///
/// 1. **Post-signup redeem CTA (Auth agent / RegisterView).**
///    Best placement is right after `setSession(...)` completes in the
///    register flow. Show a one-shot bottom sheet with copy like
///    "Got a referral code? Redeem it to unlock a welcome badge." The
///    Auth agent can call:
///
///    ```swift
///    .sheet(isPresented: $showReferralRedeem) {
///        ReferralsHook.makeRedeemSheet(container: container) {
///            showReferralRedeem = false
///        }
///    }
///    ```
///
///    The view-model behind the sheet is fully self-contained — it just
///    POSTs to `/auth/redeem-referral`, then dismisses on success.
///
/// 2. **Settings / Profile row.**
///    Add a row to the Settings / Profile actions card pointing to the
///    full Referrals screen. The Settings agent can call:
///
///    ```swift
///    NavigationLink {
///        ReferralsHook.makeView(container: container)
///    } label: {
///        HStack {
///            Image(systemName: "person.2.fill")
///                .foregroundStyle(DSColor.accent)
///            Text("settings.referrals.title")
///                .foregroundStyle(DSColor.textPrimary)
///            Spacer()
///            Image(systemName: "chevron.right")
///                .foregroundStyle(DSColor.textTertiary)
///        }
///        .padding(DSSpacing.md)
///    }
///    .buttonStyle(.plain)
///    ```
///
/// Both factories build their own `ReferralsViewModel`, so callers don't
/// need to know about the dashboard / redeem split — they just hand over
/// the shared `AppContainer`. The view-model is `@MainActor`-bound and
/// `@Observable`, which matches the rest of the app's convention; no
/// special wrapping required at the call site.
///
/// All Referrals endpoints require an authenticated session — the
/// container's `apiClient` automatically attaches the bearer token. The
/// dashboard returns 401 to unauthenticated callers, so the Auth-agent
/// hook should only present the sheet after a session is established.
enum ReferralsHook {
    /// Build the full Referrals dashboard (hero code + share + redeem CTA
    /// + friend list). Intended to be pushed into a `NavigationStack` from
    /// Settings / Profile.
    @MainActor
    static func makeView(container: AppContainer) -> some View {
        ReferralsView(
            viewModel: ReferralsViewModel(
                apiClient: container.apiClient,
                container: container,
            ),
        )
    }

    /// Build a standalone redeem sheet — used by the Auth agent to surface
    /// a "Got a code?" prompt right after sign-up. The `onClose` closure
    /// is fired both on successful submission and on user cancel; the
    /// host view should set its `isPresented` binding to false.
    @MainActor
    static func makeRedeemSheet(
        container: AppContainer,
        onClose: @escaping () -> Void,
    ) -> some View {
        RedeemCodeSheet(
            viewModel: ReferralsViewModel(
                apiClient: container.apiClient,
                container: container,
            ),
            onClose: onClose,
        )
    }
}
