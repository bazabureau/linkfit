# Design: Mobile Release Engineering — Signing, Store Submission, Staged Rollout, Crash Reporting

Status: Draft (tech-lead proposal)
Owner: Mobile
Date: 2026-06-21
Scope: Flutter client `/Users/kamrannamazov/Desktop/LINKFITAPP` (repo `bazabureau/linkfit-flutter`, branch `main`), iOS + Android, against the live Laravel API `https://api.linkfit.az/api/v1`.

This doc is grounded in the current tree. File:line citations are to the Flutter repo unless noted.

---

## 1. Current state (what actually exists today)

### App identity / version
- `pubspec.yaml:20` → `version: 1.0.1+16` (build name 1.0.1, build number 16). This is the single source of truth; both platforms read it via Flutter (`android/app/build.gradle.kts:32-33` `versionCode = flutter.versionCode`, `versionName = flutter.versionName`; iOS `Info.plist` `CFBundleShortVersionString = $(FLUTTER_BUILD_NAME)`, `CFBundleVersion = $(FLUTTER_BUILD_NUMBER)`).
- No git tags exist (`git tag` empty). No release is anchored to a commit. HEAD is `8a1161f`.
- `android/local.properties` pins `flutter.buildMode=debug`, `flutter.versionName=1.0.1`, `flutter.versionCode=16` — this file is gitignored (`android/app/.gitignore`) and is a local-machine artifact, not a release input.

### Bundle identifiers — **MISMATCH (blocker)**
- Android `applicationId = az.linkfit.linkfit` and `namespace = az.linkfit.linkfit` (`android/app/build.gradle.kts:21,25`).
- iOS `PRODUCT_BUNDLE_IDENTIFIER = az.linkfit.app` (`ios/Runner.xcodeproj/project.pbxproj:508,692,716`), URL scheme name `az.linkfit.app` and method-channel `az.linkfit.app/push` (`AppDelegate.swift`).
- The two stores will therefore host two different app IDs. This must be a deliberate decision recorded before first submission, because **bundle IDs are immutable post-publish** on both stores.

### Signing
- **Android: signed with the DEBUG keystore in release.** `android/app/build.gradle.kts:38-42`:
  ```
  buildTypes { release { signingConfig = signingConfigs.getByName("debug") } }
  ```
  with a literal `// TODO: Add your own signing config`. There is no `key.properties`, no `keystore`/`.jks` in the tree (both gitignored by `android/app/.gitignore`). **A debug-signed AAB cannot be uploaded to Play, and a debug-signed APK can never be upgraded by a real release.** Hard blocker.
- **iOS: automatic signing.** `CODE_SIGN_STYLE = Automatic`, `DEVELOPMENT_TEAM = 93QUDM26D5`, `CODE_SIGN_IDENTITY[sdk=iphoneos*] = "iPhone Developer"` (`project.pbxproj:469-470,501,521,539,...`). `ios/ExportOptions.plist` is correct for store upload: `method=app-store-connect`, `destination=upload`, `teamID=93QUDM26D5`, `signingStyle=automatic`, `uploadSymbols=true`, `manageAppVersionAndBuildNumber=false`. Automatic signing works for a single developer machine but is non-reproducible in CI and couples releases to one Apple ID's session.

### Entitlements / capabilities (iOS) — in good shape
- `ios/Runner/Runner.entitlements`: `aps-environment = production`, `com.apple.developer.applesignin`, `associated-domains = applinks:linkfit.az, applinks:www.linkfit.az`.
- `ios/Runner/Info.plist`: URL scheme `linkfit`, `FlutterDeepLinkingEnabled`, supports portrait + landscape.
- `ios/Runner/PrivacyInfo.xcprivacy` is filled in: declares Name, Email, Phone, UserID, Photos/Videos, OtherUserContent, PreciseLocation (all `Linked=true, Tracking=false, purpose=AppFunctionality`), `NSPrivacyTracking=false`, and `UserDefaults` reason `CA92.1`. This is App-Store-ready and must be kept in sync with the App Privacy questionnaire.
- iOS deployment target 15.0 (`Podfile:2`, `project.pbxproj` `IPHONEOS_DEPLOYMENT_TARGET = 15.0`).

### Crash reporting / observability — **effectively absent (blocker for staged rollout)**
- `AppConfig.sentryDsn` is read from `--dart-define SENTRY_DSN` (`lib/core/config/app_config.dart:34-38`) and the README claims "wired by the error boundary when present" — but **there is no error boundary**. `lib/main.dart` calls `runApp(...)` directly with no `runZonedGuarded`, no `FlutterError.onError`, no `PlatformDispatcher.instance.onError`.
- `sentry_flutter` / `firebase_crashlytics` are **not** in `pubspec.yaml` and **not** in `pubspec.lock` (grep: none). The `SENTRY_DSN` define is dead config — nothing consumes it.
- README also lists `utils/ … analytics` (`README.md:58`) but there is no analytics file in `lib/core/utils/` (only `date_format`, `haptics`, `json`, `media_url`, `money`). Analytics is aspirational, not implemented.
- Net: in production we are blind. No crash-free-rate signal, so a staged rollout has no metric to halt on.

### Push / Firebase footprint
- Android push uses FCM (`lib/core/notifications/push_notifications.dart:93-119`); iOS uses a native APNs `MethodChannel` (`AppDelegate.swift`, `_startIosApns`).
- `Firebase.initializeApp()` is called only on Android (`_ensureFirebase`, line 121-133) and tolerates missing config (try/catch → `_firebaseReady=false`). The background handler `_fcmBackgroundHandler` (line 300) does the same.
- **No `google-services.json` and no `GoogleService-Info.plist` are committed** (gitignored in root `.gitignore`; confirmed absent). Yet the iOS `Podfile.lock` links `Firebase/Messaging 12.15.0` (pulled transitively by `firebase_messaging`), so iOS ships the Firebase SDK without a config file and without ever initializing it — dead weight on iOS today, harmless but worth noting. Android push **will not function in a real build until `google-services.json` is added.**
- There is no `google-services` Gradle plugin applied (`android/settings.gradle.kts`, `android/app/build.gradle.kts` — grep: none), so even with a JSON file, native FCM resource generation is not wired. The current code path relies on Dart-side `Firebase.initializeApp()` with default options, which needs the native config present.

### CI / release tooling — **none**
- No `.github/` in the Flutter repo, no Fastlane (`Fastfile`/`Appfile`/`Matchfile` absent). Every build is a local `flutter build` per `README.md`. No automated test gate, no reproducible artifact, no upload automation.
- Test suite exists and is healthy: 46 `*_test.dart` files, "188 tests pass, flutter analyze clean" this session — a strong gate to attach to CI.

### Secrets / config injection (good baseline)
- All env config flows through `--dart-define-from-file=dart_defines.json` (gitignored; `dart_defines.example.json` is the committed template). Keys: `API_BASE_URL`, `REVERB_WS_URL`, `REVERB_APP_KEY`, `SENTRY_DSN`, `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_SERVER_CLIENT_ID`. The X-Linkfit-App-Key gate header is read from `API_KEY`/`LINKFIT_APP_KEY` (`app_config.dart:23-30`).

---

## 2. Target state

1. **Reproducible, key-managed signing** on both platforms, independent of any one laptop.
2. **CI that builds the exact store artifact** (iOS `.ipa`, Android `.aab`) gated on `flutter analyze` + `flutter test`, with version/build-number derived deterministically.
3. **Crash + error reporting live** (Sentry, given `SENTRY_DSN` is already plumbed) with a global error boundary, dSYM/ProGuard symbol upload, and release tagging that matches `version+build`.
4. **Staged rollout** on both stores (Play: % rollout; App Store: phased release) with a documented halt criterion tied to crash-free rate.
5. **A release runbook** anchored to git tags, so every store build maps to a commit.

Non-goals: in-app A/B, feature-flag service, OTA/code-push (not compatible with store rules for native), analytics product instrumentation (separate doc).

---

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Resolve bundle IDs now.** Recommend standardizing both stores on `az.linkfit.app` (already the iOS ID and the published-looking one). Android `applicationId` change is safe *because Android has not shipped yet* — once on Play it is immutable. | Two divergent IDs is an accident waiting to happen for deep links, push topics, and OAuth client config. Decide before first Play upload. |
| D2 | **Android: upload-key keystore + Play App Signing.** Generate a release `upload-keystore.jks`, reference it from a gitignored `android/key.properties`, enroll in Play App Signing (Google holds the app signing key). | Google-managed app signing key is the modern default; we only guard the upload key. Removes the catastrophic "lost keystore = can never update" risk. |
| D3 | **iOS: keep automatic signing for the manual path now; adopt App Store Connect API key + match/`xcodebuild -allowProvisioningUpdates` for CI later.** Use an ASC API key (issuer ID + key ID + `.p8`) for `xcrun altool`/`notarytool`-style uploads and `manageAppVersionAndBuildNumber=false` (already set). | We already have a working automatic-signing export config. CI just needs the ASC key; we avoid a Fastlane `match` migration on day one. |
| D4 | **Crash reporting = Sentry** (`sentry_flutter`), not Crashlytics. | `SENTRY_DSN` is already defined end-to-end (`app_config.dart:34`, dart_defines template); iOS push is native APNs so we are not committed to the Firebase stack on iOS; Sentry gives crashes + non-fatal errors + breadcrumbs + release health (crash-free %) in one SDK, which is exactly the halt metric staged rollout needs. |
| D5 | **Global error boundary in `main.dart`** wrapping `runApp` in `runZonedGuarded`, wiring `FlutterError.onError` and `PlatformDispatcher.instance.onError` to Sentry; init is **no-op when `SENTRY_DSN` is empty** so local/dev builds and the existing 188 tests are unaffected. | Matches the README's stated contract ("wired by the error boundary when present") and the existing empty-default convention in `AppConfig`. |
| D6 | **CI on GitHub Actions** (repo is `bazabureau/linkfit-flutter`): one reusable workflow, jobs `analyze_test` → `build_ios` (macOS runner) / `build_android` (ubuntu) → optional `upload`. Secrets via GH Actions secrets, never committed. | Repo already on GitHub; matches the secret-injection model already in place (`--dart-define-from-file`). |
| D7 | **Version = `pubspec.yaml`; build number = monotonic from CI** (`--build-number=$GITHUB_RUN_NUMBER` or an offset that stays `> 16`). Tag each release `vMAJOR.MINOR.PATCH+BUILD`. | Both stores require a strictly increasing build number; deriving from CI removes the manual `local.properties` edit and guarantees monotonicity. Current high-water mark is `+16`. |
| D8 | **Staged rollout: Android 1%→5%→20%→50%→100% over ~5 days; iOS phased release (7-day Apple default).** Halt rule: pause/roll back if Sentry crash-free sessions drop below **99.5%** or any P0 (auth, booking POST, payments-at-venue flow) regresses. | Gives a real, measurable gate. Without D4/D5 this is theater. |
| D9 | **Android `google-services.json` + the `google-services` Gradle plugin must be added** (gitignored, injected in CI from a secret) before claiming Android push works. iOS needs no Firebase file (native APNs). | Android FCM is currently non-functional in a clean build; this is the dependency that makes D-rollout's push features real on Android. |

---

## 4. Risks

- **R1 (blocker): debug-signed Android release.** Today `flutter build appbundle` produces a debug-signed AAB → rejected by Play. Until D2 lands, there is no shippable Android artifact. The first non-debug signature also fixes the app's identity forever — get it right once.
- **R2 (blocker): no crash reporting.** Staged rollout's halt criterion (D8) is unenforceable without D4/D5. Shipping to % of users with zero crash signal is the single biggest release risk.
- **R3: bundle-ID divergence (D1).** If Android ships as `az.linkfit.linkfit`, deep-link `associated-domains`, push payload routing (`_routeFor`), and any backend device-platform assumptions must account for two IDs permanently. Backend `registerDevice` (`push_notifications.dart:187`) sends only `{token, platform}` so it is ID-agnostic today — keep it that way.
- **R4: lost upload/signing keys.** Mitigated by Play App Signing (Google holds the app key) and storing the upload keystore + iOS ASC `.p8` in a secrets manager / 1Password with documented recovery, never in git (already gitignored).
- **R5: iOS ships unused Firebase SDK.** `Podfile.lock` links `Firebase/Messaging` though iOS never calls `Firebase.initializeApp()`. Low risk (size/privacy-manifest only), but if Firebase is never used on iOS, consider gating `firebase_messaging` to Android to slim the binary and reduce App-Privacy surface. Defer; document.
- **R6: Sentry PII.** Crash payloads can carry JWTs, emails, chat text. Must set `beforeSend` scrubbing + `sendDefaultPii=false`, and reflect Sentry as a data processor in `PrivacyInfo.xcprivacy` / App Privacy if it collects device identifiers. Don't undermine the clean privacy manifest already in place.
- **R7: dSYM / ProGuard symbols.** `ExportOptions.plist` has `uploadSymbols=true` (App Store gets dSYMs), but Sentry needs its own dSYM + Android mapping upload to deobfuscate. Flutter's split-debug-info/obfuscation (`--obfuscate --split-debug-info`) must be paired with Sentry symbol upload or stack traces are useless.
- **R8: ATS / cleartext.** App talks only to `https://api.linkfit.az` and `wss://api.linkfit.az` (`AppConfig`), so default ATS is fine — do **not** add `NSAllowsArbitraryLoads`. (Cross-ref: web/admin had a cleartext-URL issue this session; mobile is clean — keep it clean.)
- **R9: review rejection on Sign in with Apple / account deletion.** Apple requires in-app account deletion when third-party/social login exists (Apple + Google sign-in are present). Confirm `MeController` exposes a delete path and the app surfaces it before first submission.

---

## 5. Step-by-step plan

### Phase 0 — Decide & unblock identity (0.5 day)
1. Ratify D1 bundle IDs. If standardizing on `az.linkfit.app`: change `android/app/build.gradle.kts` `applicationId`/`namespace`, move the Kotlin `MainActivity` package, update `dart_defines` OAuth client IDs if they are bundle-scoped. (Android-only; safe pre-launch.)
2. Create git tag discipline: tag current `main` once green as the release candidate base.

### Phase 1 — Signing (1 day)
3. **Android:** generate `upload-keystore.jks`; add gitignored `android/key.properties` (storeFile/storePassword/keyAlias/keyPassword); replace the debug `signingConfig` block in `android/app/build.gradle.kts:38-42` with a real `release` `signingConfig` reading `key.properties`; enroll the app in **Play App Signing**. Verify `flutter build appbundle --release` yields a non-debug signature.
4. **iOS:** confirm App Store Connect app record exists for `az.linkfit.app`; create an **ASC API key** (`.p8` + key id + issuer id) for CI uploads; keep `ExportOptions.plist` as-is.

### Phase 2 — Crash reporting + error boundary (1 day)
5. Add `sentry_flutter` to `pubspec.yaml`; run pub get; re-lock.
6. Wire `main.dart`: init Sentry **only if `AppConfig.sentryDsn` is non-empty**, set `release: "linkfit@${version}+${build}"` from `package_info_plus` (already a dependency), `environment` from API base, `sendDefaultPii: false`, a `beforeSend` scrubber (strip auth headers, emails, message bodies); wrap `runApp` in `runZonedGuarded`; set `FlutterError.onError` and `PlatformDispatcher.instance.onError`. Keep behavior identical when DSN is empty so the 188 tests and dev builds are unaffected.
7. Add Sentry dSYM (iOS) + Android mapping upload to the build (via the Sentry Gradle plugin / `sentry-dart-plugin`), and adopt `--obfuscate --split-debug-info=build/symbols` for release builds.
8. Populate `SENTRY_DSN` in the real `dart_defines.json` (already keyed there) and in CI secrets. Update `PrivacyInfo.xcprivacy` / App Privacy for Sentry per R6.

### Phase 3 — CI (1.5 days)
9. Add `.github/workflows/mobile-release.yml`:
   - `analyze_test`: `flutter pub get` → `flutter analyze` → `flutter test` (gate).
   - `build_android` (ubuntu): inject `dart_defines.json`, `key.properties`, `upload-keystore.jks`, and (D9) `google-services.json` from secrets → `flutter build appbundle --release --dart-define-from-file=... --build-number=<monotonic> --obfuscate --split-debug-info=...`.
   - `build_ios` (macOS): inject `dart_defines.json` + ASC API key → `flutter build ipa --release --export-options-plist=ios/ExportOptions.plist ...`.
   - Upload step (manual-dispatch / tag-triggered): Android → Play `internal` track; iOS → TestFlight via `xcrun`/`altool` with the ASC key.
10. Trigger on tag `v*` (release) and PR (analyze+test only). Never expose secrets to PRs from forks.

### Phase 4 — Android FCM real config (0.5 day)
11. Add `google-services.json` (gitignored, CI secret), apply the `google-services` Gradle plugin in `android/app/build.gradle.kts` + classpath in `settings`/root. Verify a real device receives a push end-to-end. (iOS APNs already works via `AppDelegate`.)

### Phase 5 — Store submission + staged rollout (per release)
12. Bump `pubspec.yaml` version; CI sets build number > 16; tag `vX.Y.Z+B`.
13. iOS: upload to **TestFlight**, internal test, then submit for review with **Phased Release** enabled. Ensure account-deletion path (R9) is present.
14. Android: upload AAB to **internal → closed → production with staged % rollout** per D8.
15. Watch Sentry **release health (crash-free sessions)** + P0 funnels; halt/roll back per D8 (Play: pause/halt rollout; iOS: pause phased release) if crash-free < 99.5% or a P0 regresses.
16. On full rollout, retain the tag + symbols; archive dSYMs/mapping.

### Definition of done
- A tagged commit produces, via CI, a non-debug-signed AAB and a store-ready IPA with no local-machine inputs.
- A forced test crash appears in Sentry, deobfuscated, tagged to the exact `version+build`.
- One real push delivered on each platform from a clean install.
- Staged rollout dashboards + documented halt rule live before the first % release.

---

## 6. Appendix — grounding index
- Version/identity: `pubspec.yaml:20`; `android/app/build.gradle.kts:21,25,32-33`; `ios/Runner.xcodeproj/project.pbxproj:508,692` ; `ios/Runner/Info.plist`.
- Signing: `android/app/build.gradle.kts:38-42` (debug release sign); `android/app/.gitignore` (key.properties/.jks ignored); `ios/ExportOptions.plist`; `project.pbxproj:469-470,501,521`.
- Crash/obs: `lib/core/config/app_config.dart:34-38`; `lib/main.dart` (no boundary); `pubspec.lock` (no sentry/crashlytics); `README.md:58` (analytics claim, no file).
- Push/Firebase: `lib/core/notifications/push_notifications.dart:93-133,300-315`; `ios/Runner/AppDelegate.swift`; `ios/Podfile.lock` (Firebase/Messaging 12.15.0); root `.gitignore` (google-services configs ignored & absent).
- Privacy/entitlements: `ios/Runner/PrivacyInfo.xcprivacy`; `ios/Runner/Runner.entitlements`; `ios/Podfile:2` (iOS 15.0).
- Config injection: `dart_defines.example.json`; `README.md` (build commands).
