import Foundation

// MARK: - Notification preferences models
//
// Per-type push/email/in-app toggles + a global quiet-hours window.
// The backend (`/api/v1/me/notification-preferences`) is the source of
// truth: it always returns the full 8-row list (one entry per
// `NotificationType`) so the iOS view never has to invent placeholder
// rows when the user hasn't overridden anything yet.
//
// Schema note: the API encodes quiet-hours as integer HOURS (0..23) plus
// a `null` for "off", not as wall-clock strings. The view converts to a
// `Date` for the iOS `DatePicker(.hourAndMinute)` and back, so the
// network layer stays a literal mirror of the server contract.
//
// Kept in a dedicated file (not merged into the central `Endpoint.swift`)
// per the project convention for Privacy / Sessions / Referrals.

/// One row in the preferences response. Maps 1:1 with the backend's
/// `PreferenceView`. The server always returns 8 entries — one per known
/// `NotificationType` — so the view can render the full list without
/// conditionally hiding rows.
struct NotificationPreference: Decodable, Equatable, Identifiable {
    /// Server-side notification type. We use `String` rather than a
    /// closed Swift enum so a future backend addition doesn't break
    /// decoding — the row simply renders with a fallback label.
    let type: String
    let push_enabled: Bool
    let email_enabled: Bool
    let in_app_enabled: Bool

    var id: String { type }
}

/// Full response envelope for `GET /api/v1/me/notification-preferences`.
/// `quiet_hours_start` / `quiet_hours_end` are HOUR-OF-DAY integers
/// (0..23) in UTC; both `nil` means quiet hours are disabled.
struct NotificationPreferencesResponse: Decodable, Equatable {
    let preferences: [NotificationPreference]
    let quiet_hours_start: Int?
    let quiet_hours_end: Int?
}

// MARK: - Endpoints

extension Endpoint where Response == NotificationPreferencesResponse {
    /// GET /api/v1/me/notification-preferences — read the caller's full
    /// preference set + quiet-hours window.
    static func notificationPreferences() -> Endpoint<NotificationPreferencesResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/me/notification-preferences",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    /// PATCH /api/v1/me/notification-preferences — flip a single channel
    /// (push/email/in-app) for one notification type. Missing channel
    /// keys are preserved server-side. Returns 204 on success.
    ///
    /// We only surface `push_enabled` from the view (the screen is a
    /// "push prefs" screen), but the body parameters cover all three
    /// channels so future UI can patch without touching this signature.
    static func updateNotificationPreference(
        type: String,
        pushEnabled: Bool? = nil,
        emailEnabled: Bool? = nil,
        inAppEnabled: Bool? = nil
    ) -> Endpoint<EmptyResponse> {
        var body: [String: Any] = ["type": type]
        if let pushEnabled  { body["push_enabled"] = pushEnabled }
        if let emailEnabled { body["email_enabled"] = emailEnabled }
        if let inAppEnabled { body["in_app_enabled"] = inAppEnabled }
        return Endpoint(method: .patch,
                        path: "/api/v1/me/notification-preferences",
                        body: try? JSONSerialization.data(withJSONObject: body),
                        requiresAuth: true)
    }

    /// PUT /api/v1/me/notification-preferences/quiet-hours — set or
    /// clear the global quiet-hours window. Both fields must be set
    /// together OR both `nil` (server-side `ValidationError` otherwise).
    /// Returns 204 on success.
    static func updateQuietHours(start: Int?, end: Int?) -> Endpoint<EmptyResponse> {
        // NSNull is the right way to send a JSON `null` via
        // `JSONSerialization` — passing `nil` would drop the key, and
        // the backend treats "missing key" differently from "explicit
        // null" (we need explicit null to clear the window).
        let body: [String: Any] = [
            "quiet_hours_start": start.map { $0 as Any } ?? NSNull(),
            "quiet_hours_end": end.map { $0 as Any } ?? NSNull(),
        ]
        return Endpoint(method: .put,
                        path: "/api/v1/me/notification-preferences/quiet-hours",
                        body: try? JSONSerialization.data(withJSONObject: body),
                        requiresAuth: true)
    }
}
