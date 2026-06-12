import Foundation
import Observation

/// View model behind `AgendaCalendarView`.
///
/// Owns the currently-displayed month, the fetched agenda for it, and a
/// per-day bucket so the grid can render dots in O(1) without scanning the
/// item list every cell. Re-fetches whenever the month changes.
@Observable
@MainActor
final class AgendaCalendarViewModel {
    /// Anchor inside the displayed month — first-of-month, locale-agnostic.
    private(set) var monthAnchor: Date
    private(set) var state: ViewState<AgendaSnapshot> = .idle

    private let apiClient: APIClient
    /// Stable UTC calendar — calendar math (day buckets, range bounds) must
    /// not drift with the user's locale or DST. The view uses the locale-aware
    /// `Calendar.current` separately for *display*, not for keying.
    private let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return c
    }()

    init(apiClient: APIClient, anchor: Date = Date()) {
        self.apiClient = apiClient
        self.monthAnchor = AgendaCalendarViewModel.firstOfMonth(for: anchor, utc: {
            var c = Calendar(identifier: .gregorian); c.timeZone = .gmt; return c
        }())
    }

    /// Jumps the visible month back or forward by `offset` months. The grid's
    /// header arrows call this with ±1; the "Today" button calls `jumpToToday`.
    func step(_ offset: Int) async {
        guard let next = utc.date(byAdding: .month, value: offset, to: monthAnchor) else { return }
        monthAnchor = Self.firstOfMonth(for: next, utc: utc)
        await load()
    }

    func jumpToToday() async {
        monthAnchor = Self.firstOfMonth(for: Date(), utc: utc)
        await load()
    }

    /// Returns the bucket of items occurring on the given calendar day. The
    /// day is keyed by its UTC `YYYY-MM-DD` to avoid timezone drift between
    /// the API payload (UTC ISO) and the grid (locale display).
    func items(on day: Date) -> [AgendaItem] {
        guard case .loaded(let snap) = state else { return [] }
        return snap.byDay[Self.utcKey(for: day, utc: utc)] ?? []
    }

    /// Fetch the agenda for the currently-displayed month. Sets `.loaded`
    /// (with an `isEmpty` snapshot if the user has nothing) or `.empty`/`.error`.
    func load() async {
        if case .loaded = state {} else { state = .loading }
        let from = Self.firstOfMonth(for: monthAnchor, utc: utc)
        guard let to = utc.date(byAdding: DateComponents(month: 1, day: -1), to: from) else {
            state = .error(message: String(localized: "calendar.error.load"))
            return
        }
        let fromString = Self.ymd(from, utc: utc)
        let toString = Self.ymd(to, utc: utc)
        do {
            let res = try await apiClient.send(.myAgenda(from: fromString, to: toString))
            let snap = AgendaSnapshot(response: res, utc: utc)
            if snap.isEmpty {
                state = .loaded(snap) // keep the grid visible, view shows inline empty hint
            } else {
                state = .loaded(snap)
            }
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.localizedMessage)
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    // MARK: - Static helpers
    //
    // Marked `nonisolated` because they're pure functions over their inputs
    // and the snapshot initializer (a struct, no actor) calls them while
    // bucketing items.

    nonisolated static func firstOfMonth(for date: Date, utc: Calendar) -> Date {
        let comps = utc.dateComponents([.year, .month], from: date)
        return utc.date(from: comps) ?? date
    }

    nonisolated static func ymd(_ date: Date, utc: Calendar) -> String {
        let comps = utc.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", comps.year ?? 1970, comps.month ?? 1, comps.day ?? 1)
    }

    nonisolated static func utcKey(for date: Date, utc: Calendar) -> String {
        ymd(date, utc: utc)
    }
}

/// Immutable view snapshot derived from one agenda response. Pre-computed so
/// the day cells don't iterate the full item list on every redraw.
struct AgendaSnapshot: Equatable {
    /// Day key (UTC `YYYY-MM-DD`) → ordered list of items on that day.
    let byDay: [String: [AgendaItem]]
    /// True iff every bucket in the response was empty.
    let isEmpty: Bool

    init(response: AgendaResponse, utc: Calendar) {
        var map: [String: [AgendaItem]] = [:]
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallback = ISO8601DateFormatter()
        fallback.formatOptions = [.withInternetDateTime]

        func bucket(_ item: AgendaItem) {
            let date = formatter.date(from: item.starts_at)
                ?? fallback.date(from: item.starts_at)
            guard let date else { return }
            let key = AgendaCalendarViewModel.utcKey(for: date, utc: utc)
            map[key, default: []].append(item)
        }
        response.games.forEach(bucket)
        response.bookings.forEach(bucket)
        response.tournaments.forEach(bucket)

        // Sort each day chronologically. The server sorts within bucket but
        // we merge three buckets, so a per-day re-sort is required.
        for key in map.keys {
            map[key]?.sort { $0.starts_at < $1.starts_at }
        }

        self.byDay = map
        self.isEmpty = response.games.isEmpty
            && response.bookings.isEmpty
            && response.tournaments.isEmpty
    }
}
