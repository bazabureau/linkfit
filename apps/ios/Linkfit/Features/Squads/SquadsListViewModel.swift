import Foundation
import Observation

/// Drives `SquadsListView`. Owns the user's set of squads (any squad the
/// caller belongs to, owner or member) and the load/refresh cycle.
///
/// State model uses the canonical `ViewState<[Squad]>` so the empty case
/// is first-class — the empty experience for Squads is the most important
/// part of the screen (the explicit "create your first padel group" CTA).
@Observable
@MainActor
final class SquadsListViewModel {
    private(set) var state: ViewState<[Squad]> = .idle

    /// The viewer's id. Cached so list rows can render the "owner" marker
    /// without re-reading from the container every render. Comes from
    /// `AppContainer.currentUser?.id` at construction time — if the user
    /// somehow isn't authenticated the list endpoint will 401 and we'll
    /// surface an error state.
    let currentUserId: String

    private let apiClient: APIClient
    /// Single in-flight task. Guards against double-fires from rapid
    /// pull-to-refresh + `.task` re-entry on view re-mount.
    private var inFlight: Task<Void, Never>?

    init(apiClient: APIClient, currentUserId: String) {
        self.apiClient = apiClient
        self.currentUserId = currentUserId
    }

    func onAppear() async {
        // Don't refetch when navigating back to a screen that already has
        // data — refresh-on-pull is the way to force-reload, and the
        // detail screen will independently refresh its parent on
        // delete / leave via the `onMutated` callback.
        if case .loaded = state { return }
        await load()
    }

    /// Hard reload. Cancels any in-flight fetch first so the view can't
    /// briefly flash older data after a refresh.
    func load() async {
        inFlight?.cancel()
        if case .loaded = state {} else { state = .loading }
        // Explicit `Task<Void, Never>` so the inferred return type isn't
        // `Task<()?, Never>` — `self?.performFetch()` flows the `()?`
        // through the closure body even though we don't bind it. The
        // explicit annotation discards the optional and matches the
        // stored property's type.
        let task: Task<Void, Never> = Task { [weak self] in
            await self?.performFetch()
        }
        inFlight = task
        defer { inFlight = nil }
        await task.value
    }

    /// Stitch a freshly-created squad into the in-memory list. Called
    /// from `CreateSquadView`'s success callback so the user sees the new
    /// row before the network round-trip finishes.
    func upsert(_ squad: Squad) {
        var current = (try? loadedItems()) ?? []
        if let idx = current.firstIndex(where: { $0.id == squad.id }) {
            current[idx] = squad
        } else {
            current.insert(squad, at: 0)
        }
        state = current.isEmpty ? .empty : .loaded(current)
    }

    /// Drop a squad locally — used after delete / leave so the user sees
    /// the row vanish without waiting for a server round-trip.
    func remove(squadId: String) {
        guard var current = try? loadedItems() else { return }
        current.removeAll { $0.id == squadId }
        state = current.isEmpty ? .empty : .loaded(current)
    }

    // MARK: - Private

    /// Extract the current loaded items, or throw if state isn't loaded.
    /// Tiny utility so `upsert` / `remove` stay readable. Throws so the
    /// caller can decide whether to short-circuit (we always do).
    private func loadedItems() throws -> [Squad] {
        if case .loaded(let items) = state { return items }
        throw NSError(domain: "SquadsList", code: -1)
    }

    private func performFetch() async {
        do {
            let response = try await apiClient.send(Endpoint<SquadsListResponse>.mySquads())
            if Task.isCancelled { return }
            state = response.squads.isEmpty ? .empty : .loaded(response.squads)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if Task.isCancelled { return }
            state = .error(message: error.localizedMessage)
        } catch {
            if Task.isCancelled { return }
            state = .error(message: error.localizedDescription)
        }
    }
}
