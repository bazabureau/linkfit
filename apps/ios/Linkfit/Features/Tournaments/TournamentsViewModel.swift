import Foundation
import Observation

/// List-screen view-model. Owns the segmented bucket filter and reloads
/// whenever the user flips it. Cancels in-flight loads so a fast tap-tap-tap
/// doesn't race a stale response onto the screen.
@Observable
@MainActor
final class TournamentsViewModel {
    private(set) var state: ViewState<[Tournament]> = .idle
    var bucket: TournamentBucket = .upcoming

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

    func setBucket(_ b: TournamentBucket) {
        guard b != bucket else { return }
        bucket = b
        Task { await load() }
    }

    private func performLoad() async {
        if case .loaded = state { /* preserve previous list */ } else {
            state = .loading
        }
        do {
            let items = try await apiClient.send(
                .tournaments(bucket: bucket, sport: "padel", limit: 50)
            ).items
            if Task.isCancelled { return }
            let visible = items.filter { $0.sport_slug != "football_5" && $0.sport_slug != "football" }
            state = visible.isEmpty ? .empty : .loaded(visible)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if Task.isCancelled { return }
            state = .error(message: error.errorDescription
                           ?? String(localized: "tournaments.error.load"))
        } catch {
            if Task.isCancelled { return }
            state = .error(message: error.localizedDescription)
        }
    }
}
