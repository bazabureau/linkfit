import AuthenticationServices
import Foundation
import Observation

@Observable
@MainActor
final class AppContainer {
    private(set) var apiClient: APIClient
    let tokenStore: TokenStoring
    let pushRegistrar: PushRegistrar
    /// Single SSE connection shared across the app. View-models that need
    /// live updates call `realtime.subscribe()` to get their own stream.
    /// We start/stop it in lockstep with `isAuthenticated` so a logged-out
    /// shell doesn't keep an open socket against /api/v1/realtime/sse.
    let realtime: RealtimeClient
    var session: AuthSession?
    var currentUser: PublicUser?
    private(set) var isAuthenticated: Bool

    private init(apiClient: APIClient, tokenStore: TokenStoring, realtime: RealtimeClient) {
        self.apiClient = apiClient
        self.tokenStore = tokenStore
        self.pushRegistrar = PushRegistrar(apiClient: apiClient)
        self.realtime = realtime
        self.isAuthenticated = tokenStore.accessToken() != nil
        // If we already have a token at launch (re-launch of a logged-in
        // app), boot the SSE channel right away.
        if self.isAuthenticated {
            Task { await realtime.start() }
        }
    }

    static func live() -> AppContainer {
        let tokenStore = KeychainTokenStore(service: "az.linkfit.app.auth")
        let baseURL = Self.apiBaseURL()
        let realtime = RealtimeClient(baseURL: baseURL, tokenStore: tokenStore)
        let container = AppContainer(
            apiClient: URLSessionAPIClient(baseURL: baseURL, tokenStore: tokenStore),
            tokenStore: tokenStore,
            realtime: realtime
        )
        // Wire up the on-auth-lost callback after the container exists.
        if let client = container.apiClient as? URLSessionAPIClient {
            client.attachAuthDelegate { [weak container] in
                Task { @MainActor in container?.clearSession() }
            }
        }
        return container
    }

    private static func apiBaseURL() -> URL {
        // Resolution order (most specific wins):
        //   1. `LINKFIT_API_BASE_URL` env var — for dev runs from xcrun / scripts
        //   2. `APIBaseURL` Info.plist key — set by project.yml per build config
        //   3. Hard-coded production host so a fresh build talks to the real
        //      backend out of the box. Until we promote a real domain this is
        //      the DigitalOcean droplet — set the env override above to point
        //      at localhost during local API dev.
        let fallback = "http://142.93.100.82"
        let configured = ProcessInfo.processInfo.environment["LINKFIT_API_BASE_URL"]
            ?? Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String
            ?? fallback
        return URL(string: configured) ?? URL(string: fallback)!
    }

    func setSession(_ session: AuthSession) {
        try? tokenStore.save(access: session.access_token, refresh: session.refresh_token)
        self.session = session
        self.currentUser = session.user
        self.isAuthenticated = true
        // Boot the SSE channel as soon as we have a valid token.
        Task { await realtime.start() }
        // Analytics — tag every subsequent event with the user UUID so
        // PostHog can join cross-session funnels. We deliberately do
        // NOT pass the email or display name as traits — the contract
        // is "server-side UUID only" (see Core/Analytics/Analytics.swift).
        Analytics.identify(userId: session.user.id, traits: [
            "locale": Locale.current.identifier,
        ])
    }

    func updateCurrentUser(_ user: PublicUser) {
        currentUser = user
    }

    func clearSession() {
        try? tokenStore.clear()
        session = nil
        currentUser = nil
        isAuthenticated = false
        // Analytics — reset the distinct_id so events emitted between
        // logout and the next sign-in are not attributed to the
        // previous account. `Analytics.reset()` is a no-op when PostHog
        // is unconfigured.
        Analytics.reset()
        // Drop the cached Apple user identifier too — once we've cleared the
        // session there's nothing to check against on the next launch, and
        // leaving a stale ID around would cause `refreshAppleCredentialStateIfNeeded`
        // to query an account the user no longer wants tied to this device.
        AppleSignInService.clearStoredUserID()
        // Forget the cached device-token registration so the next sign-in
        // re-uploads it to the new account.
        Task { await pushRegistrar.reset() }
        // Drop the realtime channel so a logged-out shell doesn't churn
        // /api/v1/realtime/sse?token=<stale>.
        Task { await realtime.stop() }
    }

    /// Check Apple's records for the currently-stored Apple user identifier and
    /// force-log-out if the user revoked access via iOS Settings → Sign in with
    /// Apple → Linkfit → Stop Using. Called on every cold launch from
    /// `LinkfitApp.task`.
    ///
    /// Semantics of `ASAuthorizationAppleIDProvider.getCredentialState`:
    ///   - `.authorized` → still valid, do nothing.
    ///   - `.revoked` → user pulled access; we drop our session and surface a
    ///     toast so they know why they landed back on the login screen.
    ///   - `.notFound` → the Apple ID isn't bound on this device any more
    ///     (signed out of iCloud, fresh device, etc). Treat as revoked.
    ///   - `.transferred` → only applies to family-sharing transfers between
    ///     team IDs; safe to treat as "still valid", logout would be hostile.
    ///
    /// This is a no-op when the user signed in with email/password or Google —
    /// `storedUserID()` returns `nil` in that case. The Apple framework call
    /// itself is cheap (no network in the common case; it consults the local
    /// Sign-in-with-Apple daemon).
    func refreshAppleCredentialStateIfNeeded() async {
        guard let userID = AppleSignInService.storedUserID() else { return }
        guard isAuthenticated else { return }

        let provider = ASAuthorizationAppleIDProvider()
        let state: ASAuthorizationAppleIDProvider.CredentialState
        do {
            state = try await provider.credentialState(forUserID: userID)
        } catch {
            // Bridge errors typically mean "couldn't reach the daemon" — not
            // a revocation. Leave the session intact; the next launch will
            // try again. A user with a genuinely revoked credential will
            // also hit `.unauthorized` on their next API call, which
            // clearSession() via the auth delegate already handles.
            return
        }

        switch state {
        case .authorized, .transferred:
            return
        case .revoked, .notFound:
            clearSession()
            ToastCenter.shared.error(
                String(localized: "auth.apple.revoked.message")
            )
        @unknown default:
            return
        }
    }
}
