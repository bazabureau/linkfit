import Foundation
import Observation

/// Drives the Notification Preferences screen.
///
/// Two server-side concerns combined into a single view state:
///   1. Per-type push toggles (8 rows of `NotificationPreference`).
///   2. A global quiet-hours window (two `Int` hours-of-day or `nil`).
///
/// Mutations are optimistic: the toggle flips immediately, the network
/// call goes out in the background, and a rollback restores the
/// snapshot if the server rejects the change. This matches the same
/// pattern used in `SessionsViewModel` / `BlockedUsersViewModel`.
///
/// Quiet-hours uses a different optimistic model: we debounce edits in
/// the view (DatePicker fires `onChange` for every minute the user
/// drags through) and the viewmodel just sends the latest committed
/// hour pair. A failed PUT rolls back to the previous snapshot.
@Observable
@MainActor
final class NotificationPreferencesViewModel {
    private(set) var state: ViewState<NotificationPreferencesResponse> = .idle

    private let apiClient: APIClient

    init(apiClient: APIClient) { self.apiClient = apiClient }

    // MARK: - Load

    /// Initial / pull-to-refresh load. Keeps the existing snapshot
    /// visible while reloading so a refresh doesn't flash an empty
    /// spinner.
    func load() async {
        if case .loaded = state {} else { state = .loading }
        do {
            let res = try await apiClient.send(.notificationPreferences())
            state = .loaded(res)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.localizedMessage)
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    // MARK: - Per-type push toggle

    /// Flip the `push_enabled` flag for a single type. Optimistic — the
    /// row updates immediately and we revert on server failure so the
    /// user never sees a permanent state that doesn't exist server-side.
    func setPushEnabled(_ enabled: Bool, for type: String) async {
        guard case .loaded(let original) = state else { return }
        guard original.preferences.contains(where: { $0.type == type }) else {
            return
        }
        // `NotificationPreference.preferences` is a `let` (decoded model),
        // so we rebuild the array by mapping rather than mutating in place.
        let newPrefs = original.preferences.map { pref -> NotificationPreference in
            guard pref.type == type else { return pref }
            return NotificationPreference(
                type: pref.type,
                push_enabled: enabled,
                email_enabled: pref.email_enabled,
                in_app_enabled: pref.in_app_enabled
            )
        }
        let snapshot = NotificationPreferencesResponse(
            preferences: newPrefs,
            quiet_hours_start: original.quiet_hours_start,
            quiet_hours_end: original.quiet_hours_end
        )
        state = .loaded(snapshot)

        do {
            _ = try await apiClient.send(.updateNotificationPreference(
                type: type,
                pushEnabled: enabled
            ))
        } catch is CancellationError {
            // Cancellation isn't an error: don't roll back, the next
            // load() will reconcile.
            return
        } catch {
            // Roll back — server still considers the previous value the
            // truth, and we don't want to leave the UI lying.
            state = .loaded(original)
        }
    }

    // MARK: - Quiet hours

    /// Convenience accessor — `true` when the response carries a
    /// non-nil pair. The view binds the master toggle to this.
    var quietHoursEnabled: Bool {
        guard case .loaded(let res) = state else { return false }
        return res.quiet_hours_start != nil && res.quiet_hours_end != nil
    }

    /// Current start hour (0..23). Returns 22 as a sensible default
    /// when quiet-hours is off so the DatePicker has something to
    /// show when the user toggles the feature on.
    var quietHoursStart: Int {
        if case .loaded(let res) = state, let s = res.quiet_hours_start {
            return s
        }
        return 22
    }

    /// Current end hour (0..23). Defaults to 8 (a.m.) for the same
    /// reason as `quietHoursStart`.
    var quietHoursEnd: Int {
        if case .loaded(let res) = state, let e = res.quiet_hours_end {
            return e
        }
        return 8
    }

    /// Toggle the master quiet-hours switch. Off → send `null/null`
    /// to clear. On → send the current pair (defaults if previously
    /// cleared). Optimistic + rollback.
    func setQuietHoursEnabled(_ enabled: Bool) async {
        guard case .loaded(let original) = state else { return }
        let newStart: Int? = enabled ? quietHoursStart : nil
        let newEnd: Int? = enabled ? quietHoursEnd : nil
        let snapshot = NotificationPreferencesResponse(
            preferences: original.preferences,
            quiet_hours_start: newStart,
            quiet_hours_end: newEnd
        )
        state = .loaded(snapshot)

        do {
            _ = try await apiClient.send(.updateQuietHours(start: newStart, end: newEnd))
        } catch is CancellationError {
            return
        } catch {
            state = .loaded(original)
        }
    }

    /// Update the start hour while quiet-hours is on. Caller passes
    /// the hour component (0..23) of the DatePicker's value. Optimistic
    /// + rollback on failure.
    func setQuietHoursStart(_ hour: Int) async {
        guard case .loaded(let original) = state else { return }
        // Don't fire a PUT when the feature is off — the master toggle
        // is the only way to set the window from `nil`.
        guard original.quiet_hours_start != nil else { return }
        let snapshot = NotificationPreferencesResponse(
            preferences: original.preferences,
            quiet_hours_start: hour,
            quiet_hours_end: original.quiet_hours_end
        )
        state = .loaded(snapshot)

        do {
            _ = try await apiClient.send(.updateQuietHours(
                start: hour,
                end: original.quiet_hours_end
            ))
        } catch is CancellationError {
            return
        } catch {
            state = .loaded(original)
        }
    }

    /// Update the end hour while quiet-hours is on. Same shape as
    /// `setQuietHoursStart`.
    func setQuietHoursEnd(_ hour: Int) async {
        guard case .loaded(let original) = state else { return }
        guard original.quiet_hours_end != nil else { return }
        let snapshot = NotificationPreferencesResponse(
            preferences: original.preferences,
            quiet_hours_start: original.quiet_hours_start,
            quiet_hours_end: hour
        )
        state = .loaded(snapshot)

        do {
            _ = try await apiClient.send(.updateQuietHours(
                start: original.quiet_hours_start,
                end: hour
            ))
        } catch is CancellationError {
            return
        } catch {
            state = .loaded(original)
        }
    }
}
