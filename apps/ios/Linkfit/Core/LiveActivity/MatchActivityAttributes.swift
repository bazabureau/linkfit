// MatchActivityAttributes.swift
//
// LiveActivity agent — shared attribute schema.
//
// This type is the contract between the main `Linkfit` app target and
// the `LinkfitLiveActivity` widget extension. Both targets compile this
// file (see `project.yml` — the source path is listed in both targets),
// which is the canonical Apple-recommended way to share an
// `ActivityAttributes` definition without an intermediate framework.
//
// The schema models a live tennis-style match:
//   • static side  — identifies the match: gameId + display team names.
//   • ContentState — mutates over the life of the activity: current
//                    sets / games / points and a completion flag.
//
// Updates flow in from the Scoring agent's view models via
// `LiveActivityCoordinator.update(activityId:state:)` — see
// `LiveActivityHook.swift` for the wiring contract.

import ActivityKit
import Foundation

/// Live Activity payload for an in-progress Linkfit match.
public struct MatchActivityAttributes: ActivityAttributes {
    public typealias MatchScoreState = ContentState

    // MARK: - Static (set once when the activity is requested)

    /// Stable identifier of the underlying game / match. Used for deep
    /// links from the lock-screen banner back into the app.
    public let gameId: String

    /// Display name for team A (e.g. "Aysu & Murad").
    public let teamA: String

    /// Display name for team B.
    public let teamB: String

    public init(gameId: String, teamA: String, teamB: String) {
        self.gameId = gameId
        self.teamA = teamA
        self.teamB = teamB
    }

    // MARK: - Dynamic state

    /// Mutable score snapshot pushed by the Scoring module.
    ///
    /// Tennis-style nomenclature is used throughout the app:
    ///   • `setsA` / `setsB`         — number of completed sets won.
    ///   • `currentGameA` / `B`      — games won inside the current set.
    ///   • `pointA` / `pointB`       — points inside the current game.
    ///                                 Use 0 / 15 / 30 / 40 / "AD" at
    ///                                 the render layer; the model
    ///                                 just stores an integer ladder
    ///                                 (0, 1, 2, 3, 4 = advantage).
    ///   • `currentSetIndex`         — zero-based index of the set in
    ///                                 progress; used for the
    ///                                 "Set N" label on the expanded
    ///                                 banner.
    ///   • `isCompleted`             — once true, the lock-screen
    ///                                 banner switches to a "Final"
    ///                                 layout; the coordinator should
    ///                                 follow up with `end(...)`.
    public struct ContentState: Codable, Hashable, Sendable {
        public var setsA: Int
        public var setsB: Int
        public var currentGameA: Int
        public var currentGameB: Int
        public var pointA: Int
        public var pointB: Int
        public var currentSetIndex: Int
        public var isCompleted: Bool

        /// Which team is currently serving.
        ///
        /// `.a` / `.b` — surfaced as a small dot beside the serving team's
        /// score on the lock-screen banner and inside the Dynamic Island
        /// expanded leaf. `nil` means "unknown" (e.g. between games before
        /// the Scoring agent has a chance to push the next state); the
        /// render layer simply omits the indicator in that case.
        ///
        /// Encoded as an integer (0 = A, 1 = B, absent = nil) on the wire
        /// to keep the JSON shape stable if ContentState ever has to round
        /// through a push payload.
        public var servingTeam: ServingTeam?

        public enum ServingTeam: Int, Codable, Hashable, Sendable {
            case a = 0
            case b = 1
        }

        /// Wall-clock the match started. Used by the expanded view to
        /// render an `.timer`-style elapsed counter that ticks without
        /// any further activity updates.
        public var startedAt: Date

        public init(
            setsA: Int = 0,
            setsB: Int = 0,
            currentGameA: Int = 0,
            currentGameB: Int = 0,
            pointA: Int = 0,
            pointB: Int = 0,
            currentSetIndex: Int = 0,
            isCompleted: Bool = false,
            servingTeam: ServingTeam? = nil,
            startedAt: Date = Date()
        ) {
            self.setsA = setsA
            self.setsB = setsB
            self.currentGameA = currentGameA
            self.currentGameB = currentGameB
            self.pointA = pointA
            self.pointB = pointB
            self.currentSetIndex = currentSetIndex
            self.isCompleted = isCompleted
            self.servingTeam = servingTeam
            self.startedAt = startedAt
        }

        /// Tennis-ladder rendering for the per-point label.
        /// Index 4+ renders as "AD" (advantage).
        public static func pointLabel(_ raw: Int) -> String {
            switch raw {
            case 0: return "0"
            case 1: return "15"
            case 2: return "30"
            case 3: return "40"
            default: return "AD"
            }
        }
    }
}
