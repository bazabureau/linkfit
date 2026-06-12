import Foundation
import Observation

/// Drives the "Blocked users" screen — fetches the caller's block list
/// from `GET /api/v1/me/blocks` and lets the user unblock individual
/// rows from the list. Modeled on `SessionsViewModel` (same load /
/// optimistic-mutate / rollback shape).
///
/// All unblocks are optimistic: the row disappears immediately and the
/// snapshot is restored if the server rejects the call. We keep a small
/// per-row "in flight" set so the view can disable the Unblock button
/// while a request is outstanding and avoid double-taps racing.
///
/// FAZA 61.5 / Wave-10: moved to `Features/Settings/` so the
/// trust-&-safety surface lives alongside its entry point in
/// `SettingsView`. The `Endpoint+Blocks.swift` module is shared.
@Observable
@MainActor
final class BlockedUsersViewModel {
    private(set) var state: ViewState<[BlockedUser]> = .idle
    /// User IDs whose unblock request is currently in flight. The view
    /// reads this to disable the row's "Unblock" button so a fast
    /// double-tap can't fire two DELETEs against the same relationship.
    private(set) var inFlight: Set<String> = []

    private let apiClient: APIClient

    init(apiClient: APIClient) { self.apiClient = apiClient }

    /// Initial / pull-to-refresh load. Keeps the existing list visible
    /// while reloading so the screen doesn't flash an empty spinner on
    /// every pull-down.
    func load() async {
        if case .loaded = state {} else { state = .loading }
        do {
            let res = try await apiClient.send(.blockedUsers())
            state = res.items.isEmpty ? .empty : .loaded(res.items)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.errorDescription ?? String(localized: "common.error.generic"))
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    /// Optimistically remove the row, then issue DELETE
    /// `/users/{id}/block`. On failure we restore the snapshot so the
    /// user doesn't silently lose a row that's still active on the
    /// server. The `inFlight` guard prevents racing double-taps.
    func unblock(_ user: BlockedUser) async {
        guard !inFlight.contains(user.id) else { return }
        guard case .loaded(var items) = state else { return }
        let snapshot = items
        items.removeAll { $0.id == user.id }
        inFlight.insert(user.id)
        state = items.isEmpty ? .empty : .loaded(items)
        defer { inFlight.remove(user.id) }
        do {
            _ = try await apiClient.send(.unblockUser(id: user.id))
        } catch is CancellationError {
            // View was torn down mid-request; the row stays removed
            // locally and the next load() will reconcile with the server.
            return
        } catch {
            // Server still considers the user blocked — restore the row.
            state = .loaded(snapshot)
        }
    }
}
