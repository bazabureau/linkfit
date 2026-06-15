import Foundation
import Observation
import CoreLocation

@Observable
@MainActor
final class VenuesViewModel {
    private(set) var state: ViewState<[Venue]> = .idle
    private(set) var sports: [Sport] = []
    var selectedSportSlug: String?
    var center: CLLocationCoordinate2D = .init(latitude: 40.4093, longitude: 49.8671)

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func onAppear() async {
        if sports.isEmpty {
            sports = ((try? await apiClient.send(.sports).items) ?? [])
                .filter { $0.slug != "football_5" && $0.slug != "football" }
        }
        await load()
    }

    func setSport(_ slug: String?) async {
        selectedSportSlug = (slug == "football_5" || slug == "football") ? nil : slug
        await load()
    }

    /// When non-nil, the venues list is being painted from the on-disk
    /// response cache. Cleared on the next successful network response
    /// so the "Last updated …" caption disappears once the server has
    /// the floor again.
    private(set) var cachedAt: Date?

    func load() async {
        // Offline-graceful — hydrate cached venues on a cold load so a
        // launch with no internet still paints the directory. We only
        // consult the cache when no sport filter is active; cached
        // results from a different sport would mislead the user.
        if case .loaded = state {
            // Already showing data — no-op.
        } else if selectedSportSlug == nil,
                  let hit = await ResponseCache.shared.load([Venue].self, forKey: ResponseCache.Key.venues) {
            cachedAt = hit.cachedAt
            state = hit.value.isEmpty ? .empty : .loaded(hit.value)
        } else {
            state = .loading
        }
        do {
            let res = try await apiClient.send(
                // Wide radius so ALL clubs surface (home shows "all clubs",
                // not just nearby) — lat/lng stay so distance is still computed.
                .venues(lat: center.latitude, lng: center.longitude,
                        radiusKm: 20000, sport: selectedSportSlug ?? "padel")
            )
            state = res.items.isEmpty ? .empty : .loaded(res.items)
            // Only persist the default (no sport filter) payload so a
            // future cold launch matches the user's expected baseline.
            if selectedSportSlug == nil {
                await ResponseCache.shared.save(res.items, forKey: ResponseCache.Key.venues)
                cachedAt = nil
            }
        } catch is CancellationError {
            return
        } catch let error as APIError {
            // Offline + we already painted a cached list — keep the rows
            // on screen, surface a non-intrusive toast instead.
            if error == .offline, case .loaded = state {
                ToastCenter.shared.error(String(localized: "error.network_offline"))
                return
            }
            state = .error(message: error.localizedMessage)
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }
}
