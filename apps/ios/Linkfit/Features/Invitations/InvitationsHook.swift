import SwiftUI

// MARK: - Integration contract for GameDetailView
//
// The Invitations agent owns this file. The Games-feature folder owns
// `GameDetailView`/`CreateGameView` and is responsible for actually wiring
// up the button + sheet — but the *integration shape* lives here so callers
// can adopt it without re-deriving the right way.
//
// To add "Invite player" to GameDetailView, the Games agent should:
//
//   1. Add a State flag for the sheet:
//
//        @State private var showInvitePlayerSheet = false
//
//   2. In the host-only action toolbar (the same place "Cancel game" lives),
//      add a button visible to the host while the game is `open`:
//
//        if container.currentUser?.id == game.host_user_id,
//           game.status == .open {
//            InviteHostActionButton {
//                showInvitePlayerSheet = true
//            }
//        }
//
//   3. Present the sheet with the already-loaded participants excluded:
//
//        .sheet(isPresented: $showInvitePlayerSheet) {
//            if case .loaded(let game) = viewModel.state {
//                InvitePlayerSheet(
//                    apiClient: container.apiClient,
//                    gameId: game.id,
//                    players: viewModel.knownPlayers,   // host's followers + recent co-players
//                    excludedUserIds: Set(game.participants.map(\.user_id)),
//                    onInvited: { _ in
//                        Task { await viewModel.load() }
//                    }
//                )
//            }
//        }
//
// The button is intentionally a small reusable view defined HERE — Games
// can drop it into the toolbar without copying its styling. Keeping the
// styling in the Invitations folder means future tweaks (icon, copy)
// stay scoped to this agent.

/// Drop-in CTA that opens the InvitePlayerSheet. Designed to live in
/// GameDetailView's host-toolbar section. Compact + accent-coloured so
/// it sits next to "Share" without dominating the row.
struct InviteHostActionButton: View {
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 6) {
                Image(systemName: "person.crop.circle.badge.plus")
                Text("invitations.cta.invite_player")
            }
            .font(.system(.subheadline, design: .rounded, weight: .heavy))
            .foregroundStyle(DSColor.textOnAccent)
            .padding(.horizontal, DSSpacing.md)
            .padding(.vertical, 10)
            .background(Capsule().fill(DSColor.accent))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("invitations.cta.invite_player"))
    }
}

/// Convenience factory the Games agent should expose from its view model:
/// returns the candidate-player list that should be shown in the picker.
/// Documented here so the contract is in one place.
///
///     extension GameDetailViewModel {
///         /// Players surfaced in the InvitePlayerSheet — preferred order:
///         /// 1. Followers (close circle), 2. Recent co-players, 3. Nearby.
///         var knownPlayers: [PlayerSummary] { /* … */ }
///     }
///
/// If the Games agent prefers a fresh fetch instead of a cached list, it can
/// instantiate `PlayerPickerSheet` (Tournaments folder) directly — but for
/// the common "invite a friend" path the in-memory list keeps the sheet
/// snappy and avoids an extra network round-trip.
enum InvitationsHook {
    /// Stable identifier for the deep link Notifications module dispatches
    /// on tap of a `game_invite` notification. Routing layer maps this to
    /// `InvitationsView` in the inbox tab.
    static let deepLinkRouteKey = "invitations.inbox"
}
