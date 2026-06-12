import SwiftUI

// =============================================================================
// PROFILE → FOLLOWERS / FOLLOWING NAVIGATION HOOK
// -----------------------------------------------------------------------------
// TODO(profile-agent): ProfileView is owned by another agent so this file
// only documents how to wire up navigation into the follows lists. When the
// profile owner adds a "Followers" / "Following" row to the user's stats card
// they should:
//
//   1. Hold a `@State private var followsSheet: FollowsListSheetPayload?` on
//      ProfileView.
//   2. Set it on tap, e.g.
//        Button("Followers") {
//            followsSheet = FollowsListSheetPayload(userId: profile.id, kind: .followers)
//        }
//   3. Mount the sheet using `ProfileFollowsSheet` below (or inline the
//      NavigationStack + FollowListView themselves if they prefer):
//        .sheet(item: $followsSheet) { payload in
//            ProfileFollowsSheet(payload: payload) { tappedUserId in
//                // push to HomeRoute.profile(tappedUserId) via the host path
//            }
//        }
//
// The sheet self-dismisses; the host only needs to handle the "user tapped a
// row" callback. We deliberately do NOT push directly onto the parent
// NavigationStack because ProfileView is opened inside a sheet on some entry
// points and a NavigationStack on others — a presented sheet works in both.
// =============================================================================

/// Drop-in sheet that renders a paginated follow list inside its own
/// NavigationStack. Hand it a payload from the host and a "user tapped"
/// callback; the rest is self-contained.
struct ProfileFollowsSheet: View {
    let payload: FollowsListSheetPayload
    /// Invoked when a row is tapped. The host owns deciding whether to push,
    /// re-present, or no-op.
    let onPickUser: (String) -> Void

    @Environment(AppContainer.self) private var container

    var body: some View {
        NavigationStack {
            FollowListView(
                viewModel: FollowListViewModel(
                    apiClient: container.apiClient,
                    userId: payload.userId,
                    kind: payload.kind,
                    viewerUserId: container.currentUser?.id
                ),
                onPickUser: onPickUser
            )
        }
        .presentationDetents([.large])
    }
}
