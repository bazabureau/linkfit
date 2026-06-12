import SwiftUI

/// Integration hook for the Squads feature.
///
/// Same pattern as `InsightsHook` / `AchievementsHook` — the Squads agent
/// owns its own files in `Features/Squads/`, but the Profile screen needs
/// a way to push the Squads root onto the navigation stack without
/// reaching into our internals. This hook is the public surface.
///
/// The Profile agent calls `SquadsHook.makeListView(container:)` from the
/// "Mənim squadlarım" account-list row, wrapped in a `navigationDestination`
/// that fires on a state toggle (mirroring how Settings / Insights /
/// Achievements are hooked up today). The Squads root then owns its own
/// nested navigation — Create + Detail are both pushed/presented from
/// inside the list.
///
/// Example wiring (Profile side):
///
///     accountRow(icon: "person.3.fill", titleKey: "profile.menu.squads") {
///         showSquads = true
///     }
///     // …
///     .navigationDestination(isPresented: $showSquads) {
///         SquadsHook.makeListView(container: viewModel.container)
///     }
///
/// Everything Squads needs is reachable through the shared `AppContainer`
/// (api client + current user id for owner checks). The hook is a thin
/// factory so the Profile agent never has to know which view-model the
/// list screen uses.
enum SquadsHook {
    /// Build the squads list screen for the currently-authenticated user.
    /// The Profile agent calls this from its row's destination.
    @MainActor
    static func makeListView(container: AppContainer) -> some View {
        SquadsListView(
            viewModel: SquadsListViewModel(
                apiClient: container.apiClient,
                currentUserId: container.currentUser?.id ?? ""
            )
        )
    }
}
