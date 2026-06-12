import Foundation
import Observation

/// Lightweight model that owns the two shell-level unread counts:
///   • `unreadCount` — unread notifications (drives the bottom-tab bell badge)
///   • `unreadConversations` — conversations with unread messages
///     (drives the home-header chat bubble badge)
/// Polls both when foregrounded.
@Observable
@MainActor
final class HomeShellViewModel {
    private(set) var unreadCount: Int = 0
    private(set) var unreadConversations: Int = 0
    private let apiClient: APIClient
    private var pollTask: Task<Void, Never>?

    init(apiClient: APIClient) { self.apiClient = apiClient }

    func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(nanoseconds: 30_000_000_000) // 30s
            }
        }
    }
    func stopPolling() { pollTask?.cancel() }

    func refresh() async {
        // Run both pulls concurrently — they're independent and a slow one
        // shouldn't gate the other's badge update.
        async let notifs: Void = refreshNotifications()
        async let convos: Void = refreshConversations()
        _ = await (notifs, convos)
    }

    private func refreshNotifications() async {
        do {
            let res = try await apiClient.send(.notifications)
            unreadCount = res.unread_count
        } catch {
            // ignore — non-critical
        }
    }

    private func refreshConversations() async {
        do {
            let convos = try await apiClient.send(.conversations).items
            unreadConversations = convos.reduce(0) { $0 + ($1.unread ? 1 : 0) }
        } catch {
            // ignore — non-critical
        }
    }
}
