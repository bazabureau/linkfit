import Foundation
import Observation
import SwiftUI

/// Drives `LiveScoringView`. Owns:
///   - the current `MatchScore` fetched from the server
///   - the 5-second polling loop (foreground only)
///   - +/- / undo / finalize action funnels
///
/// The view model is intentionally chatty: every point tap is a round-trip
/// to the server because the score is the ground-truth replicated across
/// every participant's device. Optimistic local updates would have to be
/// reconciled against a different participant's tap a moment later, and
/// the round-trip is well under 200ms on a typical LTE link — fast enough
/// that the haptic + flash animations cover any latency.
@Observable
@MainActor
final class LiveScoringViewModel {
    enum Mode: Equatable {
        /// Caller is on either team — can record points.
        case participant
        /// Caller is a confirmed participant but not on a team. Should not
        /// happen with the standard padel flow (every confirmed player is on
        /// a team) but treated as participant-capable for robustness.
        case spectatorConfirmed
        /// Anyone else — read-only.
        case spectator
    }

    private(set) var state: ViewState<MatchScore> = .idle
    /// Last set-completion event so the view can flash the winner banner.
    /// Reset to nil after the animation runs.
    private(set) var lastCompletedSetIndex: Int? = nil
    /// Set by the view after consuming the animation event.
    func acknowledgeSetFlash() { lastCompletedSetIndex = nil }
    /// Disables tap targets while a request is in flight so double-taps
    /// don't enqueue a phantom point on a flaky network.
    private(set) var isMutating: Bool = false

    let gameId: String
    let currentUserId: String?
    /// When the host hasn't started scoring yet, the view falls back to a
    /// start screen. The host's start payload is derived from `game.participants`
    /// (passed in) — first two confirmed players form team A by default.
    let participants: [Participant]
    let hostUserId: String

    private let apiClient: APIClient
    private var pollTask: Task<Void, Never>?
    private var setsBeforeLastUpdate: Int = 0

    init(apiClient: APIClient,
         gameId: String,
         hostUserId: String,
         currentUserId: String?,
         participants: [Participant]) {
        self.apiClient = apiClient
        self.gameId = gameId
        self.hostUserId = hostUserId
        self.currentUserId = currentUserId
        self.participants = participants
    }

    // TODO(wiring): Live Activity hooks.
    //
    // The Scoring agent owns this view model; the LiveActivity agent has
    // already shipped `MatchActivityAttributes`, `LiveActivityCoordinator`,
    // and the `LinkfitLiveActivity` widget extension. To project the
    // in-progress score onto the lock screen and Dynamic Island:
    //
    //   1. After `startScoring()` succeeds, call
    //      `LiveActivityCoordinator.shared.start(attributes:initialState:)`
    //      and stash the returned activity id on this view model.
    //   2. After each `recordPoint(_:)` / `undoLastPoint()` round-trip,
    //      project the latest `MatchScore` snapshot into
    //      `MatchActivityAttributes.ContentState` and call
    //      `LiveActivityCoordinator.shared.update(activityId:state:)`.
    //   3. After `finalize()` succeeds, call
    //      `LiveActivityCoordinator.shared.end(activityId:final:)` with
    //      `isCompleted: true`.
    //
    // The `servingTeam` field is optional — leave it nil for now if the
    // scoring backend doesn't surface serve rotation yet; the widget
    // simply omits the indicator in that case.
    //
    // See `Linkfit/Core/LiveActivity/LiveActivityHook.swift` for a full
    // wiring example. Avoid importing ActivityKit here directly — the
    // coordinator is the only seam between scoring and live activities.

    /// Caller's relationship to the match: drives which controls render.
    var mode: Mode {
        guard let me = currentUserId else { return .spectator }
        let confirmed = participants.contains { $0.user_id == me && $0.status == .confirmed }
        guard confirmed else { return .spectator }
        if case .loaded(let s) = state {
            let onTeam = s.team_a_user_ids.contains(me) || s.team_b_user_ids.contains(me)
            return onTeam ? .participant : .spectatorConfirmed
        }
        return .participant
    }

    /// True when the local user can record points / undo / finalize.
    var canWrite: Bool {
        switch mode {
        case .participant, .spectatorConfirmed: return true
        case .spectator: return false
        }
    }

    /// Only the host can call `/start`.
    var canStart: Bool {
        guard let me = currentUserId else { return false }
        return me == hostUserId
    }

    /// A confirmed player surfaced for the pre-start roster confirmation UI.
    /// Carries the display name so the host can eyeball who landed on each
    /// side before committing — the join-order split below is only a *guess*.
    struct RosterSlot: Identifiable, Equatable {
        let userId: String
        let displayName: String
        var id: String { userId }
    }

    /// Confirmed participants in join order — the pool the host assigns from.
    var confirmedRoster: [RosterSlot] {
        participants
            .filter { $0.status == .confirmed }
            .map { RosterSlot(userId: $0.user_id, displayName: $0.display_name) }
    }

    /// Default team split the host can confirm or override before starting.
    /// Mirrors the join-order halving `startScoring()` falls back to, so the
    /// confirmation UI shows exactly what would be sent if untouched. Padel is
    /// 2v2, so for the normal 4-player case this is `[0,1]` vs `[2,3]`.
    ///
    /// NOTE: join order is *not* reliable team intent — these are a starting
    /// suggestion. The host should be able to reassign before committing.
    var proposedTeams: (teamA: [RosterSlot], teamB: [RosterSlot]) {
        let roster = confirmedRoster
        let half = max(1, roster.count / 2)
        return (Array(roster.prefix(half)), Array(roster.dropFirst(half)))
    }

    /// Initial fetch + start polling. Idempotent — safe to call repeatedly.
    func appear() async {
        await reload()
        startPolling()
    }

    /// Stop the polling timer; called on disappear / scene background.
    func disappear() {
        pollTask?.cancel()
        pollTask = nil
    }

    /// One-shot read. Used by both the initial `task` and the poll loop.
    /// Failures are silent during polling — the view holds onto the last
    /// good snapshot and we'll try again on the next tick.
    func reload() async {
        if case .idle = state { state = .loading }
        do {
            let fresh = try await apiClient.send(.scoring(gameId: gameId))
            detectSetCompletion(previous: currentScore(), next: fresh)
            state = .loaded(fresh)
        } catch APIError.notFound {
            // Match scoring hasn't been started yet.
            state = .empty
        } catch is CancellationError {
            // Polling cancellation is expected — keep the last state.
        } catch {
            // Only surface as error if we have nothing to render.
            if case .loaded = state { return }
            state = .error(message: String(localized: "scoring.error.load"))
        }
    }

    /// Host-only — set up team rosters and seed the match_scores row.
    ///
    /// Pass `teamA` / `teamB` (user ids) to commit a roster the host has
    /// confirmed in the UI — this is the correct path. When they're left nil
    /// the call falls back to a join-order split (first half → team A, second
    /// half → team B). That fallback is only a *guess*: join order rarely
    /// matches who actually partnered up, so a confirmation step should pass
    /// explicit rosters (see `proposedTeams`) rather than rely on the split.
    func startScoring(teamA explicitTeamA: [String]? = nil,
                      teamB explicitTeamB: [String]? = nil) async {
        guard canStart else { return }
        isMutating = true
        defer { isMutating = false }
        let teamA: [String]
        let teamB: [String]
        if let explicitTeamA, let explicitTeamB {
            teamA = explicitTeamA
            teamB = explicitTeamB
        } else {
            let proposed = proposedTeams
            teamA = proposed.teamA.map { $0.userId }
            teamB = proposed.teamB.map { $0.userId }
        }
        guard !teamA.isEmpty && !teamB.isEmpty else {
            state = .error(message: String(localized: "scoring.error.teams_needed"))
            return
        }
        do {
            let fresh = try await apiClient.send(
                .startScoring(gameId: gameId,
                              teamAUserIds: teamA,
                              teamBUserIds: teamB),
            )
            state = .loaded(fresh)
            startPolling()
        } catch {
            state = .error(message: String(localized: "scoring.error.start"))
        }
    }

    /// Record a point for `team`. Triggers a light haptic on success and a
    /// heavy haptic when a set just ended (detected by comparing `sets.count`).
    func recordPoint(_ team: ScoreTeam) async {
        guard canWrite, !isMutating else { return }
        isMutating = true
        defer { isMutating = false }
        Haptics.soft()
        do {
            let fresh = try await apiClient.send(.scoringPoint(gameId: gameId, team: team))
            detectSetCompletion(previous: currentScore(), next: fresh)
            state = .loaded(fresh)
        } catch {
            // Refresh from the server so the UI matches reality on transient
            // failure (e.g. a 422 because the match just ended on someone
            // else's device).
            await reload()
        }
    }

    func undoLastPoint() async {
        guard canWrite, !isMutating else { return }
        isMutating = true
        defer { isMutating = false }
        Haptics.selection()
        do {
            let fresh = try await apiClient.send(.scoringUndo(gameId: gameId))
            state = .loaded(fresh)
        } catch {
            await reload()
        }
    }

    func finalize() async {
        guard canWrite, !isMutating else { return }
        isMutating = true
        defer { isMutating = false }
        Haptics.success()
        do {
            let fresh = try await apiClient.send(.scoringComplete(gameId: gameId))
            state = .loaded(fresh)
        } catch {
            await reload()
        }
    }

    // MARK: - Private

    private func currentScore() -> MatchScore? {
        if case .loaded(let s) = state { return s }
        return nil
    }

    /// Compares the new payload against the last known one and fires the
    /// "set completed" effect when the array grew. Emits a heavy haptic
    /// and records the index so the view can run its flash animation.
    private func detectSetCompletion(previous: MatchScore?, next: MatchScore) {
        let priorCount = previous?.sets.count ?? setsBeforeLastUpdate
        if next.sets.count > priorCount {
            lastCompletedSetIndex = next.sets.count - 1
            Haptics.heavy()
        }
        setsBeforeLastUpdate = next.sets.count
    }

    /// 5-second poll while the match is in progress and the view is visible.
    /// We stop the loop once the match completes — there's nothing left to
    /// update and the spectator/participant view stays put on the final score.
    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                if Task.isCancelled { return }
                guard let self else { return }
                if case .loaded(let s) = state, s.status == .completed { return }
                await self.reload()
            }
        }
    }
}
