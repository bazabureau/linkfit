import Foundation
import UIKit
import UserNotifications

/// Coordinates the iOS-side push lifecycle:
///  1. Ask the user for permission (once, on first AuthGate exit / first
///     post-login HomeView appearance).
///  2. Call `UIApplication.registerForRemoteNotifications()` so APNs hands
///     us a device token.
///  3. Forward that token (hex) to `/api/v1/me/devices`.
///  4. Retry the registration when the user signs back in after auth-loss.
///
/// The component is an `actor` so the "have we already pushed this token?"
/// state can be shared across the AppDelegate callback and the post-login
/// task without locks.
actor PushRegistrar {
    /// Current authorization status — useful for surfacing "Notifications
    /// off → go to Settings" affordances later. We poll on each `start()`
    /// since the user can toggle in Settings while the app is suspended.
    private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    /// The most recent device token (hex) we've successfully sent to the
    /// API. Used to short-circuit duplicate POSTs when iOS re-delivers the
    /// same token across cold-starts.
    private var lastRegisteredToken: String?

    private let apiClient: any APIClient
    private weak var application: UIApplication?

    init(apiClient: any APIClient, application: UIApplication? = nil) {
        self.apiClient = apiClient
        self.application = application
    }

    /// Entry point — call this immediately after the user lands on the
    /// authenticated shell. Idempotent: if the user previously denied, we
    /// don't pester them again (system will return `.denied`); if they
    /// granted, we silently re-trigger APNs registration so a token
    /// rotation gets picked up.
    func start() async {
        let center = UNUserNotificationCenter.current()
        let current = await center.notificationSettings()
        self.authorizationStatus = current.authorizationStatus

        // First run: ask once.
        if current.authorizationStatus == .notDetermined {
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
                if !granted {
                    // Soft fallback path — app must keep working without push.
                    self.authorizationStatus = .denied
                    return
                }
                self.authorizationStatus = .authorized
            } catch {
                // Authorization can fail in rare cases (parental controls).
                // Treat as denied; never crash.
                self.authorizationStatus = .denied
                return
            }
        }

        // Don't kick remote registration if the user has actively said no.
        guard authorizationStatus == .authorized || authorizationStatus == .provisional || authorizationStatus == .ephemeral else {
            return
        }

        // `application` is actor-isolated; capture into a local before
        // hopping to the main actor to call the UIKit API.
        let app = self.application
        await MainActor.run {
            (app ?? UIApplication.shared).registerForRemoteNotifications()
        }
    }

    /// Invoked from the AppDelegate when APNs hands us a fresh token.
    /// Sends the hex-encoded token to the API. On auth-lost we drop the
    /// in-memory cache so the next successful login re-uploads it.
    func didReceiveDeviceToken(_ data: Data) async {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        if hex.isEmpty { return }
        if hex == lastRegisteredToken { return }

        do {
            _ = try await apiClient.send(Endpoint<DeviceTokenResponse>.registerDevice(token: hex, platform: "ios"))
            lastRegisteredToken = hex
        } catch APIError.unauthorized {
            // The APIClient already cleared the session; the next sign-in
            // will call `start()` again which will re-register and re-send.
            lastRegisteredToken = nil
        } catch {
            // Transient failure — leave `lastRegisteredToken` unset so the
            // next `start()` retries on its own.
            lastRegisteredToken = nil
        }
    }

    /// Called when iOS reports a registration failure (no network, no
    /// entitlement, etc). Soft-fail: log nothing user-visible.
    func didFailToRegister(_ error: Error) {
        _ = error
        // Intentionally swallow — push is best-effort.
    }

    /// Forget the cached token so the next successful auth re-uploads it.
    func reset() {
        lastRegisteredToken = nil
    }
}

/// Response shape from `POST /api/v1/me/devices`.
struct DeviceTokenResponse: Decodable, Equatable {
    let id: String
    let token: String
    let platform: String
    let last_seen: String
    let created_at: String
}
