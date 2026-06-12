// LiveActivityHook.swift
//
// LiveActivity agent — integration contract for the Scoring agent.
//
// The LiveActivity agent OWNS:
//   • MatchActivityAttributes (the schema)
//   • LiveActivityCoordinator (start / update / end)
//   • The widget extension (`LinkfitLiveActivity/*`) that renders the
//     lock-screen banner, Dynamic Island compact / minimal / expanded
//     leaves, and the minimal score chip.
//
// The Scoring agent OWNS the score itself — backend calls, point
// transitions, set / tiebreak logic, etc. To project that score onto
// the Dynamic Island, the Scoring agent's view models should plug in
// with the three calls below. The LiveActivity agent does NOT call
// the backend, and the Scoring agent does NOT import ActivityKit.
//
// ---------------------------------------------------------------
// Wiring example (lives in the Scoring agent's view model)
// ---------------------------------------------------------------
//
//   import Foundation                             // no ActivityKit needed
//
//   @MainActor
//   final class ScoringViewModel: ObservableObject {
//
//       private var activityId: String?
//
//       /// Call when the user taps "Start match" in the scoring UI.
//       func startTracking(game: GameDetail) async {
//           let attrs = MatchActivityAttributes(
//               gameId: game.id,
//               teamA: game.teamA.displayName,
//               teamB: game.teamB.displayName
//           )
//           let state = MatchActivityAttributes.ContentState(
//               currentSetIndex: 0,
//               startedAt: .now
//           )
//           let activity = await LiveActivityCoordinator.shared
//               .start(attributes: attrs, initialState: state)
//           self.activityId = activity?.id
//       }
//
//       /// Call after every point / game / set transition the
//       /// Scoring agent computes locally.
//       func didUpdateScore(_ score: LiveScoreSnapshot) async {
//           guard let id = activityId else { return }
//           let state = MatchActivityAttributes.ContentState(
//               setsA: score.setsA,
//               setsB: score.setsB,
//               currentGameA: score.gamesA,
//               currentGameB: score.gamesB,
//               pointA: score.pointA,
//               pointB: score.pointB,
//               currentSetIndex: score.currentSetIndex,
//               isCompleted: false,
//               startedAt: score.startedAt
//           )
//           await LiveActivityCoordinator.shared
//               .update(activityId: id, state: state)
//       }
//
//       /// Call once the final point lands.
//       func didCompleteMatch(_ score: LiveScoreSnapshot) async {
//           guard let id = activityId else { return }
//           let state = MatchActivityAttributes.ContentState(
//               setsA: score.setsA,
//               setsB: score.setsB,
//               currentGameA: score.gamesA,
//               currentGameB: score.gamesB,
//               pointA: score.pointA,
//               pointB: score.pointB,
//               currentSetIndex: score.currentSetIndex,
//               isCompleted: true,
//               startedAt: score.startedAt
//           )
//           await LiveActivityCoordinator.shared
//               .end(activityId: id, final: state)
//           self.activityId = nil
//       }
//   }
//
// ---------------------------------------------------------------
// Convention: only the Scoring agent decides WHEN to update — the
// LiveActivity agent never polls. If the Scoring agent crashes
// without ending the activity, `LiveActivityCoordinator.endAll()`
// is safe to call from the app delegate on next launch.
// ---------------------------------------------------------------

import Foundation

/// Marker enum — this file is intentionally documentation-only.
enum LiveActivityHook {}
