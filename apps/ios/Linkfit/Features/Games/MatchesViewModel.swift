import Foundation
import Observation
import CoreLocation

/// Drives the Games hub ("Oyunlar"). Loads upcoming padel games around the
/// viewer's home (or Baku centre) in one fetch and splits them into two
/// streams: **open games to join** (status `open`, not hosted by the viewer)
/// and **the viewer's own upcoming games** (hosted). A quick date filter
/// (today / tomorrow / nearby) reshapes the open list client-side so taps are
/// instant.
@Observable
@MainActor
final class MatchesViewModel {
    /// Quick "when" filter for the open-games list.
    enum DateFilter: String, CaseIterable, Identifiable, Hashable {
        case all, today, tomorrow, nearby
        var id: String { rawValue }
    }

    private(set) var state: ViewState<GamesHub> = .idle
    var dateFilter: DateFilter = .all
    /// Optional override (tests / previews); otherwise the viewer's home or
    /// Baku centre is used for the geo query + distance sort.
    var viewerHome: CLLocationCoordinate2D?

    private let apiClient: APIClient
    private let currentUserId: String?
    private var loadTask: Task<Void, Never>?
    private var allUpcoming: [GameSummary] = []
    private let bakuCentre = CLLocationCoordinate2D(latitude: 40.4093, longitude: 49.8671)

    init(apiClient: APIClient, currentUserId: String?) {
        self.apiClient = apiClient
        self.currentUserId = currentUserId
    }

    func onAppear() async {
        if case .loaded = state { return }
        await load()
    }

    func setDateFilter(_ value: DateFilter) {
        guard dateFilter != value else { return }
        dateFilter = value
        applyFilters()
    }

    /// Optimistic join — sends the request and reloads on success; re-raises
    /// so the caller can surface a toast.
    func join(_ game: GameSummary) async throws {
        _ = try await apiClient.send(Endpoint<GameDetail>.joinGame(id: game.id))
        await load()
    }

    func load() async {
        loadTask?.cancel()
        if case .loaded = state {} else { state = .loading }
        let task: Task<Void, Never> = Task { [weak self] in await self?.performLoad() }
        loadTask = task
        await task.value
    }

    private func performLoad() async {
        let centre = viewerHome ?? bakuCentre
        let from = ISO8601DateFormatter().string(from: Date())
        do {
            let response = try await apiClient.send(
                Endpoint<PagedItemsResponse<GameSummary>>.games(
                    lat: centre.latitude, lng: centre.longitude,
                    sport: "padel", from: from, limit: 50
                )
            )
            if Task.isCancelled { return }
            allUpcoming = response.items.filter {
                $0.sport_slug != "football_5" && $0.sport_slug != "football"
            }
            applyFilters()
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if case .loaded = state {} else {
                state = .error(message: error.errorDescription
                               ?? String(localized: "matches.error.load"))
            }
        } catch {
            if case .loaded = state {} else {
                state = .error(message: error.localizedDescription)
            }
        }
    }

    private func applyFilters() {
        let me = currentUserId
        // My upcoming hosted games (the reliable "mine" signal — the list
        // summary carries no is_participant flag yet, so joined-as-player
        // games are sourced from /me/agenda in a later pass).
        let mine = allUpcoming.filter { me != nil && $0.host_user_id == me }

        // Open games to join: open + not mine.
        var open = allUpcoming.filter { $0.status == .open && $0.host_user_id != me }

        let cal = Calendar.current
        switch dateFilter {
        case .all:
            break
        case .today:
            open = open.filter { Date.fromISO($0.starts_at).map(cal.isDateInToday) ?? false }
        case .tomorrow:
            open = open.filter { Date.fromISO($0.starts_at).map(cal.isDateInTomorrow) ?? false }
        case .nearby:
            open.sort { ($0.distance_km ?? .greatestFiniteMagnitude) < ($1.distance_km ?? .greatestFiniteMagnitude) }
        }

        let hub = GamesHub(openGames: open, myGames: mine)
        state = hub.isEmpty ? .empty : .loaded(hub)
    }
}

/// Loaded payload: open games to join + the viewer's upcoming games.
struct GamesHub: Equatable {
    let openGames: [GameSummary]
    let myGames: [GameSummary]
    var isEmpty: Bool { openGames.isEmpty && myGames.isEmpty }
}
