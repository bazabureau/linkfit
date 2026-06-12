import Foundation
import Observation

/// Drives the "Active devices" screen — fetches the user's active
/// sessions, lets them revoke individual ones, and supports a single
/// "Sign out everywhere else" action.
///
/// All mutating actions are optimistic: rows disappear immediately and
/// the snapshot is restored if the server rejects the call. The current
/// device's session is never removable from this screen — that path
/// belongs to the Settings logout button.
@Observable
@MainActor
final class SessionsViewModel {
    private(set) var state: ViewState<[SessionInfo]> = .idle
    /// Set while the network call for "revoke all others" is in flight
    /// so the toolbar button can disable itself to prevent re-tap. We
    /// don't need a per-row flag — swipe-actions are inherently
    /// single-shot since the row vanishes on tap.
    private(set) var isRevokingAll: Bool = false

    private let apiClient: APIClient

    init(apiClient: APIClient) { self.apiClient = apiClient }

    /// Initial / pull-to-refresh load. Keeps the existing list visible
    /// while reloading so the screen doesn't flash an empty spinner on
    /// every refresh.
    func load() async {
        if case .loaded = state {} else { state = .loading }
        do {
            let res = try await apiClient.send(.sessions())
            state = res.items.isEmpty ? .empty : .loaded(res.items)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.errorDescription ?? String(localized: "sessions.error.load"))
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    /// Optimistically remove a session from the list, then issue the
    /// DELETE. On failure we restore the snapshot so the user doesn't
    /// silently lose a row that's still alive on the server.
    ///
    /// Refuses to act on the current-device session: the swipe is
    /// already disabled in the view, but the guard here is defense in
    /// depth so any future caller (e.g. a context-menu) can't
    /// accidentally bypass the rule.
    func revoke(_ session: SessionInfo) async {
        guard !session.is_current else { return }
        guard case .loaded(var items) = state else { return }
        let snapshot = items
        items.removeAll { $0.id == session.id }
        state = items.isEmpty ? .empty : .loaded(items)
        do {
            _ = try await apiClient.send(.revokeSession(id: session.id))
        } catch {
            // Roll back — server still considers the row valid.
            state = .loaded(snapshot)
        }
    }

    /// Optimistically drop every non-current row, then issue the bulk
    /// DELETE. On failure we restore the full snapshot.
    ///
    /// No-op when the list contains only the current device (the UI
    /// hides the toolbar button in that case, but we double-check
    /// here).
    func revokeAllOthers() async {
        guard case .loaded(let items) = state else { return }
        let snapshot = items
        let others = items.filter { !$0.is_current }
        guard !others.isEmpty else { return }
        let remaining = items.filter { $0.is_current }
        isRevokingAll = true
        state = remaining.isEmpty ? .empty : .loaded(remaining)
        defer { isRevokingAll = false }
        do {
            _ = try await apiClient.send(.revokeAllOtherSessions())
        } catch {
            state = .loaded(snapshot)
        }
    }
}
