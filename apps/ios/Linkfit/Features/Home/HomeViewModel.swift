import Foundation
import Observation
import CoreLocation

@Observable
@MainActor
final class HomeViewModel: NSObject, CLLocationManagerDelegate {
    private(set) var state: ViewState<[GameSummary]> = .idle
    private(set) var sports: [Sport] = []
    var selectedSportSlug: String?
    var center: CLLocationCoordinate2D = .init(latitude: 40.4093, longitude: 49.8671) // Baku default

    private let apiClient: APIClient
    private let locationManager = CLLocationManager()

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func onAppear() async {
        if sports.isEmpty {
            do {
                let res = try await apiClient.send(.sports)
                sports = res.items.filter { $0.slug != "football_5" && $0.slug != "football" }
            } catch {
                // Sports failing is non-fatal — fallback to "all".
            }
        }
        await load()
        requestLocationIfNeeded()
    }

    func setSport(_ slug: String?) async {
        selectedSportSlug = slug
        await load()
    }

    func load() async {
        // Only show the skeleton on cold loads — refresh + sport-switch keep
        // the current data visible until the new data lands.
        let isCold = { if case .loaded = state { return false } else { return true } }()
        // Offline-graceful — on a cold load, hydrate from the on-disk
        // response cache before showing the skeleton. The network call
        // still fires below and overwrites with fresh data when it
        // returns; if it fails offline we keep the cached list visible
        // + a toast (see catch arm).
        if isCold, let hit = await ResponseCache.shared.load([GameSummary].self, forKey: ResponseCache.Key.homeGames) {
            cachedAt = hit.cachedAt
            state = hit.value.isEmpty ? .empty : .loaded(hit.value)
        } else if isCold {
            state = .loading
        }
        do {
            let res = try await apiClient.send(
                // Radius bumped from 25 → 50 km. Linkfit users in
                // Sumqayit / Sumqayıt Bay / Absheron suburbs often land
                // outside a 25km circle from Baku centre; the wider
                // default still feels "nearby" to a padel player who
                // routinely drives 30+min for a court. Backend also
                // OR-ins viewer's own games regardless of distance
                // (FAZA 75) so a game you hosted is never hidden.
                .games(lat: center.latitude, lng: center.longitude,
                       radiusKm: 50, sport: selectedSportSlug,
                       from: ISO8601DateFormatter().string(from: Date()),
                       limit: 30)
            )
            if Task.isCancelled { return }
            let games = res.items.filter { $0.sport_slug != "football_5" && $0.sport_slug != "football" }
            state = games.isEmpty ? .empty : .loaded(games)
            // Successful fetch — refresh the offline cache + clear the
            // stale "last updated" caption.
            await ResponseCache.shared.save(games, forKey: ResponseCache.Key.homeGames)
            cachedAt = nil
            // Widget agent — push the nearest upcoming match to the App Group
            // so `NextMatchWidget` can render without a network call. Cheap;
            // runs on every successful load to keep the snapshot fresh.
            saveWidgetSnapshot(from: games)
        } catch is CancellationError {
            // SwiftUI cancelled the in-flight task — on cold load fall back
            // to idle so the next .task / refresh can retry cleanly; on warm
            // loads keep showing the previous data.
            if isCold, case .loaded = state {} else if isCold { state = .idle }
        } catch let error as APIError {
            if Task.isCancelled { return }
            // Offline + we already painted a cached list — keep the
            // cached data on screen and nudge the user with a toast
            // instead of replacing real rows with an error screen.
            if error == .offline, case .loaded = state {
                ToastCenter.shared.error(String(localized: "error.network_offline"))
                return
            }
            state = .error(message: error.localizedMessage)
        } catch {
            if Task.isCancelled { return }
            state = .error(message: error.localizedDescription)
        }
    }

    /// When non-nil, the home list is being painted from the on-disk
    /// cache and the view should render a "Last updated …" caption.
    /// Cleared the moment a fresh network response lands.
    private(set) var cachedAt: Date?

    /// Prepend a freshly created game to the loaded list. Called from the
    /// CreateGame success callback so the user sees their new game on home
    /// instantly — without waiting for the network reload to round-trip.
    /// The subsequent `load()` overwrites with the canonical server set,
    /// and the dedupe-by-id check below keeps it idempotent if load()
    /// races and lands first.
    ///
    /// The callback hands us a `GameDetail`, but the home list works in
    /// `GameSummary`. Every `GameSummary` field exists on `GameDetail` so
    /// the conversion is a straight value-by-value copy — Swift doesn't
    /// give us automatic upcasting for structs, so we spell it out.
    func prependCreated(_ detail: GameDetail) {
        let summary = GameSummary(
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
        switch state {
        case .loaded(let items):
            // Don't double-prepend if reload-then-create raced.
            guard !items.contains(where: { $0.id == summary.id }) else { return }
            state = .loaded([summary] + items)
        case .empty, .idle, .error, .loading:
            // Cold/empty/error state: seed the list with just this game so
            // the user immediately sees something positive.
            state = .loaded([summary])
        }
    }

    func updateParticipantsCount(id: String, count: Int) {
        if case .loaded(let items) = state {
            let updated = items.map { game in
                if game.id == id {
                    return GameSummary(
                        id: game.id,
                        sport_id: game.sport_id,
                        sport_slug: game.sport_slug,
                        host_user_id: game.host_user_id,
                        host_display_name: game.host_display_name,
                        court_id: game.court_id,
                        venue_name: game.venue_name,
                        venue_photo_url: game.venue_photo_url,
                        lat: game.lat,
                        lng: game.lng,
                        starts_at: game.starts_at,
                        duration_minutes: game.duration_minutes,
                        capacity: game.capacity,
                        participants_count: count,
                        status: count >= game.capacity ? .full : game.status,
                        visibility: game.visibility,
                        skill_min_elo: game.skill_min_elo,
                        skill_max_elo: game.skill_max_elo,
                        distance_km: game.distance_km
                    )
                }
                return game
            }
            state = .loaded(updated)
        }
    }

    func requestLocationIfNeeded() {
        switch locationManager.authorizationStatus {
        case .notDetermined:
            locationManager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            locationManager.startUpdatingLocation()
        default:
            break
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        let coord = loc.coordinate
        manager.stopUpdatingLocation()
        Task { @MainActor in
            self.center = coord
            await self.load()
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            switch status {
            case .authorizedWhenInUse, .authorizedAlways:
                self.locationManager.startUpdatingLocation()
            default: break
            }
        }
    }

    // MARK: - Quick feed preview
    //
    // Home renders a 3-row "Friend activity" mini-section to surface the
    // otherwise-orphaned FeedView. We deliberately don't pull in the full
    // `FeedViewModel` here — that ships with pagination, state machines, and
    // cursor handling that don't belong on the home screen. Instead we keep
    // a flat `[FeedEvent]` cache and fire a one-shot `?limit=3` fetch
    // alongside the existing home loads. A failure (auth dropped, offline,
    // empty network) leaves the cache empty so the host can hide the
    // section silently — see `HomeView.friendActivitySection`.
    private(set) var quickFeed: [FeedEvent] = []

    func loadQuickFeed() async {
        do {
            let page = try await apiClient.send(Endpoint<FeedPage>.feed(limit: 3))
            if Task.isCancelled { return }
            quickFeed = page.items
        } catch {
            // Best-effort. Empty cache hides the section — no visible error.
            quickFeed = []
        }
    }

    // MARK: - Widget snapshot
    //
    // Picks the closest *upcoming* match from the freshly-loaded feed and
    // writes it to the App Group for `NextMatchWidget`. Done on the main
    // actor because we're already here from `load()` — UserDefaults itself
    // is process-safe so the call is cheap.
    private func saveWidgetSnapshot(from games: [GameSummary]) {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let formatterNoFraction = ISO8601DateFormatter()
        formatterNoFraction.formatOptions = [.withInternetDateTime]

        let now = Date()
        let nearest = games
            .compactMap { game -> (GameSummary, Date)? in
                let date = formatter.date(from: game.starts_at)
                    ?? formatterNoFraction.date(from: game.starts_at)
                guard let date else { return nil }
                return (game, date)
            }
            .filter { $0.1 > now }
            .min(by: { $0.1 < $1.1 })

        guard let (game, startsAt) = nearest else {
            // Nothing upcoming — clear the slot so the widget shows the
            // empty state instead of yesterday's match.
            SharedContainer.saveSnapshot(nil)
            return
        }

        let snapshot = WidgetMatchSnapshot(
            game_id: game.id,
            starts_at: startsAt,
            venue_name: game.venue_name ?? "Venue TBA",
            opponent_name: game.host_display_name
        )
        SharedContainer.saveSnapshot(snapshot)
    }
}
