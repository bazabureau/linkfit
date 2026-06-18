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
    /// Game ids the viewer participates in (hosted OR joined-as-player),
    /// sourced from `/me/agenda` so a joined game stays in "Mənim oyunlarım"
    /// even though the geo list summary carries no `is_participant` flag.
    private var participatingGameIds: Set<String> = []
    /// Joined games that fell outside the geo window (out of radius, already
    /// full, etc.) and therefore aren't in `allUpcoming`. Hydrated from
    /// `/games/{id}` so they still render in the viewer's own list.
    private var joinedGamesOutsideFeed: [GameSummary] = []
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
            // Merge in the viewer's participation set from /me/agenda so a
            // game they JOINED (not hosted) still shows under "their games".
            // Best-effort: a failed agenda fetch just leaves the hosted-only
            // list intact rather than blanking the whole hub.
            await loadParticipation()
            if Task.isCancelled { return }
            applyFilters()
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if case .loaded = state {} else {
                state = .error(message: userFacingLoadError(from: error))
            }
        } catch {
            if case .loaded = state {} else {
                state = .error(message: String(localized: "matches.error.load"))
            }
        }
    }

    private func userFacingLoadError(from error: APIError) -> String {
        let fallback = String(localized: "matches.error.load")
        guard let message = error.errorDescription?.trimmingCharacters(in: .whitespacesAndNewlines),
              !message.isEmpty else {
            return fallback
        }
        return message
    }

    /// Pull `/me/agenda` for a forward window and record which games the
    /// viewer participates in. Games already in the geo feed are matched by
    /// id; participated games that fell outside the feed (out of radius, full,
    /// past `open`) are hydrated from `/games/{id}` so they still render under
    /// the viewer's own list. Entirely best-effort — any failure leaves the
    /// hosted-only behaviour unchanged.
    private func loadParticipation() async {
        let cal = Calendar.current
        let today = Date()
        // 60-day forward window — covers the realistic "upcoming" horizon for
        // padel games without paging the agenda.
        let to = cal.date(byAdding: .day, value: 60, to: today) ?? today
        let fromYMD = Self.ymd(today)
        let toYMD = Self.ymd(to)

        let ids: Set<String>
        do {
            let agenda = try await apiClient.send(.myAgenda(from: fromYMD, to: toYMD))
            ids = Set(agenda.games.map(\.id))
        } catch {
            // Offline / auth dropped / server hiccup — keep whatever we had.
            // Don't clear: a transient agenda failure shouldn't make a joined
            // game vanish from a list that loaded fine a moment ago.
            return
        }
        if Task.isCancelled { return }
        participatingGameIds = ids

        // Hydrate any participated game that isn't already in the geo feed so
        // it can still appear in the viewer's list. Sequential + tolerant: a
        // single 404/410 (cancelled game) just skips that row.
        let feedIds = Set(allUpcoming.map(\.id))
        let missing = ids.subtracting(feedIds)
        guard !missing.isEmpty else {
            joinedGamesOutsideFeed = []
            return
        }
        var hydrated: [GameSummary] = []
        for id in missing {
            if Task.isCancelled { return }
            guard let detail = try? await apiClient.send(.game(id: id)) else { continue }
            // Skip games that are no longer relevant (cancelled / completed).
            guard detail.status != .cancelled else { continue }
            hydrated.append(Self.summary(from: detail))
        }
        if Task.isCancelled { return }
        joinedGamesOutsideFeed = hydrated
    }

    private func applyFilters() {
        let me = currentUserId
        let participating = participatingGameIds
        // The viewer's own games = games they HOST plus games they JOINED.
        // Hosted is the local signal (host_user_id == me); joined comes from
        // the /me/agenda participation set, since the geo list summary carries
        // no is_participant flag.
        var mine = allUpcoming.filter { game in
            (me != nil && game.host_user_id == me) || participating.contains(game.id)
        }
        // Plus any joined games that fell outside the geo feed entirely.
        mine.append(contentsOf: joinedGamesOutsideFeed)
        // Defensive de-dupe (a hydrated game could race back into the feed).
        var seen = Set<String>()
        mine = mine.filter { seen.insert($0.id).inserted }
        // Chronological — appended/hydrated rows arrive out of order.
        mine.sort {
            (Date.fromISO($0.starts_at) ?? .distantFuture)
                < (Date.fromISO($1.starts_at) ?? .distantFuture)
        }

        // Open games to join: open + not mine + not already joined. A game the
        // viewer already joined must never appear as "open to join".
        var open = allUpcoming.filter {
            $0.status == .open && $0.host_user_id != me && !participating.contains($0.id)
        }

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

    // MARK: - Helpers

    /// UTC `YYYY-MM-DD` for the agenda window bounds (matches the calendar
    /// view's convention so the backend receives the same date shape).
    private nonisolated static func ymd(_ date: Date) -> String {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let c = utc.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// Project a full `GameDetail` down to the `GameSummary` the hub renders.
    /// Every summary field exists on detail, so it's a straight field copy
    /// (Swift has no struct upcasting). Mirrors `HomeViewModel.prependCreated`.
    private nonisolated static func summary(from detail: GameDetail) -> GameSummary {
        GameSummary(
            id: detail.id,
            sport_id: detail.sport_id,
            sport_slug: detail.sport_slug,
            host_user_id: detail.host_user_id,
            host_display_name: detail.host_display_name,
            court_id: detail.court_id,
            venue_name: detail.venue_name,
            venue_photo_url: detail.venue_photo_url,
            lat: detail.lat,
            lng: detail.lng,
            starts_at: detail.starts_at,
            duration_minutes: detail.duration_minutes,
            capacity: detail.capacity,
            participants_count: detail.participants_count,
            status: detail.status,
            visibility: detail.visibility,
            skill_min_elo: detail.skill_min_elo,
            skill_max_elo: detail.skill_max_elo,
            distance_km: detail.distance_km
        )
    }
}

/// Loaded payload: open games to join + the viewer's upcoming games.
struct GamesHub: Equatable {
    let openGames: [GameSummary]
    let myGames: [GameSummary]
    var isEmpty: Bool { openGames.isEmpty && myGames.isEmpty }
}
