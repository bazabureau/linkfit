import SwiftUI

// =============================================================================
// SUGGESTED FOLLOWS — INTEGRATION HOOK
// -----------------------------------------------------------------------------
// Drop-in "People you may know" carousel. Hosts hand over the AppContainer
// and an `onTapUser` callback; the carousel handles its own fetch lifecycle,
// follow optimism, error surfacing, and silent-on-empty rendering.
//
// PlayersView is the canonical mount point (rendered above the players list),
// but any future surface — Home empty state, Inbox sidebar, post-game
// "you played with these people" prompt — can mount the same hook without
// re-implementing the carousel UI.
//
// Why a hook rather than `SuggestedFollowsView(...)` directly?
//   * The view-model construction needs `container.apiClient`; factoring it
//     into the hook means callers don't have to know the view-model exists.
//   * Lets us swap the underlying view (skeleton → loaded → empty) without
//     touching every call site.
//   * Mirrors the pattern established by `LiveActivityHook`,
//     `ReferralsHook`, `InsightsHook`, etc. — one entry point per feature,
//     enums-as-namespaces so there's no instance to inject.
// =============================================================================

enum SuggestedFollowsHook {
    /// Build the "People you may know" carousel.
    ///
    /// - Parameters:
    ///   - container: Shared app container. Only `apiClient` is read; we
    ///     don't capture the container itself so the returned view doesn't
    ///     re-render every time some unrelated container field flips.
    ///   - onTapUser: Tapping a card's body (avatar / name area) routes
    ///     here with the suggested user's id. PlayersView wraps this into
    ///     `onPickPlayer(PlayerSummary.placeholder(id:))` to push to the
    ///     same player profile destination the row tap uses.
    ///
    /// The carousel auto-hides when the server returns zero items, so the
    /// host can mount it unconditionally — no need for the call site to
    /// gate on a separate "should I show this?" boolean.
    @MainActor
    static func makeCarousel(
        container: AppContainer,
        onTapUser: @escaping (String) -> Void
    ) -> some View {
        SuggestedFollowsView(
            viewModel: SuggestedFollowsViewModel(apiClient: container.apiClient),
            onTapUser: onTapUser,
            layout: .section
        )
    }

    /// Build the "People you may know" rail for HomeView — narrower
    /// cards, AZ-first "Tanış olmaq istəyə bilərsən" copy, and a small
    /// "x" dismiss control on the right that fires `onDismiss`. Home
    /// uses a daily UserDefaults flag to decide whether to mount the
    /// rail at all; once mounted, this view handles its own fetch +
    /// per-card optimistic follow.
    ///
    /// - Parameters:
    ///   - container: Shared app container (reads `apiClient` only).
    ///   - onTapUser: Tapping a card's body routes here with the
    ///     suggested user's id; the host pushes the profile destination.
    ///   - onDismiss: Tapping the rail's "x" calls this. The host
    ///     persists the dismissal (per-session bool keyed by date) and
    ///     unmounts the rail until the next day.
    @MainActor
    static func makeRail(
        container: AppContainer,
        onTapUser: @escaping (String) -> Void,
        onDismiss: @escaping () -> Void
    ) -> some View {
        SuggestedFollowsView(
            viewModel: SuggestedFollowsViewModel(apiClient: container.apiClient),
            onTapUser: onTapUser,
            layout: .rail,
            onDismiss: onDismiss
        )
    }
}
