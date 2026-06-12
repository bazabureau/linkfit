import Foundation
import Observation

/// Persists the last few search queries the user entered so the empty-query
/// state can suggest "recent searches" without bouncing back to a server.
/// We deliberately keep this lightweight (UserDefaults, max 5 entries) — it's
/// a UX nicety, not a long-term history feature.
@MainActor
final class RecentSearchesStore {
    static let storageKey = "linkfit.search.recent"
    static let maxEntries = 5

    private(set) var entries: [String]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.entries = defaults.stringArray(forKey: Self.storageKey) ?? []
    }

    private let defaults: UserDefaults

    /// Push a new query to the head of the list. Duplicates collapse, and
    /// the list is trimmed to `maxEntries` — newest first.
    func remember(_ query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        // Case-insensitive de-dupe so "Padel" and "padel" share one slot.
        var next = entries.filter { $0.caseInsensitiveCompare(trimmed) != .orderedSame }
        next.insert(trimmed, at: 0)
        if next.count > Self.maxEntries {
            next = Array(next.prefix(Self.maxEntries))
        }
        entries = next
        defaults.set(entries, forKey: Self.storageKey)
    }

    func clear() {
        entries = []
        defaults.removeObject(forKey: Self.storageKey)
    }
}

/// Drives the global Search screen. Debounces the user's text input
/// (≈300 ms) so we don't hammer the server on every keystroke, fans the
/// request out across all four entity types, and exposes a typed-section
/// filter for the "see more" deep-link.
@Observable
@MainActor
final class SearchViewModel {
    /// Current text in the field.
    var query: String = ""

    /// Active type filter. `nil` means "all sections shown".
    private(set) var typeFilter: SearchResultType?

    /// Result page from the last successful fetch.
    private(set) var state: ViewState<SearchResponse> = .idle

    /// Recent queries, newest first. Hidden inside the empty-query state so
    /// users can re-run a recent search with a single tap.
    private(set) var recents: [String]

    /// Curated suggestions surfaced alongside recent searches. Useful when
    /// the user hasn't searched anything yet (cold start) so the empty
    /// screen doesn't feel hollow.
    let sampleQueries: [String] = ["Padel", "Sahil", "Spring Cup", "Yasamal"]

    private let apiClient: APIClient
    private let recentsStore: RecentSearchesStore
    private var searchTask: Task<Void, Never>?

    /// Debounce window — matches the pattern used by `PlayersViewModel`.
    private let debounceNanos: UInt64 = 300_000_000

    init(apiClient: APIClient,
         recentsStore: RecentSearchesStore = RecentSearchesStore()) {
        self.apiClient = apiClient
        self.recentsStore = recentsStore
        self.recents = recentsStore.entries
    }

    // MARK: - Inputs

    /// Schedule a debounced fetch. Cancels any in-flight debounce timer.
    func setQuery(_ q: String) {
        query = q
        scheduleFetch()
    }

    /// Run a query immediately, bypassing the debounce. Used when the user
    /// taps a recent / sample chip — they've already shown intent.
    func runQueryImmediately(_ q: String) {
        searchTask?.cancel()
        query = q
        Task { await self.performFetch(recordRecent: true) }
    }

    func clearQuery() {
        searchTask?.cancel()
        query = ""
        state = .idle
    }

    func setTypeFilter(_ type: SearchResultType?) {
        typeFilter = type
        // Re-fetch with the new scope so server-side `limit` budgets target
        // the user's actual interest rather than the all-section default.
        scheduleFetch()
    }

    func clearRecents() {
        recentsStore.clear()
        recents = []
    }

    // MARK: - Internals

    private func scheduleFetch() {
        searchTask?.cancel()
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else {
            state = .idle
            return
        }
        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: self?.debounceNanos ?? 300_000_000)
            if Task.isCancelled { return }
            await self?.performFetch(recordRecent: true)
        }
    }

    private func performFetch(recordRecent: Bool) async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else {
            state = .idle
            return
        }
        // Don't flicker into a spinner on top of existing results — keep the
        // previous page visible until the new one arrives.
        if case .loaded = state {} else { state = .loading }

        do {
            let response = try await apiClient.send(
                .search(q: q, type: typeFilter, limit: 10)
            )
            if Task.isCancelled { return }
            if response.isEmpty {
                state = .empty
            } else {
                state = .loaded(response)
            }
            if recordRecent {
                recentsStore.remember(q)
                recents = recentsStore.entries
            }
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if Task.isCancelled { return }
            state = .error(message: error.localizedMessage)
        } catch {
            if Task.isCancelled { return }
            state = .error(message: error.localizedDescription)
        }
    }
}
