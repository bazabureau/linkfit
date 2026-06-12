import Foundation
import Observation

@Observable
@MainActor
final class GameDetailViewModel {
    private(set) var state: ViewState<GameDetail> = .idle
    var actionInFlight: Bool = false
    /// Transient error from a join/leave/cancel attempt. Stored
    /// separately from `state` so a failed action surfaces as a
    /// banner without wiping the loaded game detail off the screen.
    /// Previously every action error did `state = .error(...)`,
    /// which dropped the user back into a useless error screen and
    /// forced them to re-navigate. The view should consume + clear
    /// this after presenting.
    var actionError: String?
    /// Final scoring payload for completed (or in-progress) games — lets
    /// the detail surface a "Final result" banner without forcing the
    /// user to open the live scoring screen. Loaded lazily once the game
    /// resolves with status `completed`. Stays nil for games that never
    /// had scoring opened.
    private(set) var matchScore: MatchScore?
    let gameId: String
    let currentUserId: String?

    private let apiClient: APIClient

    init(apiClient: APIClient, gameId: String, currentUserId: String?) {
        self.apiClient = apiClient
        self.gameId = gameId
        self.currentUserId = currentUserId
    }

    func clearActionError() { actionError = nil }

    var isHost: Bool {
        guard case .loaded(let game) = state, let id = currentUserId else { return false }
        return game.host_user_id == id
    }

    var isParticipant: Bool {
        guard case .loaded(let game) = state, let id = currentUserId else { return false }
        return game.participants.contains { $0.user_id == id && $0.status == .confirmed }
    }

    /// True only when the game has started and the viewer can rate co-players.
    var canRate: Bool {
        guard case .loaded(let game) = state else { return false }
        guard let startsAt = Date.fromISO(game.starts_at) else { return false }
        return startsAt < Date() && isParticipant && game.status != .cancelled
    }

    /// True when the viewer can actually press Join. The backend treats
    /// any game whose `starts_at` is in the past as not-joinable (even
    /// while status is still "open" — there is no cron transitioning
    /// the status today). So if the UI offers the Join button on a
    /// stale game it hits a 422 and the user sees an opaque error.
    /// Gate the CTA here so the affordance is hidden BEFORE the tap.
    var isJoinable: Bool {
        guard case .loaded(let game) = state else { return false }
        guard game.status == .open else { return false }
        guard !isHost, !isParticipant else { return false }
        guard let startsAt = Date.fromISO(game.starts_at) else { return false }
        return startsAt > Date()
    }

    func load() async {
        // Preserve loaded UI on background refreshes (pull-to-refresh, optimistic returns).
        if case .loaded = state {} else { state = .loading }
        guard UUID(uuidString: gameId) != nil else {
            state = .error(message: String(localized: "api.error.not_found"))
            return
        }
        do {
            let detail = try await apiClient.send(.game(id: gameId))
            state = .loaded(detail)
            // Fetch the final score in the background when the match has
            // wrapped. Failure is silent — the result banner just won't
            // render if scoring was never opened (404) or the request
            // hiccups. The detail screen still loads either way.
            if detail.status == .completed || detail.status == .full {
                await loadScore()
            } else {
                matchScore = nil
            }
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.errorDescription ?? String(localized: "game.error.load"))
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    /// Best-effort fetch of the final match score. Called from `load` and
    /// can also be invoked after the LiveScoring sheet dismisses to pick
    /// up a fresh result without reloading the entire game detail.
    func loadScore() async {
        do {
            let score = try await apiClient.send(.scoring(gameId: gameId))
            matchScore = score
        } catch {
            // 404 / network error → leave the banner hidden. No UI noise.
            matchScore = nil
        }
    }

    /// Convenience accessor — returns the team the current user is on
    /// according to the loaded `matchScore`, or nil if they aren't in a
    /// roster (or no score is loaded yet).
    var myTeam: ScoreTeam? {
        guard let me = currentUserId, let s = matchScore else { return nil }
        if s.team_a_user_ids.contains(me) { return .a }
        if s.team_b_user_ids.contains(me) { return .b }
        return nil
    }

    func join() async {
        actionInFlight = true
        defer { actionInFlight = false }
        do {
            let detail = try await apiClient.send(.joinGame(id: gameId))
            state = .loaded(detail)
            // Analytics — first-join activation event. The helper checks
            // a UserDefaults flag so subsequent joins by the same device
            // do not re-emit; only the FIRST successful join across the
            // device's lifetime fires the event. See
            // `Core/Analytics/AnalyticsEvent.swift` for the gating rule.
            AnalyticsEvent.markFirstGameJoinIfNeeded(gameId: gameId) { event in
                Analytics.track(event)
            }
        } catch is CancellationError {
            return
        } catch let error as APIError {
            actionError = error.errorDescription ?? String(localized: "game.error.join")
        } catch {
            actionError = error.localizedDescription
        }
    }

    func leave() async {
        actionInFlight = true
        defer { actionInFlight = false }
        do {
            let detail = try await apiClient.send(.leaveGame(id: gameId))
            state = .loaded(detail)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            actionError = error.errorDescription ?? String(localized: "game.error.leave")
        } catch {
            actionError = error.localizedDescription
        }
    }

    func cancel() async {
        actionInFlight = true
        defer { actionInFlight = false }
        do {
            let detail = try await apiClient.send(.cancelGame(id: gameId))
            state = .loaded(detail)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            actionError = error.errorDescription ?? String(localized: "game.error.cancel")
        } catch {
            actionError = error.localizedDescription
        }
    }

    /// Wave-11 cancel-with-reason. Host taps the overflow menu item
    /// "Ləğv et", optionally types a reason, then confirms. The reason
    /// flows into the backend's push notification body so confirmed
    /// participants see WHY the game died without chasing the host on
    /// chat. Returns true on success so the caller can present a toast
    /// + dismiss the dialog; false leaves `actionError` populated.
    ///
    /// Distinct from `cancel()` above — that path still uses the legacy
    /// PATCH `{cancel:true}` and is wired into the in-screen secondary
    /// button. The two coexist intentionally so we can stage the new
    /// flow behind the host menu without breaking the existing button.
    @discardableResult
    func cancelWithReason(_ reason: String?) async -> Bool {
        actionInFlight = true
        defer { actionInFlight = false }
        do {
            _ = try await apiClient.send(
                .cancelGameWithReason(id: gameId, reason: reason)
            )
            // 204 No Content — refetch the detail so the screen flips to
            // the `.cancelled` status pill + hides the host action bar.
            // We don't redirect the host away (predecessor flows pop back
            // to the list, but the user can still want to see the
            // cancellation banner before navigating).
            await load()
            return true
        } catch is CancellationError {
            return false
        } catch let error as APIError {
            actionError = error.errorDescription ?? String(localized: "game.error.cancel")
            return false
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }

    /// Wave-11 reschedule. Host picks a new `starts_at` (and optionally
    /// adjusts duration); the backend validates the time is in the
    /// future and fans push notifications out to every confirmed
    /// participant. Returns the refreshed `GameDetail` on success so
    /// the sheet can dismiss + the screen re-paints without a separate
    /// load. False / nil from the optional return signals an error;
    /// the message is in `actionError`.
    @discardableResult
    func reschedule(startsAt: Date, durationMinutes: Int?) async -> Bool {
        actionInFlight = true
        defer { actionInFlight = false }
        do {
            let detail = try await apiClient.send(
                .rescheduleGame(
                    id: gameId,
                    startsAt: startsAt.toISO(),
                    durationMinutes: durationMinutes
                )
            )
            state = .loaded(detail)
            return true
        } catch is CancellationError {
            return false
        } catch let error as APIError {
            actionError = error.errorDescription ?? String(localized: "game.error.reschedule")
            return false
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }

    /// Host-only — flag a participant who didn't show up. Mirrors
    /// `cancel()` in shape: sets `actionInFlight`, replaces the loaded
    /// game on success (so the UI re-renders with the participant's
    /// `.no_show` status), and surfaces failures via `actionError`
    /// without dropping the user out of the loaded detail view.
    func markNoShow(userId: String) async {
        actionInFlight = true
        defer { actionInFlight = false }
        do {
            let detail = try await apiClient.send(.markNoShow(gameId: gameId, userId: userId))
            state = .loaded(detail)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            actionError = error.errorDescription ?? String(localized: "game.error.no_show")
        } catch {
            actionError = error.localizedDescription
        }
    }
}
