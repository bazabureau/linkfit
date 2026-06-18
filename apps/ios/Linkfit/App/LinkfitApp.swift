import SwiftUI
import UIKit
import GoogleSignIn

@main
struct LinkfitApp: App {
    // Initialize crash + error reporting before any other state. The Sentry
    // SDK has to install its signal handlers before SwiftUI spins up so
    // crashes during early app boot are captured. A nil/empty DSN is a no-op
    // (see `CrashReporter.swift`), so this is safe in dev/CI without a
    // configured Sentry project.
    //
    // The DSN is read from the `SENTRY_DSN` Info.plist key (substituted at
    // build time from the env var of the same name — see `project.yml`) with
    // a process-env fallback so ad-hoc `xcrun` runs and CI jobs can override
    // without rebuilding.
    private static let _crashReporterInit: Void = {
        let dsn = Bundle.main.object(forInfoDictionaryKey: "SENTRY_DSN") as? String
            ?? ProcessInfo.processInfo.environment["SENTRY_DSN"]
        CrashReporter.start(dsn: dsn)
    }()

    // MARK: - Analytics
    //
    // Initialize PostHog product analytics. Reads `POSTHOG_API_KEY` and
    // `POSTHOG_HOST` from Info.plist (substituted at build time from the
    // matching env vars — see `project.yml`), falling back to process
    // env for ad-hoc CLI runs. A nil/empty key makes
    // `Analytics.start(...)` a no-op (see `Core/Analytics/Analytics.swift`)
    // so dev/CI builds without a configured PostHog project still boot
    // cleanly. Runs as a static `let` so the SDK is configured exactly
    // once before any SwiftUI view tracks an event.
    private static let _analyticsInit: Void = {
        let apiKey = Bundle.main.object(forInfoDictionaryKey: "POSTHOG_API_KEY") as? String
            ?? ProcessInfo.processInfo.environment["POSTHOG_API_KEY"]
        let host = Bundle.main.object(forInfoDictionaryKey: "POSTHOG_HOST") as? String
            ?? ProcessInfo.processInfo.environment["POSTHOG_HOST"]
        Analytics.start(apiKey: apiKey, host: host)
    }()

    @State private var container = AppContainer.live()
    @State private var language = LanguageManager()
    @State private var theme = ThemeManager()
    /// App-wide version gate. Owned at the top of the view tree so
    /// the force-update `.fullScreenCover` covers every screen
    /// (splash, onboarding, auth, home) — the user can't slip past
    /// the gate by reaching any specific feature. Rebound to the
    /// real `container.apiClient` on first appear; the placeholder
    /// here is fine because we never `check()` before `.task` runs.
    @State private var versionGate = VersionGateModel(
        apiClient: VersionGatePlaceholderClient()
    )
    // SwiftUI's only supported hook into UIKit lifecycle — required for
    // APNs `didRegisterForRemoteNotificationsWithDeviceToken`.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        _ = Self._crashReporterInit
        // Analytics init — distinct line from crash reporter so the two
        // agents (W10-13 + W10-Analytics) can edit independently without
        // touching the same call.
        _ = Self._analyticsInit
        // Apply global UIKit appearance (nav bar + tab bar) BEFORE any
        // SwiftUI view is constructed. Previously this lived inside
        // `HomeView.onAppear`, which meant screens presented before
        // home loaded (deep links, the launch splash, sheets) could
        // render with the system-default (white) chrome and then snap
        // into the lime-glass style — and `scrollEdgeAppearance` could
        // fall through to the iOS 17 transparent default, which is
        // the "nav bar background disappears" report.
        AppearanceBootstrap.configure()
        // TipKit datastore + display-frequency policy. `Tips.configure`
        // must run exactly once per process and before any `Tip` value
        // is constructed, so the call site is here in `App.init` rather
        // than deeper in the view tree. See `Core/Tips/LinkfitTips.swift`
        // for the four registered tips and the wiring TODO list.
        LinkfitTipsRegistry.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .overlay(alignment: .top) { ReachabilityBanner() }
                .environment(container)
                .environment(language)
                .environment(theme)
                .environment(versionGate)
                .environment(\.locale, language.current.locale)
                .preferredColorScheme(theme.resolved)
                .animation(.easeInOut(duration: 0.25), value: theme.mode)
                .fullScreenCover(isPresented: $versionGate.isForceUpdateRequired) {
                    // Root-level cover so the blocker overlays
                    // splash, onboarding, auth and home alike —
                    // wherever the user happens to be when the
                    // probe resolves to "below floor".
                    VersionGateBlocker(appStoreURL: versionGate.appStoreURL)
                }
                // Global snackbar layer — `ToastCenter.shared` from
                // anywhere in the tree slides a non-blocking message
                // in over the bottom inset. Mounted at the scene root
                // so it survives tab switches and stays above feature
                // navigation. Applied after the force-update cover so
                // the cover, when shown, still sits visually on top.
                .toastHost()
                // Review-prompt bridge — observes
                // `ReviewPromptCoordinator.shared.shouldPrompt` and
                // dispatches the iOS 18 `requestReview` environment
                // action when eligibility logic flips the flag. Mounted
                // at the scene root so feature code can fire
                // `recordPositiveMoment()` from anywhere without
                // re-wiring the modifier deeper in the tree.
                .reviewPromptHost()
                .task {
                    // Hand the AppDelegate a reference to the registrar so the
                    // APNs token callback can forward to the API. Safe to
                    // overwrite on each appear — `PushRegistrar` is idempotent.
                    appDelegate.registrar = container.pushRegistrar
                    // Rebind the version gate to the real API
                    // client now that the container is in scope,
                    // then run the launch probe. Both calls are
                    // idempotent — re-runs on view re-appear are
                    // safe.
                    versionGate = VersionGateModel(apiClient: container.apiClient)
                    await versionGate.check()
                    // Kick off the in-app notification-toast bridge. Idempotent
                    // — subsequent invocations short-circuit while the
                    // pump is alive (see `InAppNotificationNotifier.start`).
                    InAppNotificationNotifier.shared.start(realtime: container.realtime)
                    // If the user previously signed in with Apple, ask the
                    // system whether that authorization is still valid. When
                    // they tapped "Stop using" in iOS Settings the call
                    // returns `.revoked` and we tear down our session so the
                    // app doesn't sit on a half-authenticated state until
                    // their next API request happens to 401. No-op for
                    // email/password or Google users.
                    await container.refreshAppleCredentialStateIfNeeded()
                }
                // Universal Links + `linkfit://` custom-scheme inbox. The
                // URL router stashes the parsed destination as
                // `pendingDestination` and the navigation layer consumes it
                // once mounted. Today the consume is not wired here —
                // HomeView will pull it on appear once parallel refactor
                // work there settles. The router is `@Observable`, so
                // HomeView can switch to `.onChange` on
                // `URLDeepLinkRouter.shared.pendingDestination` without
                // further changes here. See
                // `Core/DeepLinks/DeepLinkRouter.swift` for the parser and
                // the AASA / `applinks:linkfit.app` entitlement note. (The
                // separate push-payload `DeepLinkRouter` in
                // `Core/Push/DeepLink.swift` handles APNs taps and is
                // intentionally untouched here.)
                .onOpenURL { url in
                    if GIDSignIn.sharedInstance.handle(url) {
                        return
                    }
                    URLDeepLinkRouter.shared.handle(url)
                }
                // Push the anonymized user id into the crash reporter
                // whenever the auth state flips. Server-side user UUID only —
                // never email/display name. Cleared on logout so events from
                // the public marketing flow don't get attributed to the
                // previous account. Idempotent and safe with no DSN (the
                // reporter short-circuits when uninitialized).
                .onChange(of: container.currentUser?.id) { _, newId in
                    if let id = newId {
                        CrashReporter.setUser(userId: id)
                    } else {
                        CrashReporter.clearUser()
                    }
                }
                .onAppear {
                    // Backfill on cold launch when the token store already has
                    // a valid session (re-launch of a logged-in app). The
                    // `onChange` above only fires on transitions.
                    if let id = container.currentUser?.id {
                        CrashReporter.setUser(userId: id)
                    }
                }
        }
    }
}

/// Stand-in `APIClient` used only to satisfy `VersionGateModel`'s
/// initializer before the real `AppContainer` is in scope. Calls
/// throw synchronously so any accidental probe before the rebind in
/// `.task` is a no-op rather than a crash.
private struct VersionGatePlaceholderClient: APIClient {
    func send<R: Decodable>(_ endpoint: Endpoint<R>) async throws -> R {
        throw APIError.offline
    }
    func uploadImage(imageData: Data, mimeType: String, filename: String) async throws -> UploadImageResponse {
        throw APIError.offline
    }
}
