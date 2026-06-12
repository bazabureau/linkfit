import Foundation
import Observation

/// View-model for the tournament detail screen. Holds the latest detail
/// payload plus a separate `actionState` that drives the Register/Withdraw
/// CTA so the page itself doesn't blink to a spinner when the user taps.
@Observable
@MainActor
final class TournamentDetailViewModel {
    private(set) var state: ViewState<TournamentDetail> = .idle
    private(set) var actionState: ActionState = .idle
    private(set) var lastError: String?

    enum ActionState: Equatable {
        case idle, running, success, failure(String)
    }

    private let apiClient: APIClient
    private let tournamentId: String
    private var loadTask: Task<Void, Never>?

    init(apiClient: APIClient, tournamentId: String) {
        self.apiClient = apiClient
        self.tournamentId = tournamentId
    }

    func load() async {
        loadTask?.cancel()
        let task: Task<Void, Never> = Task { [weak self] in
            await self?.performLoad()
            return
        }
        loadTask = task
        await task.value
    }

    private func performLoad() async {
        if case .loaded = state {
            // background refresh — keep the existing UI on screen
        } else {
            state = .loading
        }
        guard UUID(uuidString: tournamentId) != nil else {
            state = .error(message: String(localized: "api.error.not_found"))
            return
        }
        do {
            let detail = try await apiClient.send(.tournament(id: tournamentId))
            if Task.isCancelled { return }
            state = .loaded(detail)
        } catch is CancellationError { return }
        catch let error as APIError {
            if Task.isCancelled { return }
            state = .error(message: error.errorDescription
                           ?? String(localized: "tournaments.error.load"))
        } catch {
            if Task.isCancelled { return }
            state = .error(message: error.localizedDescription)
        }
    }

    /// Register a squad. On success refreshes the detail payload so
    /// `my_entry`, `can_register` and the entries list reflect the new state.
    func register(squadName: String, playerIds: [String]) async -> Bool {
        actionState = .running
        do {
            _ = try await apiClient.send(
                .registerTournamentSquad(tournamentId: tournamentId,
                                         squadName: squadName,
                                         playerIds: playerIds)
            )
            await load()
            actionState = .success
            return true
        } catch is CancellationError {
            actionState = .idle
            return false
        } catch let error as APIError {
            actionState = .failure(error.errorDescription
                                   ?? String(localized: "tournaments.error.register"))
            return false
        } catch {
            actionState = .failure(error.localizedDescription)
            return false
        }
    }

    /// Withdraw the viewer's own squad. No-ops if `my_entry` is missing.
    func withdraw() async {
        guard case .loaded(let detail) = state,
              let entry = detail.my_entry else { return }
        actionState = .running
        do {
            _ = try await apiClient.send(
                .withdrawTournamentSquad(tournamentId: tournamentId, entryId: entry.id)
            )
            await load()
            actionState = .success
        } catch is CancellationError {
            actionState = .idle
        } catch let error as APIError {
            actionState = .failure(error.errorDescription
                                   ?? String(localized: "tournaments.error.withdraw"))
        } catch {
            actionState = .failure(error.localizedDescription)
        }
    }

    func dismissAction() { actionState = .idle }
}
