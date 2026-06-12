import Foundation
import Observation
import SwiftUI

/// Locale-agnostic reasoning tokens the backend emits on each recommended
/// player card. Maps 1:1 to the `RecommendedPlayerReasonCode` zod enum in
/// `apps/api/src/modules/matchmaking/matchmaking.schema.ts` — keep both
/// sides in sync.
///
/// Each case carries an AZ-first label so the card can render a coloured
/// chip without a string-format lookup at every cell. SwiftUI re-evaluates
/// `LocalizedStringKey` on locale change so `LocaleManager`'s in-app
/// switch picks up new translations live.
enum RecommendedPlayerReason: String, Hashable, Sendable {
    case sameSkill = "same_skill"
    case sameCity = "same_city"
    case recentlyActive = "recently_active"
    case playsWithYourFriends = "plays_with_your_friends"
    case reliable = "reliable"
    case nearby
    case newPlayer = "new_player"

    /// Localised AZ-first label rendered inside the chip.
    var labelKey: LocalizedStringKey {
        switch self {
        case .sameSkill:           return "matchmaking.reason.same_skill"
        case .sameCity:            return "matchmaking.reason.same_city"
        case .recentlyActive:      return "matchmaking.reason.recently_active"
        case .playsWithYourFriends: return "matchmaking.reason.plays_with_your_friends"
        case .reliable:            return "matchmaking.reason.reliable"
        case .nearby:              return "matchmaking.reason.nearby"
        case .newPlayer:           return "matchmaking.reason.new_player"
        }
    }

    /// Per-reason accent so chips have visual variation rather than a
    /// uniform lime wall. The colours stay inside the DSColor token set so
    /// theming continues to flow through the design system, never a hex.
    var accent: Color {
        switch self {
        case .sameSkill, .nearby:       return DSColor.accent
        case .sameCity:                  return DSColor.info
        case .recentlyActive:            return DSColor.success
        case .playsWithYourFriends:      return DSColor.warning
        case .reliable:                  return DSColor.accent.opacity(0.85)
        case .newPlayer:                 return DSColor.textTertiary
        }
    }
}

/// State + load logic for the "For You" matchmaking carousels.
///
/// The screen surfaces two parallel lanes — games and players — each
/// fetched independently so a failure in one doesn't blank the other.
/// We keep both as separate `ViewState` instances so the view can render
/// partial success (e.g., games loaded, players still loading).
///
/// `mode` toggles the players lane between the generic "Best players for
/// you" surface (`/players`) and the strict matchmaker surface that hard-
/// filters by ELO bracket (`/players/for-me`). PlayersView's "Sənə uyğun"
/// segment uses `.forMe`; the HomeView "For You" carousel still uses the
/// generic mode so the home tile shows a broader set of suggestions.
@Observable
@MainActor
final class MatchmakingViewModel {
    enum Mode {
        /// Lenient: any non-followed user, ranked by ELO/distance/friends.
        case generic
        /// Strict: hard-filters to ±200 ELO, used by the PlayersView tab.
        case forMe
    }

    private(set) var games: ViewState<[RecommendedGame]> = .idle
    private(set) var players: ViewState<[RecommendedPlayer]> = .idle

    /// How many cards to request per lane. Matches the product spec; the
    /// backend caps the upper bound at 25 so a misbehaving caller can't
    /// slurp the whole candidate pool.
    var limit: Int = 10

    /// Which players endpoint to call. Defaults to `.generic` so the
    /// existing HomeView "For You" surface stays unchanged after this
    /// rev; PlayersView constructs the VM with `.forMe` explicitly.
    var mode: Mode = .generic

    /// When true, only the players lane is fetched. Skips the games call
    /// entirely so the PlayersView tab doesn't double up bandwidth.
    var playersOnly: Bool = false

    private let apiClient: APIClient
    let container: AppContainer

    init(apiClient: APIClient, container: AppContainer, mode: Mode = .generic, playersOnly: Bool = false) {
        self.apiClient = apiClient
        self.container = container
        self.mode = mode
        self.playersOnly = playersOnly
        // For-me lane shows up to 20 (per spec); generic lane keeps 10.
        if mode == .forMe { self.limit = 20 }
    }

    /// Initial load — kicks off both fetches in parallel. Idempotent: safe
    /// to call from both `.task` and `.refreshable`.
    func load() async {
        guard container.currentUser != nil else {
            games = .error(message: String(localized: "matchmaking.error.not_signed_in"))
            players = .error(message: String(localized: "matchmaking.error.not_signed_in"))
            return
        }

        if playersOnly {
            await loadPlayers()
            return
        }

        async let gamesTask: () = loadGames()
        async let playersTask: () = loadPlayers()
        _ = await gamesTask
        _ = await playersTask
    }

    /// Re-run both lanes. Pull-to-refresh wires through here.
    func refresh() async {
        await load()
    }

    private func loadGames() async {
        games = .loading
        do {
            let resp = try await apiClient.send(.matchmakingGames(limit: limit))
            if resp.items.isEmpty {
                games = .empty
            } else {
                games = .loaded(resp.items)
            }
        } catch is CancellationError {
            return
        } catch let error as APIError {
            games = .error(message: error.localizedMessage)
        } catch {
            games = .error(message: error.localizedDescription)
        }
    }

    private func loadPlayers() async {
        players = .loading
        do {
            let endpoint: Endpoint<RecommendedPlayersResponse> =
                mode == .forMe
                    ? .matchmakingPlayersForMe(limit: limit)
                    : .matchmakingPlayers(limit: limit)
            let resp = try await apiClient.send(endpoint)
            if resp.items.isEmpty {
                players = .empty
            } else {
                players = .loaded(resp.items)
                // Seed the global FollowStore so cards from this lane
                // start with the right Follow/Following state — the
                // backend already excludes followed users from this
                // surface, but seeding `false` keeps the toggle truthful
                // until a follow flips it to `true`.
                for p in resp.items {
                    FollowStore.shared.seed(userId: p.user_id, isFollowing: false)
                }
            }
        } catch is CancellationError {
            return
        } catch let error as APIError {
            players = .error(message: error.localizedMessage)
        } catch {
            players = .error(message: error.localizedDescription)
        }
    }

    /// Optimistic follow toggle for a recommended player. Flips the
    /// global FollowStore immediately, fires the network call, reverts
    /// on failure. The card row reads FollowStore so the button state
    /// updates without a list re-fetch.
    func toggleFollow(_ player: RecommendedPlayer) async {
        let isFollowing = FollowStore.shared.isFollowing(userId: player.user_id)
        let willFollow = !isFollowing

        FollowStore.shared.setFollowing(userId: player.user_id, isFollowing: willFollow)
        FollowStore.shared.applyCountDelta(forUser: player.user_id, delta: willFollow ? 1 : -1)

        do {
            if willFollow {
                _ = try await apiClient.send(.followUser(id: player.user_id))
                // Analytics — `source: .matchmaking` since this VM backs
                // the matchmaking-suggested partner list. See
                // AnalyticsEvent.FollowSource for the closed set.
                Analytics.track(.followUser(targetUserId: player.user_id, source: .matchmaking))
            } else {
                _ = try await apiClient.send(.unfollowUser(id: player.user_id))
            }
        } catch {
            // Revert on any failure — APIError, cancel, or unexpected.
            FollowStore.shared.setFollowing(userId: player.user_id, isFollowing: isFollowing)
            FollowStore.shared.applyCountDelta(forUser: player.user_id, delta: willFollow ? -1 : 1)
        }
    }
}
