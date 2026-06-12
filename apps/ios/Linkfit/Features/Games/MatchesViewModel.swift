import Foundation
import Observation
import CoreLocation

/// Drives the global Matches page. Loads padel games around the viewer's home
/// (or Baku centre as a fallback) and offers a three-axis filter strip:
///
///   - Period: `active` (upcoming + ongoing), `past` (last 30 days), `all`
///   - Role:   `any` / `host` (I host) / `player` (I'm in but not host)
///   - Result: `any` / `win` / `loss` — only meaningful for past games and
///     decided once the per-game `MatchScore` cache is populated.
///
/// Filtering happens client-side on `allGames`; the server query window is
/// re-issued whenever `period` changes (active = `from=now`, past = last 30d,
/// all = no time bound). Concurrent filter taps are de-duped — the latest
/// request wins. Skill band + the legacy `lens` toggle are retained for
/// source compatibility with older call sites but no longer drive the UI.
@Observable
@MainActor
final class MatchesViewModel {

    enum Lens: String, CaseIterable, Identifiable, Hashable {
        case open    // Discover open games to join
        case mine    // Games the viewer is in (any role)
        var id: String { rawValue }
    }

    enum SkillFilter: String, CaseIterable, Identifiable, Hashable {
        case any, easy, mid, hard
        var id: String { rawValue }

        /// Soft ELO band — used to filter the open-game list client-side.
        /// Server already returns the full set so the filter is responsive.
        var range: ClosedRange<Int>? {
            switch self {
            case .any:  return nil
            case .easy: return 0...1199
            case .mid:  return 1200...1499
            case .hard: return 1500...3000
            }
        }
    }

    /// "When" axis of the filter strip. Maps to the `from` / `to` query
    /// parameters when reloading; client-side filtering also re-applies the
    /// bound so transitions from `all → active` are instant.
    enum Period: String, CaseIterable, Identifiable, Hashable {
        case active   // Upcoming + ongoing (server returns `from=now`)
        case past     // Last 30 days, descending by starts_at
        case all      // No time bound (paginated server-side)
        var id: String { rawValue }
    }

    /// "Who" axis — relative to the viewer.
    enum Role: String, CaseIterable, Identifiable, Hashable {
        case any
        case host    // viewer is host_user_id
        case player  // viewer participates but isn't host
        var id: String { rawValue }
    }

    /// "Outcome" axis — only meaningful when `period == .past`. We resolve
    /// the winning team via the `/scoring` endpoint per game, cached in
    /// `winnerByGame` once fetched.
    enum Result: String, CaseIterable, Identifiable, Hashable {
        case any
        case win
        case loss
        var id: String { rawValue }
    }

    private(set) var state: ViewState<[GameSummary]> = .idle

    // Legacy axis kept for source compatibility with the old Open/Mine
    // segmented control. The new filter strip drives Period/Role/Result;
    // `lens` is intentionally not surfaced any more, and `setLens` is a
    // pass-through that maps onto Role for older call sites.
    var lens: Lens = .open
    // Padel-only product surface today. The slug is pinned here so the
    // discovery query always carries it.
    var sportSlug: String? = "padel"
    var skill: SkillFilter = .any

    // New axes driving the filter strip.
    var period: Period = .active
    var role: Role = .any
    var result: Result = .any

    /// Optional override used by tests / previews. In real use we fall back
    /// to the viewer's home_lat/lng or Baku centre.
    var viewerHome: CLLocationCoordinate2D?

    private let apiClient: APIClient
    private let currentUserId: String?
    private var loadTask: Task<Void, Never>?
    private var resultTask: Task<Void, Never>?

    /// Default Baku centre — the same coords the Home tab uses when the
    /// user hasn't set a home location yet.
    private let bakuCentre = CLLocationCoordinate2D(latitude: 40.4093, longitude: 49.8671)

    /// Per-game scoring snapshot, populated on demand when the user toggles
    /// the Result filter. Nil means "not yet fetched / no score recorded";
    /// non-nil holds the winning team ("a" or "b") and the viewer's team
    /// inferred from the MatchScore rosters.
    struct WinnerInfo: Equatable {
        let winningTeam: ScoreTeam
        let viewerTeam: ScoreTeam?
    }
    private(set) var winnerByGame: [String: WinnerInfo] = [:]

    init(apiClient: APIClient, currentUserId: String?) {
        self.apiClient = apiClient
        self.currentUserId = currentUserId
    }

    func onAppear() async {
        if case .loaded = state { return }
        await load()
    }

    func setLens(_ value: Lens) async {
        guard lens != value else { return }
        lens = value
        // Map legacy lens onto the Role axis so the new filter strip stays
        // the source of truth.
        role = (value == .mine) ? .host : .any
        await load()
    }

    func setSport(_ slug: String?) async {
        sportSlug = (slug == "football_5" || slug == "football") ? nil : slug
        await load()
    }

    func setSkill(_ value: SkillFilter) async {
        skill = value
        applyFiltersSync()
    }

    func setPeriod(_ value: Period) async {
        guard period != value else { return }
        period = value
        // Result only makes sense for past games — collapse silently when
        // the user leaves Keçmiş.
        if value != .past { result = .any }
        await load()
    }

    func setRole(_ value: Role) async {
        guard role != value else { return }
        role = value
        applyFiltersSync()
    }

    func setResult(_ value: Result) async {
        guard result != value else { return }
        result = value
        // Result filter needs per-game winners — kick the cache fill once
        // the user actually opts in, then re-derive.
        if value != .any {
            await fillWinnersCacheIfNeeded()
        }
        applyFiltersSync()
    }

    func resetFilters() async {
        skill = .any
        role = .any
        result = .any
        // Period stays — clearing it would yank the user back to the
        // default tab, which the empty-state CTA doesn't promise.
        applyFiltersSync()
    }

    /// Active filter dimensions, used by the empty-state copy + reset chip.
    /// Skill stays in the count so older callers keep working; the new
    /// strip contributes one slot per axis that's off its default value.
    var activeFilterCount: Int {
        var n = 0
        if skill != .any  { n += 1 }
        if role != .any   { n += 1 }
        if result != .any { n += 1 }
        return n
    }

    func load() async {
        loadTask?.cancel()
        if case .loaded = state {} else { state = .loading }

        let task = Task { [self] in
            await performLoad()
        }
        loadTask = task
        await task.value
    }

    /// Optimistic join — performs the network call and reloads on success.
    /// On failure the prior state is preserved (so the row doesn't disappear)
    /// and we re-raise so the caller can surface a toast.
    func join(_ game: GameSummary) async throws {
        let endpoint = Endpoint<GameDetail>.joinGame(id: game.id)
        _ = try await apiClient.send(endpoint)
        await load()
    }

    // MARK: - Internal

    private func performLoad() async {
        let centre = viewerHome ?? bakuCentre

        // Time window driven by the Period axis. `active` matches the prior
        // behaviour; `past` asks the server for the last 30 days; `all`
        // drops both bounds and leans on cursor pagination (this wave only
        // pulls the first page — pagination wiring lives in a later pass).
        let now = Date()
        let iso = ISO8601DateFormatter()
        let from: String?
        let to: String?
        switch period {
        case .active:
            from = iso.string(from: now)
            to = nil
        case .past:
            from = iso.string(from: now.addingTimeInterval(-30 * 24 * 60 * 60))
            to = iso.string(from: now)
        case .all:
            from = nil
            to = nil
        }

        do {
            let response = try await apiClient.send(
                Endpoint<PagedItemsResponse<GameSummary>>.games(
                    lat: centre.latitude,
                    lng: centre.longitude,
                    sport: sportSlug,
                    from: from,
                    to: to,
                    limit: 50
                )
            )
            if Task.isCancelled { return }

            // Padel-only — drop legacy football items the backend may still
            // return. Past/active gating happens via the server `from`/`to`
            // bounds plus a client-side belt-and-braces filter so the UI
            // stays in sync even if the server clock drifts.
            allGames = response.items.filter { game in
                guard game.sport_slug != "football_5", game.sport_slug != "football" else { return false }
                return true
            }
            // If the user is already showing past games, pre-warm the
            // winners cache so the Result chip doesn't churn the list.
            if period == .past && result != .any {
                await fillWinnersCacheIfNeeded()
            }
            applyFiltersSync()
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.errorDescription
                ?? String(localized: "matches.error.load"))
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    private var allGames: [GameSummary] = []

    private func applyFiltersSync() {
        var items = allGames

        // Period (client-side safety net — the server `from`/`to` bounds
        // already prune most of this, but the local check protects against
        // clock drift between device + server + the fact that the listing
        // includes ongoing games whose `starts_at` is in the past).
        let now = Date()
        items = items.filter { game in
            guard let starts = Date.fromISO(game.starts_at) else { return true }
            switch period {
            case .active: return starts > now.addingTimeInterval(-60 * 60 * 3) // tolerate ongoing
            case .past:   return starts <= now
            case .all:    return true
            }
        }

        // Role.
        if role == .host, let me = currentUserId {
            items = items.filter { $0.host_user_id == me }
        } else if role == .player, let me = currentUserId {
            // We don't yet have per-summary `is_participant`; the safe proxy
            // is "lens == .mine and NOT host". Until the backend ships the
            // flag, .player collapses to "non-host games" which is good
            // enough for the current data shape (Mine returns only games
            // the viewer is in).
            items = items.filter { $0.host_user_id != me }
        }

        // Legacy lens fallback — keeps the old segmented-control path alive
        // for the rare caller that still drives `setLens`.
        if role == .any, lens == .mine, let me = currentUserId {
            items = items.filter { $0.host_user_id == me }
        }

        // Skill.
        if let range = skill.range {
            items = items.filter { game in
                guard let min = game.skill_min_elo, let max = game.skill_max_elo else {
                    return true
                }
                return min <= range.upperBound && max >= range.lowerBound
            }
        }

        // Result — only valid in past mode. Games without a resolved winner
        // (cache miss) fall out of the filter rather than being optimistically
        // included; the cache fills once per session.
        if period == .past, result != .any {
            items = items.filter { game in
                guard let info = winnerByGame[game.id], let viewerTeam = info.viewerTeam else {
                    return false
                }
                let viewerWon = info.winningTeam == viewerTeam
                return result == .win ? viewerWon : !viewerWon
            }
        }

        // Past games read most naturally newest-first; active games stay in
        // ascending chronological order (the server default).
        if period == .past {
            items.sort { lhs, rhs in
                let l = Date.fromISO(lhs.starts_at) ?? .distantPast
                let r = Date.fromISO(rhs.starts_at) ?? .distantPast
                return l > r
            }
        }

        state = items.isEmpty ? .empty : .loaded(items)
    }

    /// Fetch + cache winning team metadata for every past game in
    /// `allGames`. Runs in parallel via a `TaskGroup`; misses (no score
    /// recorded yet) are silently skipped so the dict only contains games
    /// we can definitively classify.
    private func fillWinnersCacheIfNeeded() async {
        guard let me = currentUserId else { return }
        let pending = allGames.filter { winnerByGame[$0.id] == nil }
        guard !pending.isEmpty else { return }

        resultTask?.cancel()
        let task = Task { [apiClient] in
            await withTaskGroup(of: (String, WinnerInfo?).self) { group in
                for game in pending {
                    group.addTask {
                        do {
                            let score = try await apiClient.send(Endpoint<MatchScore>.scoring(gameId: game.id))
                            guard let winner = score.winning_team else { return (game.id, nil) }
                            let viewerTeam: ScoreTeam? = {
                                if score.team_a_user_ids.contains(me) { return .a }
                                if score.team_b_user_ids.contains(me) { return .b }
                                return nil
                            }()
                            return (game.id, WinnerInfo(winningTeam: winner, viewerTeam: viewerTeam))
                        } catch {
                            return (game.id, nil)
                        }
                    }
                }
                for await (id, info) in group {
                    if let info { winnerByGame[id] = info }
                }
            }
        }
        resultTask = task
        await task.value
    }
}
