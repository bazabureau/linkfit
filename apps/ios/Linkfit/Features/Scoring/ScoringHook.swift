// ScoringHook.swift
//
// Marker file describing HOW the Games tab should embed a "Track score"
// affordance that opens `LiveScoringView`, WITHOUT this file having to
// reach into `GameDetailView.swift` (owned by the Games agent).
//
// The Scoring agent ships:
//   • LiveScoringView           — the full-screen scoring surface
//   • LiveScoringViewModel      — observable state + polling + actions
//   • Networking endpoints      — under `Endpoint where Response == MatchScore`
//
// Suggested integration (the owning agent will apply this):
//
//   import SwiftUI
//
//   // Inside GameDetailView's loaded(_:) section, near the "Rate match"
//   // button, expose a "Track score" entry point. It's available while the
//   // game is in progress (status `open` or `full`) — once the match is
//   // recorded as completed, the same button reads "Final score" and opens
//   // the same view in spectator mode so anyone can audit the result.
//
//   var trackScoreLabel: LocalizedStringResource {
//       game.status == .completed
//           ? "scoring.entry.view_final"
//           : "scoring.entry.track"
//   }
//
//   Button {
//       Haptics.selection()
//       showScoring = true
//   } label: {
//       HStack(spacing: 8) {
//           Image(systemName: "scope")
//               .font(.system(size: 14, weight: .bold))
//           Text(trackScoreLabel)
//               .font(.system(size: 15, weight: .semibold))
//       }
//       .foregroundStyle(DSColor.textOnAccent)
//       .frame(maxWidth: .infinity)
//       .padding(.vertical, 14)
//       .background(Capsule().fill(DSColor.accent))
//   }
//   .fullScreenCover(isPresented: $showScoring) {
//       NavigationStack {
//           LiveScoringView(
//               viewModel: LiveScoringViewModel(
//                   apiClient: container.apiClient,
//                   gameId: game.id,
//                   hostUserId: game.host_user_id,
//                   currentUserId: container.currentUser?.id,
//                   participants: game.participants,
//               ),
//           )
//       }
//   }
//
// Why a hook file, not a direct edit to GameDetailView:
//
// 1. File ownership — `Features/Games/**` belongs to a different agent.
//    Embedding the button via a hook keeps the Scoring module's surface
//    surgical (its own folder + one Endpoint.swift append + one xcstrings
//    section) so concurrent agents don't ripple-conflict.
// 2. The Games tab can choose where to surface scoring — entry point,
//    overflow menu, or a "Live now" banner — without the Scoring module
//    having to anticipate every UX shape.
// 3. The post-match flow (rating auto-fill) lives in the Ratings agent,
//    which already reads `game.status == .completed`. Because
//    `LiveScoringViewModel.finalize()` flips the underlying game to
//    `completed` server-side, the rating flow can read the result via the
//    `GET /api/v1/games/:id/scoring` endpoint without any other plumbing.
//
// Rating auto-fill (Ratings agent integration):
//
//   When the user taps "Rate match" on a completed game, the Ratings flow
//   can pre-populate each co-player's outcome by fetching the score:
//
//     let score = try await apiClient.send(.scoring(gameId: gameId))
//     let myTeam: ScoreTeam? = {
//         if score.team_a_user_ids.contains(myId) { return .a }
//         if score.team_b_user_ids.contains(myId) { return .b }
//         return nil
//     }()
//     let myTeamWon = (score.winning_team == myTeam)
//     // Default each co-player's `outcome` based on `myTeamWon` vs their team.
//
// This is intentionally not implemented here — Ratings owns the form.
