import Foundation
import Observation

/// State + load logic for the player insights screen.
///
/// The screen is driven by two user-controlled inputs:
///   - `selectedSport`: which sport's stats to chart. Sourced from the
///     viewer's own profile — only sports they've played show up. Defaults
///     to the sport with the most games, falling back to "padel" when the
///     profile is empty.
///   - `window`: how far back the trends should extend.
///
/// Any change to either kicks a fresh load. We never animate stale data —
/// the previous payload is dropped to `.loading` so the chart doesn't lie.
@Observable
@MainActor
final class InsightsViewModel {
    private(set) var state: ViewState<InsightsResponse> = .idle
    /// Sports the viewer has stats for. Populated from the public profile;
    /// drives the sport picker. Empty for brand-new accounts.
    private(set) var availableSports: [SportStats] = []
    var selectedSport: String = "padel"
    var window: InsightsWindow = .days90

    private let apiClient: APIClient
    let container: AppContainer

    init(apiClient: APIClient, container: AppContainer) {
        self.apiClient = apiClient
        self.container = container
    }

    /// Threshold below which we render the empty-state instead of charts.
    /// Three games is the minimum where a trend line carries any signal —
    /// one or two points just look like noise.
    static let minGamesForCharts = 3

    /// Initial load — fetches the viewer's profile to populate the sport
    /// picker, then kicks off the insights request. Idempotent: safe to
    /// call from both `.task` and `.refreshable`.
    func load() async {
        guard let userId = container.currentUser?.id else {
            state = .error(message: String(localized: "insights.error.not_signed_in"))
            return
        }

        // Populate available sports from the public profile. We do this
        // every load so newly-played sports show up without a relaunch.
        if availableSports.isEmpty {
            do {
                let profile = try await apiClient.send(.profile(id: userId))
                availableSports = profile.stats.filter { $0.sport_slug != "football_5" && $0.sport_slug != "football" }
                // Default to the sport with the most games played; tie-break
                // alphabetically so the pick is stable across runs.
                if let top = availableSports.max(by: {
                    ($0.games_played, $1.sport_slug) < ($1.games_played, $0.sport_slug)
                }) {
                    selectedSport = top.sport_slug
                }
            } catch {
                // Profile failure isn't fatal — we still try the insights
                // call with the default sport. The view shows a recoverable
                // error if even that fails.
            }
        }

        await reload()
    }

    /// Re-fetch insights for the current selection. Called when the user
    /// flips a chip — we move to `.loading` so the chart blanks instead of
    /// showing stale ELO under the new label.
    func reload() async {
        state = .loading
        do {
            let resp = try await apiClient.send(
                .insights(sport: selectedSport, days: window.days),
            )
            state = .loaded(resp)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.localizedMessage)
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    // Helpers exposed to the view ------------------------------------------

    /// Whether the user has enough games to make the charts meaningful.
    func hasEnoughGames(_ resp: InsightsResponse) -> Bool {
        resp.total_games >= Self.minGamesForCharts
    }
}
