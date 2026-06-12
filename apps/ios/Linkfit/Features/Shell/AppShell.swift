import SwiftUI

/// Authenticated app shell.
///
/// Sits between `RootView` (which switches on `isAuthenticated`) and the
/// big `HomeView`/tab surface. Its sole job is to overlay first-launch
/// activation experiences — today, the four-step `OnboardingTourView` — so
/// `HomeView` doesn't have to know about them.
///
/// First-launch gate
/// -----------------
/// We persist a single boolean under `OnboardingTourViewModel.storageKey`
/// (literal value `"onboarding.tour.completed"`). On every appearance of
/// the shell we read it once: if `false`, the tour cover is presented as a
/// `.fullScreenCover`; the tour view itself writes the flag to `true` when
/// it finishes (CTA on slide 4) or when the user taps "Keç". We mirror that
/// write into `@AppStorage` here so the SwiftUI binding flips the cover
/// closed in the same render pass that `UserDefaults` is updated.
///
/// Why a separate shell rather than wiring this inside `HomeView` or
/// `RootView`?
///
/// - `HomeView` is enormous and already orchestrates ~7 sheets, deep links,
///   tab state, and a soft-update banner. Layering a one-shot first-launch
///   experience on top would entangle "show the tour" with home-tab state
///   and make either of them harder to evolve.
/// - `RootView` is the auth/onboarding router. Keeping it focused on
///   "splash → marketing onboarding → auth → authed shell" means the tour
///   doesn't compete for attention with the auth gate.
///
/// The shell is therefore the right place: it's the first surface a
/// freshly-signed-in user sees, and it's a clean seam between routing and
/// the in-app experience.
struct AppShell: View {
    @Environment(AppContainer.self) private var container

    // The W10-8 four-step `OnboardingTourView` (the SF-Symbol tour with
    // headlines "Oyun tap / Squad qur / Səviyyəni yüksəlt / Bildirişlər")
    // used to be presented here as a `.fullScreenCover` after signup. It
    // was removed in response to user feedback — the pre-signup
    // `OnboardingView` (photo-first flow with `Illustrations/*` art,
    // mounted by `RootView`) is the only onboarding we ship. The tour
    // files remain on disk as dead code for future revival; deleting them
    // is a separate cleanup pass.

    var body: some View {
        HomeView(viewModel: HomeViewModel(apiClient: container.apiClient))
            .task {
                if container.currentUser == nil {
                    await loadMe()
                }
                // Soft fallback: if the user denies push permission we
                // still land here — `start()` returns immediately and
                // the rest of the app keeps working. The tour's final
                // slide *also* asks for push, so on a first-launch path
                // this is the second nudge; iOS dedupes the actual
                // system dialog so a denied user sees it once.
                await container.pushRegistrar.start()
            }
            // Universal Links — when a tap on `https://linkfit.az/...`
            // launches or resumes the app, the OS hands us an
            // `NSUserActivityTypeBrowsingWeb` activity carrying the URL.
            // We decode it to a `DeepLink` (see `DeepLink.from(url:)`)
            // and publish through the shared router so existing
            // listeners — the same ones that handle push taps — pick
            // it up. URLs we can't classify are dropped silently;
            // Safari fallback is unnecessary because the AASA `paths`
            // list already filters at the OS layer to the prefixes we
            // know how to handle.
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                guard let url = activity.webpageURL,
                      let link = DeepLink.from(url: url) else { return }
                DeepLinkRouter.shared.route(link)
            }
    }

    /// Mirrors the previous fetch that lived in `RootView` — keeps
    /// `container.currentUser` populated on first appearance after a
    /// successful auth. Pulled into the shell so `RootView` no longer
    /// needs the helper.
    private func loadMe() async {
        do {
            let me = try await container.apiClient.send(.me)
            container.updateCurrentUser(me)
        } catch {
            // APIClient already cleared the session on auth-lost.
        }
    }
}
