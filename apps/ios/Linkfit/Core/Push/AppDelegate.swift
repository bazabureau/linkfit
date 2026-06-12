import Foundation
import UIKit
import UserNotifications

/// UIKit bridge required by APNs: SwiftUI alone has no hook for
/// `didRegisterForRemoteNotificationsWithDeviceToken`. The delegate is
/// attached via `@UIApplicationDelegateAdaptor` in `LinkfitApp.swift`.
///
/// All real work is delegated to `PushRegistrar` (token upload) and
/// `DeepLinkRouter` (tap routing) — this class is a thin shim so it stays
/// trivially reviewable.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, @preconcurrency UNUserNotificationCenterDelegate {
    /// Set by `LinkfitApp` once the AppContainer is alive. Optional because
    /// the AppDelegate is constructed by UIKit before SwiftUI runs.
    var registrar: PushRegistrar?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    // MARK: - APNs token plumbing

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        guard let registrar else { return }
        Task { await registrar.didReceiveDeviceToken(deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        guard let registrar else { return }
        Task { await registrar.didFailToRegister(error) }
    }

    // MARK: - Foreground / tap delivery

    /// Called when a push arrives while the app is in the foreground. We
    /// surface a banner + sound so users still see it; an alternative would
    /// be to suppress and rely on in-app toasts, but that fragments the UX.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list, .badge])
    }

    /// Called when the user taps a notification (or swipes from lock-screen).
    /// We do two things, in deliberate order:
    ///
    ///  1. Stash a typed `URLDeepLinkRouter.Destination` parsed from the
    ///     payload's identifier keys (`conversation_id`, `game_id`,
    ///     `follower_user_id`/`user_id`, `venue_id`) — this is what the
    ///     SwiftUI shell (HomeView) consumes on appear and turns into a
    ///     navigation push. Direct routing on tap: the whole point of the
    ///     deep-link change.
    ///  2. Broadcast the legacy `DeepLink` over the existing AsyncStream
    ///     so anything still listening on `DeepLinkRouter.shared.links`
    ///     continues to receive events. Kept for back-compat while the
    ///     URL router becomes the canonical consume point.
    ///
    /// `URLDeepLinkRouter.handle(userInfo:)` is best-effort: an unknown
    /// payload (no recognizable id) silently returns `false`, leaving the
    /// app on whatever screen the user already had — better than landing
    /// them on a "nothing happened" guess screen.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        let link = DeepLink.from(userInfo: userInfo)
        Task { @MainActor in
            URLDeepLinkRouter.shared.handle(userInfo: userInfo)
            DeepLinkRouter.shared.route(link)
            completionHandler()
        }
    }
}
