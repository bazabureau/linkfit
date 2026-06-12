import Foundation
import Observation

/// State + load logic for the home daily-challenges card.
///
/// The card hits `GET /api/v1/me/challenges/today` on appear and on
/// pull-to-refresh. The server lazily issues the user's three challenges
/// on first call of the day and auto-completes any whose underlying
/// action landed (follow created, story posted, etc.) — so the view
/// model doesn't need to know which actions complete which codes; it
/// just renders whatever the server returns.
///
/// The view model is intentionally minimal:
///   - `.idle` → `.loading` → `.loaded(TodayChallengesResponse)` /
///     `.error(message:)`. No `.empty` case — the server always returns
///     exactly 3 items, even on a brand-new user.
///   - `refresh()` is the only mutator; the hook calls it from the
///     home card's `.task` AND from the home-level pull-to-refresh
///     fan-out.
///   - `markCompletedLocally(code:)` flips a row to completed
///     optimistically when the iOS tap handler kicks off a flow that
///     usually completes the challenge (e.g. tapping "follow_one"
///     opens the players tab, where any follow tap will land the
///     completion server-side). Re-reading from /today on the next
///     home refresh reconciles drift.
@Observable
@MainActor
final class DailyChallengesViewModel {
    private(set) var state: ViewState<TodayChallengesResponse> = .idle

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Load (or re-load) today's three challenges. Idempotent — the
    /// server returns the same set on every call within a calendar
    /// day, with possibly-updated `completed_at` stamps.
    func load() async {
        // Don't flicker to .loading when we already have data — drives
        // a smoother pull-to-refresh on the home card. Cold loads still
        // go through .loading because the first paint deserves a
        // placeholder.
        if case .loaded = state {
            // refresh-in-place; no flicker
        } else {
            state = .loading
        }
        do {
            let resp = try await apiClient.send(.challengesToday())
            state = .loaded(resp)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(
                message: error.errorDescription ?? String(localized: "common.error.generic")
            )
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    /// Fire-and-forget polling fallback against
    /// `POST /api/v1/me/challenges/:code/check`. The card calls this
    /// after the user returns from a relevant action surface (e.g.
    /// when the home tab regains focus after a follow tap landed) so
    /// the server reconciles completion without a full `/today`
    /// refetch. The reply is folded back into local state.
    func recheck(code: ChallengeCode) async {
        do {
            let resp = try await apiClient.send(.challengeCheck(code: code))
            if resp.completed {
                markCompletedLocally(code: code)
            }
        } catch {
            // Best-effort. The next `load()` will reconcile.
        }
    }

    /// Optimistic local flip — used when the tap handler routes the
    /// user into an action surface where they will likely complete
    /// the challenge. The server stamp lands separately; the next
    /// `load()` reconciles whichever happened first.
    func markCompletedLocally(code: ChallengeCode) {
        guard case let .loaded(payload) = state else { return }
        let nowIso = ISO8601DateFormatter().string(from: Date())
        let updated = payload.challenges.map { item -> ChallengeItem in
            guard item.code == code, item.completed_at == nil else { return item }
            return ChallengeItem(
                code: item.code,
                title: item.title,
                body: item.body,
                completed_at: nowIso,
                icon: item.icon
            )
        }
        state = .loaded(TodayChallengesResponse(date: payload.date, challenges: updated))
    }

    /// True when all three of today's challenges are completed — the
    /// host card hides itself in this state to retire the surface
    /// once the user has earned their daily bonus.
    var allCompleted: Bool {
        guard case let .loaded(payload) = state else { return false }
        return !payload.challenges.isEmpty
            && payload.challenges.allSatisfy { $0.isCompleted }
    }
}

// MARK: - Convenience initialisers

/// `ChallengeItem` has a synthesised memberwise init courtesy of
/// `Decodable`, but Swift only synthesises an init for top-level
// NOTE: We previously redeclared the memberwise init for `ChallengeItem`
// and `TodayChallengesResponse` here, but those types live in
// `Endpoint.swift` as internal structs with no custom init — so Swift
// already synthesises the memberwise we need. Redeclaring it caused
// `ambiguous use of 'init(code:title:body:completed_at:icon:)'` because
// callers couldn't pick between the synthesised and the explicit one.
// If `Endpoint.swift` ever gains a custom init (and thus loses its
// auto-synthesised memberwise), restore the extensions here.
