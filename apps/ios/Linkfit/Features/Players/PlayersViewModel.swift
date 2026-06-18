import Foundation
import Observation

/// Skill bands surfaced in the Find Player filter row. The ELO ranges below
/// are the ones the rating service uses elsewhere in the app — keep these in
/// sync with backend onboarding copy if either side ever moves.
enum PlayerSkillBand: String, CaseIterable, Identifiable {
    case beginner
    case intermediate
    case advanced
    case expert

    var id: String { rawValue }

    /// Inclusive ELO range. `nil` upper bound means "and above".
    var eloRange: (min: Int, max: Int?) {
        switch self {
        case .beginner:     return (0, 1199)
        case .intermediate: return (1200, 1599)
        case .advanced:     return (1600, 1899)
        case .expert:       return (1900, nil)
        }
    }

    var titleKey: String.LocalizationValue {
        switch self {
        case .beginner:     return "players.filter.skill.beginner"
        case .intermediate: return "players.filter.skill.intermediate"
        case .advanced:     return "players.filter.skill.advanced"
        case .expert:       return "players.filter.skill.expert"
        }
    }
}

@Observable
@MainActor
final class PlayersViewModel {
    private(set) var state: ViewState<[PlayerSummary]> = .idle

    /// Free-text search; debounced inside `setQuery`.
    var query: String = ""
    /// Sport slug filter (e.g. "padel"). `nil` means "all sports".
    var sportSlug: String?
    /// Skill band filter (maps to min_elo/max_elo). `nil` means "any skill".
    var skill: PlayerSkillBand?
    /// When the user has a home location and toggles this on, restrict
    /// results to a 25 km radius around their home coords.
    var nearbyOnly: Bool = false
    /// When true, client-side filter down to followed players.
    var followingOnly: Bool = false

    /// User's home location, if known. Used to power the distance filter.
    /// Owned by the caller (set once from `AppContainer.currentUser`).
    var viewerHome: (lat: Double, lng: Double)?

    /// Viewer's own user id — set so we can filter the viewer's own
    /// row out of the directory. Otherwise users saw their own face
    /// in the list and the Follow button (backend rejected self-follow
    /// with 400, error swallowed silently → "nothing happens").
    var viewerUserId: String?

    /// Transient error from the most recent toggleFollow attempt.
    /// View binds this to an alert so the user gets explicit feedback
    /// instead of a brief silent UI flicker on failure.
    var actionError: String?

    private let apiClient: APIClient
    private var searchTask: Task<Void, Never>?
    private var loadTask: Task<Void, Never>?
    private let nearbyRadiusKm: Double = 25

    /// Source-of-truth list returned by the API. `state` exposes the filtered
    /// view derived from this + `followingOnly`.
    private var allPlayers: [PlayerSummary] = []

    init(apiClient: APIClient, viewerHome: (lat: Double, lng: Double)? = nil) {
        self.apiClient = apiClient
        self.viewerHome = viewerHome
    }

    func onAppear() async { await load() }

    func setQuery(_ q: String) {
        query = q
        searchTask?.cancel()
        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 280_000_000)
            if Task.isCancelled { return }
            await self?.load()
        }
    }

    func setSport(_ slug: String?) async {
        sportSlug = (slug == "football_5" || slug == "football") ? nil : slug
        await load()
    }

    func setSkill(_ band: PlayerSkillBand?) async {
        skill = band
        await load()
    }

    func setNearbyOnly(_ on: Bool) async {
        // Defensive: don't request lat/lng round-trips when we don't have a
        // viewer home set. The UI suppresses the chip in that case too.
        guard viewerHome != nil || !on else {
            nearbyOnly = false
            return
        }
        nearbyOnly = on
        await load()
    }

    func setFollowingOnly(_ on: Bool) {
        followingOnly = on
        recomputeState()
    }

    /// Clear every filter — sport, skill, nearby, following-only. Used by the
    /// "Reset filters" pill on PlayersView.
    func resetFilters() async {
        sportSlug = nil
        skill = nil
        nearbyOnly = false
        followingOnly = false
        await load()
    }

    func load() async {
        // Cancel any in-flight load so a fast filter tap doesn't race with
        // a slow prior request and overwrite state with stale rows.
        loadTask?.cancel()
        // Offline-graceful — paint cached players on cold load before
        // we put up the skeleton, so a launch with no internet still
        // shows real rows. Only used when no filters are active; with
        // filters the cached payload wouldn't match what the user
        // asked for and would be more confusing than helpful.
        if case .loaded = state {
            // Already showing data — no-op.
        } else if isUnfilteredQuery,
                  let hit = await ResponseCache.shared.load([PlayerSummary].self, forKey: ResponseCache.Key.players) {
            allPlayers = hit.value
            cachedAt = hit.cachedAt
            recomputeState()
        } else {
            state = .loading
        }

        let task = Task { [self] in
            await self.performLoad()
        }
        loadTask = task
        await task.value
    }

    /// When non-nil, the players list is being painted from the on-disk
    /// response cache. Cleared on the next successful network response.
    private(set) var cachedAt: Date?

    /// Cache is only consulted (and refreshed) when the user hasn't
    /// narrowed the list with filters — otherwise the cached "all
    /// players" payload wouldn't match the filter selection and would
    /// surface unexpected rows on every cold load.
    private var isUnfilteredQuery: Bool {
        query.isEmpty && sportSlug == nil && skill == nil && !nearbyOnly
    }

    private func performLoad() async {
        let (minElo, maxElo): (Int?, Int?) = {
            guard let skill else { return (nil, nil) }
            return (skill.eloRange.min, skill.eloRange.max)
        }()

        let geo: (lat: Double, lng: Double, radiusKm: Double)? = {
            guard nearbyOnly, let home = viewerHome else { return nil }
            return (home.lat, home.lng, nearbyRadiusKm)
        }()

        do {
            let items = try await apiClient.send(
                .players(
                    q: query.isEmpty ? nil : query,
                    sport: sportSlug,
                    minElo: minElo,
                    maxElo: maxElo,
                    lat: geo?.lat,
                    lng: geo?.lng,
                    radiusKm: geo?.radiusKm,
                    limit: 30
                )
            ).items

            if Task.isCancelled { return }
            // Strip non-padel rows AND the viewer themselves. Listing
            // the viewer in their own directory let them tap Follow
            // on their own face — backend's self-follow guard rejects
            // with 400 and the UI silent-reverted, making the action
            // look broken.
            let me = viewerUserId
            allPlayers = items.filter {
                $0.primary_sport != "football_5"
                    && $0.primary_sport != "football"
                    && $0.id != me
            }
            // Seed the global FollowStore so a ProfileView opened from any
            // of these rows reflects the directory's truth on first render.
            for p in allPlayers {
                FollowStore.shared.seed(
                    userId: p.id,
                    isFollowing: p.is_followed_by_me ?? false
                )
            }
            // Offline-graceful — only persist the unfiltered fetch so the
            // next launch's cold-cache hit matches what the user expects
            // to see in the default directory view.
            if isUnfilteredQuery {
                await ResponseCache.shared.save(allPlayers, forKey: ResponseCache.Key.players)
                cachedAt = nil
            }
            recomputeState()
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if Task.isCancelled { return }
            // Offline + we already painted a cached list — keep the rows
            // visible and surface a soft toast instead of nuking the UI.
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

    /// Optimistic toggle. (1) Flip `allPlayers[idx].is_followed_by_me`
    /// + `followers_count` IMMEDIATELY so the UI re-renders with the
    /// new truth on the next tick. (2) Fire the network call. (3) On
    /// failure, revert the local mutation. Previously the mutation
    /// happened AFTER the await, so the button briefly stayed in the
    /// old state until the round-trip resolved — and on slow networks
    /// users tapped twice, sending duplicate follow requests.
    ///
    /// Also mirrors the new edge + counter deltas into `FollowStore` so
    /// any ProfileView opened for the same user picks up the change
    /// immediately, without waiting for its own network round-trip.
    func toggleFollow(_ player: PlayerSummary) async {
        guard !FollowStore.shared.isPending(userId: player.id) else { return }
        let currentlyFollows = player.is_followed_by_me ?? false
        let willFollow = !currentlyFollows
        let viewerId = viewerUserId ?? ""

        // Optimistic flip — row + global store.
        applyFollowMutation(playerId: player.id, isFollowing: willFollow)

        do {
            _ = try await FollowStore.shared.performToggle(
                targetUserId: player.id,
                viewerUserId: viewerId,
                follow: willFollow
            ) { next in
                if next {
                    _ = try await apiClient.send(.followUser(id: player.id))
                } else {
                    _ = try await apiClient.send(.unfollowUser(id: player.id))
                }
            }
        } catch let error as APIError {
            // Revert + surface the error so the view can show an
            // alert. Previously errors were swallowed by `try?` at
            // the call site, leaving the user staring at a button
            // that flipped and unflipped with no explanation.
            applyFollowMutation(playerId: player.id, isFollowing: currentlyFollows)
            actionError = error.localizedMessage
        } catch is CancellationError {
            applyFollowMutation(playerId: player.id, isFollowing: currentlyFollows)
        } catch {
            applyFollowMutation(playerId: player.id, isFollowing: currentlyFollows)
            actionError = error.localizedDescription
        }
    }

    func clearActionError() { actionError = nil }

    // MARK: - Private

    private func applyFollowMutation(playerId: String, isFollowing: Bool) {
        guard let idx = allPlayers.firstIndex(where: { $0.id == playerId }) else { return }
        let old = allPlayers[idx]
        let newCount: Int? = {
            guard let c = old.followers_count else { return nil }
            return max(0, c + (isFollowing ? 1 : -1))
        }()
        allPlayers[idx] = PlayerSummary(
            id: old.id,
            display_name: old.display_name,
            photo_url: old.photo_url,
            primary_sport: old.primary_sport,
            primary_elo: old.primary_elo,
            reliability_score: old.reliability_score,
            distance_km: old.distance_km,
            is_followed_by_me: isFollowing,
            followers_count: newCount,
            last_seen_at: old.last_seen_at
        )
        recomputeState()
    }

    private func recomputeState() {
        let visible = followingOnly
            ? allPlayers.filter { $0.is_followed_by_me == true }
            : allPlayers
        state = visible.isEmpty ? .empty : .loaded(visible)
    }
}
