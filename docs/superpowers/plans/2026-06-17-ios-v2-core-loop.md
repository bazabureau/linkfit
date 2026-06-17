# Linkfit iOS v2 — Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clean-slate, production-grade iOS client at `apps/iosv2` (modular SPM + Observation MVVM) covering the core padel loop — Auth, Home, Games, Venues/Booking, Profile, Chat — against the live `https://api.linkfit.az` backend.

**Architecture:** Thin app target + one local Swift Package (`LinkfitPackage`) with compile-enforced module boundaries. Features depend down on DesignSystem/Networking/Models/AppCore, never on each other; cross-feature nav via an injected `Router`. Per screen: View → `@Observable` ViewModel → Repository protocol → APIClient. Swift 6 strict concurrency.

**Tech Stack:** Swift 6.3, iOS 18+, SwiftUI, Observation, XcodeGen, Swift Package Manager, Swift Testing, GoogleSignIn, AuthenticationServices, URLSession (async/await + SSE), Keychain.

**Spec:** `docs/superpowers/specs/2026-06-17-ios-v2-design.md`

---

## Conventions (apply to every task)

- **Build check (package):** `cd apps/iosv2/LinkfitPackage && swift build` — must succeed.
- **Test check (package):** `cd apps/iosv2/LinkfitPackage && swift test` — must pass.
- **App build:** `cd apps/iosv2 && xcodegen generate && xcodebuild -scheme Linkfit2 -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -derivedDataPath build build CODE_SIGNING_ALLOWED=YES` — green.
- **Commit** after each task with a conventional message. Branch: `ideal/core-loop-and-social` (already current).
- **No hardcoded user-facing strings** — `LocalizedStringKey` + `Localizable.xcstrings` (az/en/ru).
- **No raw colors/sizes** outside `DesignSystem`.
- xcodegen `project.yml` uses dir-glob → **regenerate after adding/removing files**.

---

## FROZEN CONTRACTS (do not change once Phase 0 lands — all features import these)

These signatures are the integration surface. Parallel feature work depends on them
being stable. Any change requires updating this section and all call sites.

```swift
// MARK: AppCore
public struct EnvConfig: Sendable {
    public let apiBaseURL: URL          // https://api.linkfit.az
    public let sentryDSN: String?
    public let posthogKey: String?
    public let googleClientID: String?
    public let certPins: [String]       // base64 SHA-256 SPKI pins (may be empty)
    public static func load(bundle: Bundle) -> EnvConfig
}

public enum AppLog {                     // OSLog wrapper, privacy-safe
    public static func debug(_ message: String, category: String)
    public static func error(_ message: String, category: String)
}

@MainActor public protocol Haptics: Sendable {
    func light(); func medium(); func selection(); func success(); func error()
}

// MARK: Models  (all Sendable, Codable, snake_case via decoder strategy)
public struct APIErrorEnvelope: Decodable, Sendable {
    public struct Body: Decodable, Sendable { public let code: String; public let message: String; public let requestID: String? }
    public let error: Body
}
// Domain DTOs (User, AuthTokens, Game, Venue, Court, BookingSlot, Booking,
// Conversation, Message, ProfileStats, Page<T>, …) declared in Models as needed
// per phase. Page<T> wraps list responses: { data: [T], meta: { ... } }.

// MARK: Networking
public enum HTTPMethod: String, Sendable { case get, post, put, patch, delete }

public struct Endpoint: Sendable {
    public let method: HTTPMethod
    public let path: String                       // "/api/v1/..."
    public var query: [String: String]
    public var body: (any Encodable & Sendable)?
    public var requiresAuth: Bool
    public init(method: HTTPMethod, path: String, query: [String:String] = [:],
                body: (any Encodable & Sendable)? = nil, requiresAuth: Bool = true)
}

public enum APIError: Error, Sendable, Equatable {
    case unauthorized
    case validation([String: String])             // field -> message
    case server(code: String, message: String, requestID: String?)
    case network(URLError)
    case decoding(String)
    case unknown
}

public protocol APIClient: Sendable {
    func send<T: Decodable & Sendable>(_ endpoint: Endpoint, as type: T.Type) async throws -> T
    func send(_ endpoint: Endpoint) async throws            // discardable, 2xx-only
    func upload(image data: Data, to path: String) async throws -> URL
}

public protocol TokenStoring: Sendable {                    // implemented in Persistence
    func currentAccessToken() async -> String?
    func tokens() async -> AuthTokens?
    func save(_ tokens: AuthTokens) async
    func clear() async
}

// MARK: Routing  (app injects concrete closures; features stay decoupled)
@MainActor public struct Router: Sendable {
    public var openGame: (String) -> Void
    public var openVenue: (String) -> Void
    public var openConversation: (String) -> Void
    public var openProfile: (String) -> Void
    public var requireAuthThen: (@escaping () -> Void) -> Void
}
```

---

## PHASE 0 — Foundation / Scaffold

Produces: a signed simulator app that boots → splash → (unauthenticated) shows a
placeholder shell, with the full module graph, design system, networking, and
Keychain in place and unit-tested.

### Task 0.1: Package skeleton + module graph

**Files:**
- Create: `apps/iosv2/LinkfitPackage/Package.swift`
- Create: empty `Sources/<Module>/Placeholder.swift` for each module
- Create: `apps/iosv2/.gitignore` (ignore `build/`, `*.xcodeproj`, `DerivedData/`, `.DS_Store`)

- [ ] **Step 1:** Write `Package.swift` declaring library products + targets with the
  dependency graph from the spec (§1.1). Targets: `AppCore`, `Models`,
  `Networking`(→Models,AppCore), `Persistence`(→Models,AppCore),
  `DesignSystem`(→AppCore), `FeatureAuth/Home/Games/Venues/Profile/Chat`
  (→DesignSystem,Networking,Persistence,Models,AppCore), plus matching `*Tests`.
  Platforms: `.iOS(.v18)`. Swift tools 6.0, `swiftLanguageModes: [.v6]`.
- [ ] **Step 2:** Add a `public let <module>Loaded = true` placeholder per module.
- [ ] **Step 3:** `swift build` → success. **Commit** `chore(iosv2): package skeleton + module graph`.

### Task 0.2: AppCore — config, logging, haptics, analytics facade

**Files:** `Sources/AppCore/{EnvConfig,AppLog,Haptics,Analytics,Clock}.swift`,
`Tests/AppCoreTests/EnvConfigTests.swift`

- [ ] Implement `EnvConfig.load(bundle:)` reading Info.plist keys
  (`API_BASE_URL`, `SENTRY_DSN`, `POSTHOG_API_KEY`, `GOOGLE_CLIENT_ID`, `CERT_PINS`),
  defaulting `apiBaseURL` to `https://api.linkfit.az`, pins split on comma.
- [ ] `AppLog` over `os.Logger` (subsystem = bundle id), `error`/`debug` with
  `.private` interpolation for dynamic args.
- [ ] `Haptics` protocol + `UIKitHaptics` impl (UINotification/Impact/Selection
  generators), `@MainActor`.
- [ ] `Analytics` facade: `start`, `track(_:props:)`, `identify` — no-op when key nil.
- [ ] Test: `EnvConfig.load` returns default base URL when key absent; parses pins.
- [ ] `swift test` AppCoreTests pass. **Commit** `feat(iosv2): AppCore foundation`.

### Task 0.3: Persistence — Keychain + TokenStore + Defaults + ImageCache

**Files:** `Sources/Persistence/{KeychainStore,TokenStore,Defaults,ImageCache}.swift`,
`Tests/PersistenceTests/TokenStoreTests.swift`

- [ ] `KeychainStore`: generic get/set/delete `Data` for a service+account,
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
- [ ] `TokenStore: TokenStoring` (actor) backed by Keychain, JSON-encodes `AuthTokens`.
- [ ] `Defaults`: typed UserDefaults wrapper (locale override, app-lock flag, onboarding seen).
- [ ] `ImageCache`: in-memory `NSCache` + disk (Caches dir) keyed by URL hash.
- [ ] Test: round-trip save/read/clear of `AuthTokens` via an in-memory keychain
  stub (protocol-injected backing store so tests don't hit real Keychain).
- [ ] `swift test` pass. **Commit** `feat(iosv2): Persistence (Keychain/TokenStore)`.

### Task 0.4: Networking — APIClient, Endpoint, APIError, refresh, pinning, SSE

**Files:** `Sources/Networking/{Endpoint,APIError,APIClient,URLSessionAPIClient,
TokenRefresher,PinningDelegate,SSEClient,JSON}.swift`,
`Tests/NetworkingTests/{APIClientTests,RefreshTests,ErrorMappingTests}.swift`

- [ ] `Endpoint`, `HTTPMethod`, `APIError` per frozen contract.
- [ ] `JSON`: shared `JSONEncoder`/`JSONDecoder` (`.convertFromSnakeCase`,
  ISO8601 + fractional fallback `DateDecodingStrategy`).
- [ ] `URLSessionAPIClient: APIClient`: builds `URLRequest` from `Endpoint`
  (base URL + path + query + JSON body), attaches `Authorization: Bearer` when
  `requiresAuth`, decodes `T` on 2xx, maps error envelope → `APIError`
  (401→`.unauthorized`, 422→`.validation`, else `.server`).
- [ ] `TokenRefresher` (actor): single-flight `POST /api/v1/auth/refresh`; client
  intercepts `.unauthorized`, refreshes once, retries; on failure posts a
  `logoutRequested` continuation (closure injected by app).
- [ ] `PinningDelegate: NSObject, URLSessionDelegate`: SPKI SHA-256 pinning when
  `certPins` non-empty; pass-through otherwise.
- [ ] `SSEClient`: `URLSession.bytes` line parser yielding `AsyncStream<SSEEvent>`,
  reconnect with capped exponential backoff.
- [ ] `upload(image:to:)`: multipart/form-data builder.
- [ ] Tests via stub `URLProtocol`: (a) decodes a typed success body;
  (b) 401 → refresh called once → original retried with new token;
  (c) 422 → `.validation` with field map; (d) 500 → `.server` carries `request_id`.
- [ ] `swift test` NetworkingTests pass. **Commit** `feat(iosv2): networking layer`.

### Task 0.5: DesignSystem — tokens

**Files:** `Sources/DesignSystem/Tokens/{DSColor,DSFont,DSRadius,DSSpacing,
DSShadow}.swift`, `Tests/DesignSystemTests/DSColorTests.swift`

- [ ] `DSColor`: every token from spec §4.1 as adaptive `Color(light:dark:)`
  (UIColor dynamic provider). Add `Color(hex:)` + `Color(light:dark:)` helpers.
- [ ] `DSFont`: SF Pro Dynamic Type roles (hero/section/cardTitle/body/caption/
  micro) + `LogoWordmark` display face hook (Plus Jakarta Sans if bundled, else SF).
- [ ] `DSRadius` (card 20, button 16, sheet 26), `DSSpacing` (scale array + named),
  `DSShadow` (`card`, `lift`, `cta` as `(color,radius,x,y)` tuples / ViewModifiers).
- [ ] Test: hex parsing produces expected RGBA for `#5662D9`.
- [ ] **Commit** `feat(iosv2): design tokens`.

### Task 0.6: DesignSystem — components

**Files:** `Sources/DesignSystem/Components/{DSCard,Buttons,Eyebrow,SectionHeader,
Chip,FloatingTextField,EmptyStateView,Avatar,Skeleton,Badge,Toast,AppBackground,
LogoWordmark}.swift`, plus `#Preview`s.

- [ ] `dsCard()` ViewModifier (fill + two-layer soft shadow light / tone+border dark).
- [ ] `PrimaryButton` (blue capsule + cta shadow + press scale + loading +
  `.medium` haptic), `AccentButton` (lime), `SecondaryButton` (bordered tonal).
- [ ] `Eyebrow` (dot + sentence label), `SectionHeader` (title + optional action).
- [ ] `Chip` (selected = accent capsule + white label), `FloatingTextField`
  (floating label, icon, secure toggle, inline error, tap-to-focus correct).
- [ ] `EmptyStateView` (muted icon circle + message + pill CTA), `Avatar`
  (async image + initials fallback via ImageCache), `Skeleton` (token shimmer,
  Reduce-Motion aware), `Badge`, `Toast` (transient overlay), `AppBackground`
  (adaptive canvas + faint court-net hairline), `LogoWordmark`.
- [ ] Each component compiles with a working `#Preview`. **Commit**
  `feat(iosv2): design components`.

### Task 0.7: Localization catalog

**Files:** `apps/iosv2/App/Resources/Localizable.xcstrings` (+ package resource if
features need shared keys), seed az/en/ru for shell + auth keys.

- [ ] Create `.xcstrings` with az (source), en, ru for: tabs, common buttons
  (save/cancel/retry/continue), auth keys, generic errors. No `state:"new"`.
- [ ] **Commit** `feat(iosv2): localization catalog`.

### Task 0.8: App target — XcodeGen, DI container, RootView, tab shell

**Files:** `apps/iosv2/project.yml`, `App/{LinkfitApp,AppContainer,RootView,
AppTabView,SplashView}.swift`, `App/Info.plist`, `App/Linkfit2.entitlements`,
`App/Config/{Debug,Release}.xcconfig`, `App/Resources/Assets.xcassets`

- [ ] `project.yml`: app target `Linkfit2`, bundle id `az.linkfit.v2`, iOS 18,
  Swift 6, warnings-as-errors, depends on `LinkfitPackage` products + GoogleSignIn;
  Info.plist keys mapped to `$(API_BASE_URL)` etc.; xcconfig per config.
- [ ] `AppContainer`: builds `EnvConfig`, `TokenStore`, `URLSessionAPIClient`
  (with pinning + refresher), `Haptics`, `Analytics`, `Router`, repositories.
  Exposes an `@Observable AppSession` (authState: `.checking/.signedOut/.signedIn(User)`).
- [ ] `LinkfitApp` (@main): builds container, injects via `.environment`.
- [ ] `RootView`: splash gate → switch on `AppSession.authState` →
  `AuthRootView` (Phase 1) or `AppTabView`.
- [ ] `AppTabView`: 5 tabs (Home/Games/Book/Chat/Profile), each a `NavigationStack`;
  Phase-0 placeholder screens using DesignSystem.
- [ ] `SplashView`: wordmark + tagline, ~850ms, Reduce-Motion aware.
- [ ] `AppearanceBootstrap`: UIKit appearance proxies for tab/nav chrome + accent tint.
- [ ] `xcodegen generate` → `xcodebuild` green on simulator, app boots to tabs.
- [ ] **Commit** `feat(iosv2): app shell, DI, tab scaffold`.

**Phase 0 acceptance:** `swift test` all green; signed sim build boots to a 5-tab
shell rendered with the Meydan design system; no networking calls yet succeed but
the layer + Keychain are wired and unit-tested.

---

## PHASE 1 — Auth (build by hand; it exercises the whole foundation)

Endpoints: `POST /api/v1/auth/{register,login,refresh,logout}`, `GET /api/v1/me`,
`POST /api/v1/auth/password/{forgot,reset}`, social: `POST /api/v1/auth/{apple,google}`.

### Task 1.1: Models + AuthRepository

**Files:** `Models/{User,AuthTokens,AuthRequests}.swift`,
`FeatureAuth/AuthRepository.swift` (+ `MockAuthRepository` in tests)

- [ ] `User`, `AuthTokens` (access, refresh, expiresAt), request bodies.
- [ ] `protocol AuthRepository`: `login`, `register`, `forgotPassword`,
  `resetPassword`, `signInApple(idToken:)`, `signInGoogle(idToken:)`, `me()`,
  `logout()`. Live impl uses `APIClient` + `TokenStore`.
- [ ] Tests: login success saves tokens; 422 surfaces field errors.
- [ ] **Commit** `feat(iosv2): auth repository`.

### Task 1.2: Auth screens

**Files:** `FeatureAuth/{AuthRootView,LoginView,RegisterView,ForgotPasswordView,
ResetPasswordView}.swift` + matching `@Observable` ViewModels + `AuthHeader`.

- [ ] Social-first layout (Apple + Google above email form), `FloatingTextField`,
  `PrimaryButton`, inline errors, localized. Wires `AppSession` on success.
- [ ] Apple via `ASAuthorizationController`; Google via `GoogleSignIn`.
- [ ] ViewModel tests against `MockAuthRepository` (validation, submit states).
- [ ] App build green; manual: register → land in tabs; logout → back to auth.
- [ ] **Commit** `feat(iosv2): auth flow`.

**Phase 1 acceptance:** real login/register against live backend; session persists
across launches (Keychain); 401 mid-session triggers refresh; logout clears.

---

## PHASES 2–6 — Feature builds (parallelizable; one subagent per Feature dir)

Each feature owns its `Feature<X>/` dir only. Shared rules: import frozen contracts;
add Models to `Models/`; report new xcstrings keys back for central insertion
(never edit `.xcstrings` in parallel); freeze view `init` signatures once declared;
no `xcodebuild` inside subagents — single integration build at the end of each phase.

### PHASE 2 — Home (`FeatureHome/`)
- Endpoints: `GET /api/v1/me`, `GET /api/v1/games?scope=upcoming&mine=1`,
  `GET /api/v1/games?scope=nearby`, (quick-action targets).
- Screens: `HomeView` (greeting → "your next game" card → nearby games carousel →
  quick actions row), `HomeViewModel` (ViewState), `HomeRepository`.
- Acceptance: feed loads from live API, empty/skeleton/error states, pull-to-refresh.

### PHASE 3 — Games (`FeatureGames/`)
- Endpoints: `GET /api/v1/games` (filters: sport/date/skill/city), `POST /api/v1/games`,
  `GET /api/v1/games/{id}`, `POST /api/v1/games/{id}/join`, `…/leave`.
- Screens: `GamesListView` + filter sheet, `CreateGameView` (multi-step form),
  `GameDetailView` (photo hero + roster + pinned join bar), ViewModels + `GamesRepository`.
- Acceptance: discover/filter, create, view detail, join/leave round-trip live.

### PHASE 4 — Venues + Booking (`FeatureVenues/`)
- Endpoints: `GET /api/v1/venues`, `GET /api/v1/venues/{id}`,
  `GET /api/v1/venues/{id}/availability?date=`, `POST /api/v1/bookings`,
  `GET /api/v1/me/bookings`.
- Screens: `VenuesListView` (photo showcase), `VenueDetailView`, booking flow
  (date strip → slot grid → sticky summary → confirm), `MyBookingsView`,
  ViewModels + `VenuesRepository`.
- Acceptance: browse venues, pick slot, create booking, see it in My Bookings live.

### PHASE 5 — Profile (`FeatureProfile/`)
- Endpoints: `GET /api/v1/me`, `PATCH /api/v1/me`, `POST /api/v1/me/avatar`,
  `GET /api/v1/me/stats`, `GET /api/v1/users/{id}`.
- Screens: `ProfileView` (header + stat capsules + inset-grouped settings),
  `EditProfileView`, `SettingsView` (locale, app-lock toggle, sign out, delete
  account entry), `PublicProfileView`, ViewModels + `ProfileRepository`.
- Acceptance: view/edit profile, change avatar, settings persist, sign out works.

### PHASE 6 — Chat (`FeatureChat/`)
- Endpoints: `GET /api/v1/conversations`, `GET /api/v1/conversations/{id}`,
  `GET /api/v1/conversations/{id}/messages`, `POST …/messages`,
  `POST /api/v1/messages/upload-image`, SSE `/api/v1/realtime/sse`.
- Screens: `ConversationsListView`, `ChatThreadView` (asymmetric-corner bubbles,
  composer always visible, image attach), ViewModels + `ChatRepository` + SSE wiring.
- Acceptance: list threads, open 1:1, send text + image, receive via SSE live.

**Final integration:** `xcodegen generate` → full simulator build green →
`swift test` green → manual smoke of each tab → update memory with v2 layout.

---

## Self-review (done)

- **Spec coverage:** architecture (Tasks 0.1–0.8), security/Keychain/pinning/refresh
  (0.3,0.4,1.1), design system (0.5,0.6), localization (0.7), shell (0.8), auth
  (Phase 1), and all six core-loop features (Phases 1–6) each map to tasks. ✓
- **Placeholders:** none — interfaces frozen above; per-task files/endpoints/accept
  criteria are concrete. Feature phases intentionally specify contracts + acceptance
  rather than line-by-line code, since each is owned by a dedicated executor working
  against the frozen surface (DRY: code lives once, in the feature, not duplicated here).
- **Type consistency:** `APIClient`, `Endpoint`, `APIError`, `TokenStoring`,
  `Router`, `AppSession.authState` names are used identically across phases. ✓
