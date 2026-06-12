import Foundation
import Observation

/// View model behind `MyBookingsView`. Mirrors the upcoming / past split that
/// the API returns so the view doesn't have to bucket bookings itself.
@Observable
@MainActor
final class MyBookingsViewModel {
    private(set) var state: ViewState<BookingsListResponse> = .idle
    private(set) var cancellingId: String?
    /// Transient error from a cancel attempt. Stored separately from
    /// `state` so a failed cancel surfaces as an alert without wiping
    /// the other bookings off the list. Previously a cancel failure
    /// did `state = .error(...)`, which dropped the user back into an
    /// error screen and forced them to re-pull to see their other
    /// upcoming reservations. Mirrors the pattern in
    /// `GameDetailViewModel`.
    var actionError: String?

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func clearActionError() { actionError = nil }

    func load() async {
        if case .loaded = state {} else { state = .loading }
        do {
            let res = try await apiClient.send(.myBookings)
            if res.upcoming.isEmpty && res.past.isEmpty {
                state = .empty
                WidgetCache.shared.update(
                    nextGame: nil,
                    currentStreak: WidgetCache.shared.currentStreak,
                    unreadConversations: WidgetCache.shared.unreadConversations
                )
            } else {
                state = .loaded(res)
                if let next = res.upcoming.first {
                    let date = ISO8601DateFormatter().date(from: next.starts_at) ?? Date()
                    let widgetGame = WidgetGame(
                        id: next.id,
                        sport: "Padel",
                        startsAt: date,
                        venueName: next.venue_name
                    )
                    WidgetCache.shared.update(
                        nextGame: widgetGame,
                        currentStreak: WidgetCache.shared.currentStreak,
                        unreadConversations: WidgetCache.shared.unreadConversations
                    )
                } else {
                    WidgetCache.shared.update(
                        nextGame: nil,
                        currentStreak: WidgetCache.shared.currentStreak,
                        unreadConversations: WidgetCache.shared.unreadConversations
                    )
                }
            }
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.errorDescription ?? String(localized: "bookings.error.load"))
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    /// Optimistic cancel. Server-truth wins on next reload — if the cancel
    /// failed we surface the error transiently and keep the existing list
    /// on screen instead of replacing it with a full-screen error state.
    func cancel(_ booking: Booking) async {
        guard cancellingId == nil else { return }
        cancellingId = booking.id
        defer { cancellingId = nil }
        do {
            _ = try await apiClient.send(.cancelBooking(id: booking.id))
            await load()
        } catch is CancellationError {
            return
        } catch let error as APIError {
            let detail = error.errorDescription ?? String(localized: "bookings.error.cancel")
            actionError = String(format: String(localized: "bookings.error.cancel_format"), detail)
        } catch {
            actionError = String(format: String(localized: "bookings.error.cancel_format"),
                                 error.localizedDescription)
        }
    }
}
