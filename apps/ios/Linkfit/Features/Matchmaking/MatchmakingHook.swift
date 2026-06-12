import SwiftUI

/// Integration hook for the Matchmaking feature.
///
/// File-ownership rule: this agent doesn't touch HomeView or any other
/// Features folder. To wire the "For You" carousels into the Home shell,
/// the Home agent should:
///
/// 1. Read the current `AppContainer` from `@Environment(AppContainer.self)`.
/// 2. Drop the view into HomeView's main scroll stack:
///
///        MatchmakingHook.makeView(
///            container: container,
///            onTapGame: { game in path.append(HomeRoute.game(game.id)) },
///            onTapPlayer: { player in path.append(HomeRoute.profile(player.id)) }
///        )
///
/// 3. The view sizes itself vertically; it already handles its own loading
///    / empty / error states and pull-to-refresh inside its ScrollView.
///    If the host already has a ScrollView, prefer calling
///    `MatchmakingHook.makeBody(...)` instead to avoid double-nesting (TODO
///    once the Home agent confirms they need it — flag for a follow-up).
///
/// 4. Both callbacks receive the full payload so the host can route
///    using id/sport/host info without an additional fetch.
///
/// All Matchmaking endpoints require an authenticated session; the API
/// returns 401 otherwise. The view model surfaces the "not signed in"
/// error message internally, so dropping the view into a logged-out
/// shell is safe.
enum MatchmakingHook {
    /// Build the matchmaking surface for the currently-authenticated user.
    /// Host wires the two callbacks to its own navigation stack.
    @MainActor
    static func makeView(
        container: AppContainer,
        onTapGame: @escaping (RecommendedGame) -> Void = { _ in },
        onTapPlayer: @escaping (RecommendedPlayer) -> Void = { _ in },
    ) -> some View {
        MatchmakingView(
            viewModel: MatchmakingViewModel(
                apiClient: container.apiClient,
                container: container,
            ),
            onTapGame: onTapGame,
            onTapPlayer: onTapPlayer,
        )
    }
}
