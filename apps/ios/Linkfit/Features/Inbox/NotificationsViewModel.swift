import Foundation
import Observation

@Observable
@MainActor
final class NotificationsViewModel {
    private(set) var state: ViewState<[AppNotification]> = .idle
    private(set) var unreadCount: Int = 0
    /// Memoized Today / Yesterday / This week / Earlier buckets.
    /// Recomputed whenever the loaded list changes so the SwiftUI body
    /// can read it directly without re-bucketing on every render.
    /// Empty when the state is anything other than `.loaded`.
    private(set) var sections: [(String, [AppNotification])] = []
    private let apiClient: APIClient

    init(apiClient: APIClient) { self.apiClient = apiClient }

    func load() async {
        if case .loaded = state {} else { state = .loading }
        do {
            let res = try await apiClient.send(.notifications)
            unreadCount = res.unread_count
            if res.items.isEmpty {
                state = .empty
                sections = []
            } else {
                state = .loaded(res.items)
                rebuildSections(res.items)
            }
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.errorDescription ?? String(localized: "notifications.error.load"))
            sections = []
        } catch {
            state = .error(message: error.localizedDescription)
            sections = []
        }
    }

    /// Optimistically mark a single notification as read, then post to API.
    /// Avoids the full reload flicker the previous implementation had.
    func markRead(_ notification: AppNotification) async {
        guard notification.read_at == nil else { return }
        // Optimistic update — flip read_at locally so the dot disappears now.
        if case .loaded(var items) = state {
            if let idx = items.firstIndex(where: { $0.id == notification.id }) {
                let n = items[idx]
                let now = Date().toISO()
                items[idx] = AppNotification(
                    id: n.id, type: n.type, title: n.title, body: n.body,
                    read_at: now, created_at: n.created_at, payload: n.payload
                )
                state = .loaded(items)
                unreadCount = max(0, unreadCount - 1)
                rebuildSections(items)
            }
        }
        do {
            _ = try await apiClient.send(.markNotificationRead(id: notification.id))
        } catch {
            // Silent — server-truth will catch up on next refresh.
        }
    }

    func markAllRead() async {
        // Optimistic — mark all in-memory items read first.
        if case .loaded(let items) = state {
            let now = Date().toISO()
            let updated = items.map { n in
                AppNotification(
                    id: n.id, type: n.type, title: n.title, body: n.body,
                    read_at: n.read_at ?? now, created_at: n.created_at, payload: n.payload
                )
            }
            state = .loaded(updated)
            unreadCount = 0
            rebuildSections(updated)
        }
        do {
            _ = try await apiClient.send(.markAllNotificationsRead)
        } catch { /* silent */ }
    }

    /// Optimistically remove a single notification, then post DELETE.
    /// Reverts on server failure so the user doesn't silently lose a row.
    func delete(_ notification: AppNotification) async {
        guard case .loaded(var items) = state else { return }
        let snapshot = items
        let previousUnread = unreadCount
        let previousSections = sections
        let wasUnread = notification.read_at == nil
        items.removeAll { $0.id == notification.id }
        if wasUnread { unreadCount = max(0, unreadCount - 1) }
        if items.isEmpty {
            state = .empty
            sections = []
        } else {
            state = .loaded(items)
            rebuildSections(items)
        }
        do {
            _ = try await apiClient.send(.deleteNotification(id: notification.id))
        } catch {
            // Roll back — list returns to its prior state on failure.
            state = .loaded(snapshot)
            unreadCount = previousUnread
            sections = previousSections
        }
    }

    /// Optimistically clear the whole list, then post DELETE.
    /// Reverts on failure.
    func deleteAll() async {
        guard case .loaded(let items) = state else { return }
        let snapshot = items
        let previousUnread = unreadCount
        let previousSections = sections
        state = .empty
        unreadCount = 0
        sections = []
        do {
            _ = try await apiClient.send(.deleteAllNotifications())
        } catch {
            state = .loaded(snapshot)
            unreadCount = previousUnread
            sections = previousSections
        }
    }

    /// Buckets the loaded notifications into Today / Yesterday / This week /
    /// Earlier and caches the result on `sections`. Mirrors what the view
    /// used to do inline on every body pass — moved here so re-renders just
    /// read the cached array.
    private func rebuildSections(_ items: [AppNotification]) {
        let cal = Calendar.current
        let now = Date()
        var today: [AppNotification] = []
        var yesterday: [AppNotification] = []
        var thisWeek: [AppNotification] = []
        var earlier: [AppNotification] = []
        for n in items {
            guard let d = Date.fromISO(n.created_at) else {
                earlier.append(n); continue
            }
            if cal.isDateInToday(d) { today.append(n) }
            else if cal.isDateInYesterday(d) { yesterday.append(n) }
            else if cal.dateComponents([.day], from: d, to: now).day ?? 99 < 7 { thisWeek.append(n) }
            else { earlier.append(n) }
        }
        var out: [(String, [AppNotification])] = []
        if !today.isEmpty { out.append((String(localized: "notifications.section.today"), today)) }
        if !yesterday.isEmpty { out.append((String(localized: "notifications.section.yesterday"), yesterday)) }
        if !thisWeek.isEmpty { out.append((String(localized: "notifications.section.this_week"), thisWeek)) }
        if !earlier.isEmpty { out.append((String(localized: "notifications.section.earlier"), earlier)) }
        sections = out
    }
}
