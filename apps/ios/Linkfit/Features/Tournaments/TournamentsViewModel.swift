import Foundation
import Observation

/// Competitions-hub view-model. Loads all three server buckets (live /
/// upcoming / past) **concurrently** so the screen can present them as
/// sections in a single scroll, and picks one tournament for the featured
/// hero. Cancels in-flight loads so a fast refresh doesn't race a stale
/// response onto the screen.
@Observable
@MainActor
final class TournamentsViewModel {
    private(set) var state: ViewState<TournamentSections> = .idle

    private let apiClient: APIClient
    private var loadTask: Task<Void, Never>?

    init(apiClient: APIClient) { self.apiClient = apiClient }

    func load() async {
        loadTask?.cancel()
        let task: Task<Void, Never> = Task { [weak self] in await self?.performLoad() }
        loadTask = task
        await task.value
    }

    private func performLoad() async {
        if case .loaded = state { /* keep showing the previous list on refresh */ } else {
            state = .loading
        }
        do {
            async let live = fetch(.live)
            async let upcoming = fetch(.upcoming)
            async let past = fetch(.past)
            let sections = TournamentSections(
                allLive: try await live,
                allUpcoming: try await upcoming,
                past: try await past
            )
            if Task.isCancelled { return }
            state = sections.isEmpty ? .empty : .loaded(sections)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if Task.isCancelled { return }
            if case .loaded = state {} else {
                state = .error(message: error.errorDescription
                               ?? String(localized: "tournaments.error.load"))
            }
        } catch {
            if Task.isCancelled { return }
            if case .loaded = state {} else {
                state = .error(message: error.localizedDescription)
            }
        }
    }

    private func fetch(_ bucket: TournamentBucket) async throws -> [Tournament] {
        let items = try await apiClient.send(
            .tournaments(bucket: bucket, sport: "padel", limit: 50)
        ).items
        // Hide football scaffolding the same way the old list did.
        return items.filter { $0.sport_slug != "football_5" && $0.sport_slug != "football" }
    }
}

/// Loaded payload: the featured pick plus the de-duped section lists.
/// `featured` is removed from its source section so it never renders twice.
struct TournamentSections: Equatable {
    let featured: Tournament?
    let live: [Tournament]
    let registration: [Tournament]
    let past: [Tournament]

    init(allLive: [Tournament], allUpcoming: [Tournament], past: [Tournament]) {
        // Prefer a live tournament for the hero; otherwise the first one
        // that's open for registration; otherwise the soonest upcoming.
        let pick = allLive.first
            ?? allUpcoming.first(where: { $0.status == "registration_open" })
            ?? allUpcoming.first
        featured = pick
        live = allLive.filter { $0.id != pick?.id }
        registration = allUpcoming.filter { $0.id != pick?.id }
        self.past = past
    }

    var isEmpty: Bool {
        featured == nil && live.isEmpty && registration.isEmpty && past.isEmpty
    }
}
