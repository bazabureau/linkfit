import SwiftUI

/// Integration hook for the Daily Challenges feature.
///
/// File ownership rule: this folder is the only place that touches
/// challenges surfaces. HomeView interacts with us through
/// `ChallengesHook.makeCard(container:onTap:)` exclusively — same
/// convention `StreaksHook`, `SuggestedFollowsHook`, and `FeedHook`
/// already follow.
///
/// The card is meant to live between the suggested-follows rail and
/// the stories rail in HomeView. The host owns the navigation routes
/// (tapping a row routes to the players tab, opens the story creator,
/// pushes to a game, etc.) — the card just hands back the
/// `ChallengeCode` it was tapped on.
enum ChallengesHook {
    /// Build the home card view. Pass the AppContainer so the hook
    /// can construct the view-model with the real APIClient; pass an
    /// `onTap` closure that routes to the action surface for the
    /// chosen code. The card hides itself when the user has completed
    /// all three of today's challenges.
    @MainActor
    static func makeCard(
        container: AppContainer,
        onTap: @escaping (ChallengeCode) -> Void
    ) -> some View {
        DailyChallengesCard(
            viewModel: DailyChallengesViewModel(apiClient: container.apiClient),
            onTap: onTap
        )
    }
}
