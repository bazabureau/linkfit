import Foundation
import Observation

/// Owns the invitations inbox state. Currently fetches the `pending` bucket
/// (the only one users actively act on) and exposes accept/decline mutations
/// with optimistic in-list removal so taps feel instant. Errors fall back to
/// a server-truth reload.
@Observable
@MainActor
final class InvitationsViewModel {
    private(set) var state: ViewState<[GameInvitation]> = .idle
    /// Surface a per-row "in flight" guard so we don't double-fire on rapid
    /// taps. Keyed by invitation id.
    private(set) var pendingRowIds: Set<String> = []
    /// Last user-visible action error (toast/banner). Cleared on next load.
    private(set) var actionError: String?

    private let apiClient: APIClient
    private var loadTask: Task<Void, Never>?

    init(apiClient: APIClient) { self.apiClient = apiClient }

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
        // Preserve prior data while refreshing — avoids the spinner flicker on
        // pull-to-refresh.
        if case .loaded = state {} else { state = .loading }
        actionError = nil
        do {
            let res = try await apiClient.send(.myInvitations(status: .pending))
            if Task.isCancelled { return }
            state = res.items.isEmpty ? .empty : .loaded(res.items)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if Task.isCancelled { return }
            state = .error(message: error.errorDescription
                           ?? String(localized: "invitations.error.load"))
        } catch {
            if Task.isCancelled { return }
            state = .error(message: error.localizedDescription)
        }
    }

    /// Accept — calls the server, then removes the row locally. If the server
    /// reports "game is full" or "game is not joinable" we surface a friendly
    /// message and reload so the row reflects the new status.
    func accept(_ inv: GameInvitation) async -> String? {
        guard !pendingRowIds.contains(inv.id) else { return nil }
        pendingRowIds.insert(inv.id)
        defer { pendingRowIds.remove(inv.id) }

        do {
            let result = try await apiClient.send(.acceptInvitation(id: inv.id))
            removeRow(id: inv.id)
            return result.game_id
        } catch let error as APIError {
            actionError = error.errorDescription
                          ?? String(localized: "invitations.error.accept")
            await load()
            return nil
        } catch {
            actionError = error.localizedDescription
            return nil
        }
    }

    func decline(_ inv: GameInvitation) async {
        guard !pendingRowIds.contains(inv.id) else { return }
        pendingRowIds.insert(inv.id)
        defer { pendingRowIds.remove(inv.id) }

        do {
            _ = try await apiClient.send(.declineInvitation(id: inv.id))
            removeRow(id: inv.id)
        } catch let error as APIError {
            actionError = error.errorDescription
                          ?? String(localized: "invitations.error.decline")
            await load()
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func removeRow(id: String) {
        guard case .loaded(var items) = state else { return }
        items.removeAll { $0.id == id }
        state = items.isEmpty ? .empty : .loaded(items)
    }
}
