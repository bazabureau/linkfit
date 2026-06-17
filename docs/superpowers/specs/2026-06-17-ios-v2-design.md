# Linkfit iOS v2 — Design Spec

> **Status**: Approved 2026-06-17. Source of truth for the `apps/iosv2` build.
> Supersedes nothing — `apps/ios` (v1) stays untouched and shipping.

## 0. Goal & constraints

Build a clean-slate, production-grade iOS client (`apps/iosv2`) for Linkfit — the
padel community + court-booking product for Azerbaijan — with ideal architecture,
security, and a design that **matches the website's visual identity, expressed the
native iOS / SwiftUI way** (not a literal web port).

Hard constraints:

- **Do not touch `apps/ios` (v1).** Everything new lives under `apps/iosv2`.
- **Reuse the existing live backend** `https://api.linkfit.az` (Laravel) with the
  **identical wire contract** — no backend changes. snake_case JSON, error envelope
  `{ "error": { "code", "message", "request_id" } }`, JWT access (15min) + opaque
  rotating refresh.
- **Scope of this build = the core loop**: Foundation → Auth → Home feed → Games
  (discover / create / join / detail) → Venues + Booking → Profile → Chat (1:1,
  realtime). The remaining ~36 v1 modules are explicitly out of scope for now and
  will be added later on the same rails.
- iOS **18.0+**, **Swift 6** strict concurrency, warnings-as-errors.
- Bundle id **`az.linkfit.v2`** so v2 installs alongside v1 during development.
  Graduates to `az.linkfit` at cutover.

## 1. Architecture — Modular SPM + Observation MVVM

A thin app target plus one local Swift Package with strict, compile-enforced module
boundaries.

```
apps/iosv2/
  project.yml                 # XcodeGen — same tooling as v1
  Linkfit2.xcodeproj          # generated, git-ignored
  App/
    LinkfitApp.swift          # @main, composition root
    AppContainer.swift        # DI container — builds & owns dependencies
    RootView.swift            # splash → auth gate → main tabs
    Info / entitlements / xcconfig
  LinkfitPackage/
    Package.swift
    Sources/
      AppCore/        # EnvConfig, AppLog (OSLog), Haptics, Analytics facade, Clock
      Models/         # Codable DTOs + domain types — depends on NOTHING
      Networking/     # APIClient, Endpoint, APIError, TokenRefresher, SSEClient, pinning
      Persistence/    # KeychainStore, TokenStore, ImageCache, Defaults
      DesignSystem/   # tokens + components — NO business logic
      FeatureAuth/
      FeatureHome/
      FeatureGames/
      FeatureVenues/
      FeatureProfile/
      FeatureChat/
    Tests/            # Swift Testing (@Test) per module
```

### 1.1 Dependency rule (the core of "ideal architecture")

Allowed dependency directions (a module may only import modules **below** it):

```
App  →  Feature*  →  DesignSystem, Networking, Persistence
                  →  Models, AppCore
Networking, Persistence  →  Models, AppCore
DesignSystem  →  AppCore        (localization/format only)
Models, AppCore  →  (nothing — leaf modules)
```

- **Features never import each other.** Cross-feature navigation flows through a
  `Router` (a protocol of intent-emitting closures) injected from the app layer.
- Each feature compiles, previews, and unit-tests in isolation.
- This makes it impossible to accidentally couple, e.g., Games into Profile.

### 1.2 Per-screen flow

```
View (SwiftUI)
  └─ observes @Observable ViewModel
        └─ calls a Repository protocol (e.g. GamesRepository)
              └─ uses APIClient + caches via Persistence
```

- ViewModels are `@MainActor @Observable`, expose a small `ViewState` (loading /
  loaded / empty / error), and own no UIKit/SwiftUI imports beyond `Observation`.
- Repositories are **protocols** with a live impl (in the package) and a mock impl
  (in tests). Injected via the container — no singletons in feature code.
- Full `Sendable` correctness, async/await throughout, no completion handlers.

## 2. Networking

- `protocol APIClient { func send<T: Decodable>(_:) async throws -> T }` plus
  `URLSessionAPIClient` implementation.
- `Endpoint` value type: `method`, `path`, `query`, `body`, `requiresAuth`.
  Endpoints declared per-domain (e.g. `Endpoint.Games.list(...)`).
- Decodes the standard success payload; maps the error envelope to a typed
  `APIError` (`.unauthorized`, `.validation([field:msg])`, `.server(code,msg)`,
  `.network`, `.decoding`). Surfaces `request_id` for support.
- **TokenRefresher**: an `actor` performing single-flight refresh. On a 401, one
  refresh attempt → retry the original request once; on refresh failure → emit a
  logout intent. Honors the backend's refresh rotation / family-revoke.
- **SSEClient**: long-lived `URLSession.bytes` stream against
  `GET /api/v1/realtime/sse` for chat + notifications; auto-reconnect with backoff.
- **Multipart upload** helper for avatar / chat images.
- JSON: `keyDecodingStrategy = .convertFromSnakeCase`, ISO8601 dates with a
  fractional-seconds fallback.

## 3. Security

- **Keychain** for access + refresh tokens
  (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). Never UserDefaults.
- **TLS public-key pinning** for `api.linkfit.az` via `URLSessionDelegate`
  (`urlSession(_:didReceive:)`), with a documented pin-rotation note. Pins live in
  config, not hard-coded literals scattered in code.
- **ATS strict**: HTTPS-only, no arbitrary loads, no exception domains.
- **Optional Face ID / Touch ID app-lock** (LocalAuthentication) gating app
  foreground, plus a privacy overlay when the app backgrounds (snapshot privacy).
- **Secrets** (Sentry DSN, PostHog key, Google client id, cert pins) injected via
  `.xcconfig` + CI env — never committed. Empty defaults make facades no-op in dev.
- **Sign in with Apple** (AuthenticationServices) + **Google** (GoogleSignIn).
- **Logging hygiene**: `OSLog` with `privacy: .private` on anything user-derived;
  tokens/PII never logged.

## 4. Design system — "Meydan native"

Port the web "Meydan" tokens to Swift, re-expressed with native iOS primitives.
Tokens are the single source of truth — no raw colors/sizes in feature code.

### 4.1 Color tokens (adaptive light / dark)

| Token | Light | Dark |
|-------|-------|------|
| `background` | `#FFFFFF` | `#0A0D12` |
| `canvas` | `#F3F5FA` | `#0A0D12` |
| `surface` | `#F3F5FA` | `#12161F` |
| `surface2` | `#E9EDF7` | `#1A1F2B` |
| `card` | `#FFFFFF` | `#12161F` |
| `border` | `#E7EAF3` | `#232A39` |
| `borderStrong` | `#D6DCEC` | `#303849` |
| `textPrimary` | `#0B1020` | `#F4F6FB` |
| `textMuted` | `#4D5478` | `#A3ABCE` |
| `textDim` | `#868EB2` | `#757DA6` |
| `accent` (royal blue) | `#5662D9` | `#5662D9` |
| `accentSoft` | `#6E79E2` | `#6E79E2` |
| `accentDeep` | `#3F4AC0` | `#3F4AC0` |
| `lime` | `#C5F235` | `#C5F235` |
| `ink` (dark surfaces) | `#0E1116` | `#0E1116` |
| `courtInk` (photo navy) | `#07101B` | `#07101B` |
| state: `danger / warning / success / info` | semantic | semantic |
| `medalGold / Silver / Bronze` | rank only | rank only |

Lime is brand-mark + rare highlight only; royal blue carries all interactive
meaning (accent budget ≤ 3 surfaces per screen).

### 4.2 Typography

- **SF Pro + Dynamic Type** for all product UI (HIG-correct, accessible).
- **Plus Jakarta Sans** reserved for the wordmark / large hero display only, to
  echo the site's character. Bundled as a font resource.
- Sentence case everywhere. **Banned: uppercase, letter tracking.**
- Scale: hero 28 heavy · section 18 heavy · card title 15 heavy · body 14–16 ·
  caption 12 semibold · micro pill 11 heavy.

### 4.3 Depth, radius, spacing

- `.dsCard()` = card fill + two-layer soft shadow (web `shadow-card`:
  `0 1px 2px rgba(11,16,32,.04)` + `0 10px 24px -12px rgba(11,16,32,.12)`).
  Dark mode: tone + 1px border instead of shadow.
- Capsule CTAs with blue-tinted `shadow-cta`. Continuous corner radii: card 20,
  button 16 / capsule, sheet 26.
- Spacing scale: `2 4 6 8 10 12 14 16 20 24 28 32 40 56`. Section gaps 24–32,
  card padding 14–18, page margins 16–20.
- Atmosphere: faint court-net hairline grid + very low-opacity radial tints only.
  **No glow, no mesh gradients, no per-card accent colors.** Honors Reduce Motion.

### 4.4 Component inventory (Phase 0)

`DSCard`, `PrimaryButton` (blue capsule), `AccentButton` (lime), `SecondaryButton`
(bordered tonal), `Eyebrow` (dot + sentence label), `SectionHeader`, `Chip`
(selected = accent capsule + white label), `FloatingTextField`, `EmptyStateView`
(muted icon circle + pill CTA), `Avatar`, `Skeleton`, `Badge`, `Toast`,
`AppBackground` (adaptive canvas), `LogoWordmark`.

## 5. App shell & cross-cutting

- Native `TabView`: **Home · Games · Book · Chat · Profile**. Visible labels,
  Liquid-Glass chrome (iOS 18+ where available), `DSColor.accent` tint.
- `NavigationStack` **inside each tab** with a typed `Route` enum; native
  `.navigationTitle` + `.toolbar` — no custom top bars.
- `RootView`: in-app splash (wordmark + tagline, ~850ms, Reduce-Motion aware) →
  auth gate (Keychain session check) → main tabs.
- **Localization**: `Localizable.xcstrings`, **az (source) / en / ru**, every
  user-facing string. No `state:"new"` keys merged.
- **Realtime**: SSE client for chat/notifications.
- Analytics + crash facades stubbed (no-op without keys). Push + deep-link seams
  scaffolded for later phases (no full implementation in this build).

## 6. Testing

- **Swift Testing** (`@Test`, `#expect`) per module.
- ViewModels tested against mock repositories (state transitions:
  loading→loaded→empty→error).
- Networking tested via a stub `URLProtocol` (envelope decode, 401→refresh→retry,
  error mapping).
- Single integration `xcodebuild` per phase; signed simulator builds only.

## 7. Build sequence (phases)

0. **Scaffold** — XcodeGen project, `LinkfitPackage` with all module targets +
   dependency graph, `AppContainer` DI, `RootView` + tab shell, DesignSystem
   tokens + Phase-0 components, Networking layer (APIClient, Endpoint, APIError,
   TokenRefresher, SSE skeleton, pinning), Persistence (Keychain/TokenStore),
   localization catalog. Green build, app boots to a placeholder shell.
1. **Auth** — login / register / forgot / reset + Apple & Google, wired live;
   Keychain session, refresh, logout.
2. **Home** — greeting + feed sections (next game, nearby games, quick actions).
3. **Games** — discover list + filters, create flow, detail, join/leave.
4. **Venues + Booking** — venue list/detail, date strip + slot grid + summary,
   create booking, my bookings.
5. **Profile** — profile header + stats, edit, settings, sign out, account.
6. **Chat** — conversation list, 1:1 thread, send text/image, SSE realtime.

Each phase: build → Swift Tests → manual sim check → proceed.

## 8. Decisions locked

- Bundle id `az.linkfit.v2` (dev coexistence).
- Lime `#C5F235` (web value) — supersedes v1's `#DCF166` for site consistency.
- SF Pro for product UI; Plus Jakarta Sans for wordmark/hero display only.
- Backend unchanged; v2 is a client rewrite against the live contract.
