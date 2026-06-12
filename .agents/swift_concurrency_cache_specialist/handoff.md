# Handoff Report — Swift Concurrency & Cache Audit

This report has been prepared by the **Swift Concurrency & Cache Specialist** for the **Project CTO / Tech Lead (ID: 5f6c0774-069c-415a-9b2e-5784688a2095)**.

---

## 1. Observation

During our read-only analysis of the `apps/ios` workspace directory `/Users/kamrannamazov/Desktop/linkfit/apps/ios`, we directly observed the following specific code behaviors, paths, and line references:

### A. Thread-Safety / Race Violations in Networking
*   **Observation A1 (File Path: `Linkfit/Core/Networking/APIClient.swift`):**
    `URLSessionAPIClient` is marked `@unchecked Sendable` (line 69). It declares `private let decoder: JSONDecoder` (line 79).
    This single shared `decoder` is called concurrently inside async functions `sendOnce`, `uploadImageOnce`, and `uploadImageProgressOnce` on cooperative threads:
    *   Line 147: `let decoded = try self.decoder.decode(R.self, from: data)`
    *   Line 244: `let res = try decoder.decode(UploadImageResponse.self, from: data)`
    *   Line 326: `let decoded = try self.decoder.decode(R.self, from: data)`
*   **Observation A2 (File Path: `Linkfit/Core/Networking/APIClient.swift`):**
    `URLSessionAPIClient` declares a mutable property `private var authLostHandler: AuthLostHandler?` (line 82), which is modified via `func attachAuthDelegate(_ onAuthLost: @escaping AuthLostHandler)` (line 99) with no thread synchronization.

### B. Launch-Time & UI-Interactive Main-Thread Blocking
*   **Observation B1 (File Path: `Linkfit/App/LinkfitApp.swift` & `Linkfit/App/AppContainer.swift`):**
    `LinkfitApp` declares `@State private var container = AppContainer.live()` (line 40) during struct initialization on the main thread.
    `AppContainer.live()` (line 39 of `AppContainer.swift`) constructs the container, which calls `self.isAuthenticated = tokenStore.accessToken() != nil` in its `init()` (line 21 of `AppContainer.swift`).
    `KeychainTokenStore.accessToken()` (line 22 of `KeychainStore.swift`) performs a synchronous `SecItemCopyMatching` query to retrieve security credentials.
*   **Observation B2 (File Path: `Linkfit/Core/AudioHaptics/SoundPlayer.swift`):**
    `SoundPlayer` is isolated to the `@MainActor` (line 20).
    Its `init()` calls `preload()` (line 31), which synchronously loops through all cases of `SoundEffect` (line 52) and loads them:
    `let player = try AVAudioPlayer(contentsOf: url)` (line 57) (Synchronous Disk IO).
    This runs on the main actor upon the first lazy access of `AudioHaptics.shared`.
*   **Observation B3 (File Path: `Linkfit/Core/Cache/ResponseCache.swift`):**
    `ResponseCache` is `@MainActor` isolated (line 12).
    Its `save` and `load` methods perform synchronous `JSONEncoder.encode` and `JSONDecoder.decode` (lines 35, 68) inside the main actor context.
    `HomeViewModel.load()` calls `ResponseCache.shared.load` for `[GameSummary]` (line 50) on `@MainActor`.

### C. Cooperative Thread Starvation Risks
*   **Observation C1 (File Path: `Linkfit/Core/Cache/ImageCache.swift`):**
    `ImageCache` is a dedicated `actor` (line 24).
    Its methods perform multiple blocking, synchronous operations on cooperative threads:
    *   Line 62: `let data = try Data(contentsOf: fileURL)` (Synchronous Disk Read)
    *   Line 73: `let image = UIImage(data: data)` (CPU-intensive Image Decoding)
    *   Line 108: `try data.write(to: fileURL, options: .atomic)` (Synchronous Disk Write)
    *   Line 118: `try? fileManager.contentsOfDirectory(...)` (Synchronous Directory Scan)
    *   Line 137: `try? fileManager.removeItem(at: entry.url)` (Synchronous File Deletion)

### D. Missing Local Synchronization Integration
*   **Observation D1 (File Path: `Linkfit/Core/Widgets/SharedDefaults.swift`):**
    `WidgetHook.swift` documents that `MyBookingsViewModel` should update `WidgetCache.shared` upon successfully fetching bookings to keep the widget snapshot accurate.
*   **Observation D2 (File Path: `Linkfit/Features/Booking/MyBookingsViewModel.swift`):**
    `MyBookingsViewModel.load()` (lines 28-44) performs the bookings load request via `apiClient.send(.myBookings)` but **does not** call `WidgetCache.shared` or `SharedContainer` to update local data sync, representing a known functional TODO/gap.

---

## 2. Logic Chain

Our assessment is supported by the following step-by-step reasoning:

1.  **JSONDecoder Concurrency Crash (Critical)**: `JSONDecoder` is fundamentally a non-thread-safe class in Foundation. Since `URLSessionAPIClient` is bypass-checked via `@unchecked Sendable`, it executes concurrent decodings on multiple cooperative background threads using the same `decoder` instance (Observation A1). This constitutes a high-risk data race that can cause a runtime crash under high networking concurrency.
2.  **App Launch Latency (High)**: Main-thread blocking during app launch violates Apple's watch-dog constraints. Instantiating `AppContainer.live()` on startup triggers synchronous Keychain queries (Observation B1) on the main thread. Additionally, preloading 12 WAV files via `AVAudioPlayer(contentsOf:)` (Observation B2) on first access blocks the main actor. Together, these cause lag, frame drops, and delay launch responsiveness.
3.  **Hitching in Large Lists (Medium)**: Performing synchronous CPU-bound JSON serialization and deserialization on the `@MainActor` (Observation B3) for large collection payloads like `[GameSummary]` delays the main thread's run-loop, causing visual hitches during network loads.
4.  **Cooperative Pool Starvation (High)**: Dedicated actors run on Swift's cooperative background pool, which has a fixed size equal to CPU core count. Synchronous Disk IO and CPU-intensive image decoding performed inside the `ImageCache` actor (Observation C1) will capture and block cooperative threads. Under high-frequency scrolling, this exhausts the cooperative thread pool, causing starvation of other asynchronous tasks (such as network calls and realtime SSE subscriptions), freezing the app.
5.  **Widget Sync Defect (Medium)**: Since `MyBookingsViewModel.load()` lacks the widget synchronization invocation (Observation D2) that is planned in the documentation (Observation D1), the `LinkfitWidgets` target will fail to display up-to-date upcoming bookings for players, leading to data synchronization drift.

---

## 3. Caveats

*   We operated strictly under a **read-only** audit mandate. No modifications were made to the source codebase.
*   We did not run runtime profiling (e.g. Instruments Time Profiler or Thread Sanitizer) but inferred thread behaviors directly from strict Swift 6 static typing, actor boundaries, and class constraints.
*   We assume that the compiler parameters are set to Swift 6 strict concurrency checking, which would surface warnings on these `@unchecked Sendable` and missing isolation sites during compilation.

---

## 4. Conclusion

The `Linkfit` iOS app leverages modern Swift Concurrency patterns very effectively, but exhibits major risks related to **thread races in API decoding**, **cooperative thread pool starvation in image caching**, **main-thread blocking on launch**, and **incomplete widget cache synchronization**.

All issues are highly actionable and can be resolved using standard Swift 6 patterns (thread-local decoders, background-isolated actors, detached background tasks, and properly isolated view-model structures) without architectural rewrite.

---

## 5. Verification Method

To verify our findings independently, execute the following procedures:

### Technical Verification Steps
1.  **Verify JSONDecoder Concurrent Use**:
    Inspect `/Users/kamrannamazov/Desktop/linkfit/apps/ios/Linkfit/Core/Networking/APIClient.swift` at lines 147, 244, and 326. Note that `self.decoder.decode` is called in parallel methods without a synchronization boundary (locks or actors).
2.  **Verify Launch Keychain Block**:
    Inspect `/Users/kamrannamazov/Desktop/linkfit/apps/ios/Linkfit/App/LinkfitApp.swift` at line 40. Notice the synchronous declaration `@State private var container = AppContainer.live()`. Follow this to `/Users/kamrannamazov/Desktop/linkfit/apps/ios/Linkfit/Core/Persistence/KeychainStore.swift` at line 22, confirming the synchronous `SecItemCopyMatching` keychain access.
3.  **Verify SoundPlayer Blocking**:
    Inspect `/Users/kamrannamazov/Desktop/linkfit/apps/ios/Linkfit/Core/AudioHaptics/SoundPlayer.swift` at lines 31 and 57. Observe that `try AVAudioPlayer(contentsOf: url)` runs synchronously within the main actor.
4.  **Verify ImageCache Starvation**:
    Inspect `/Users/kamrannamazov/Desktop/linkfit/apps/ios/Linkfit/Core/Cache/ImageCache.swift`. Confirm that synchronous file operations (`Data(contentsOf:)` at line 62, `data.write(to:)` at line 108) are executed inside actor-isolated methods.
5.  **Verify Missing Widget Sync**:
    Inspect `/Users/kamrannamazov/Desktop/linkfit/apps/ios/Linkfit/Features/Booking/MyBookingsViewModel.swift`. Confirm that the `load()` method completes without updating `WidgetCache` or `SharedContainer`.

### Project Test Suites
To verify target compilation, run the standard workspace build and test targets using:
```bash
xcodebuild test -workspace Linkfit.xcworkspace -scheme Linkfit -destination 'platform=iOS Simulator,name=iPhone 15'
```
*(Ensure all tests pass and check for Thread Sanitizer warnings under strict mode).*
