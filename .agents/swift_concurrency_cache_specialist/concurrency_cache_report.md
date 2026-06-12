# Swift Concurrency & Cache Audit Report

## 1. Executive Summary

This report presents a deep-dive technical audit of the **Swift 6 Concurrency** implementation, **Actor isolation boundaries**, **thread safety**, and **local caching architectures** within the `Linkfit` iOS application (`apps/ios`).

The Linkfit iOS app is built on a modern foundation, utilizing Apple's modern Swift 6 Concurrency model (`@Observable`, `actor` isolation, `AsyncStream`, and `@MainActor` state management) instead of legacy lock primitives or dispatch queue spaghetti. However, our read-only investigation has uncovered several high-severity concurrency warnings, thread-starvation risks, and main-thread blocking bottlenecks that must be addressed to ensure absolute stability and smooth user experience.

### Key Metrics & Discoveries:
*   **Swift 6 Compliance**: Highly progressive. Most view-models are properly isolated to `@MainActor` and utilize `@Observable`.
*   **Actor Architecture**: Robust usage of actors (`ImageCache`, `RefreshCoordinator`, `RealtimeClient`) to isolate subsystem states.
*   **Thread Safety Risks**: Found multiple `@unchecked Sendable` race vectors (e.g., concurrent `JSONDecoder` usage in `URLSessionAPIClient`, unprotected shared mutable delegates).
*   **Main-Thread Blocking Warnings**: Identified synchronous file/keychain reads and disk-bound preloads executed during app launch and UI interactions, blocking the main actor.
*   **Cooperative Thread Starvation Risks**: Heavy filesystem IO and image decoding operations are performed synchronously inside actors, threatening to exhaust Swift's cooperative thread pool.

---

## 2. Core Swift Concurrency Patterns & Actor Isolation

The application isolates its concurrency boundaries through a distinct separation of responsibilities:

### A. `@MainActor` View-Model & State Architecture
Almost all view-models (e.g., `HomeViewModel`, `GroupConversationViewModel`, `MyBookingsViewModel`, `ThemeManager`, `LocaleManager`) are isolated to `@MainActor` and marked `@Observable`.
*   **Strengths**: This guarantees that all UI updates are automatically dispatched to the main thread. It leverages SwiftUI's native dependency tracking, preventing state corruption and rendering conflicts.
*   **Weaknesses**: Because the view models are tied to `@MainActor`, any heavy computation or synchronous data decoding performed in their methods will block the main thread.

### B. Single-Connection SSE Client (`RealtimeClient`)
*   Isolated behind a dedicated `actor RealtimeClient` that serializes and multiplexes SSE stream subscriptions.
*   Uses a classic bridge with `SSEDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable` which receives network bytes on a serialized background queue and dispatches them back to the actor via structured `Task` boundaries:
    ```swift
    onEvent: { [weak self] event in
        Task { [weak self] in await self?.dispatch(event) }
    }
    ```
*   **Assessment**: Highly elegant and conformant. `SSEDelegate` is marked `@unchecked Sendable` because the delegate queue is serialized by `URLSession`, avoiding concurrent mutations to its internal buffer.

### C. Single-Flight Token Serializer (`RefreshCoordinator`)
*   An `actor` designed to serialize token refresh requests across multiple concurrent network calls.
*   Utilizes a reference-stashed `Task<Void, Error>?` to implement the single-flight pattern:
    ```swift
    func refresh() async throws {
        if let task = inFlight {
            try await task.value
            return
        }
        let task = Task { try await perform() }
        inFlight = task
        defer { inFlight = nil }
        try await task.value
    }
    ```
*   **Assessment**: Correct implementation. It avoids multiple parallel refresh network calls and ensures clean token handling.

---

## 3. High-Priority Concurrency & Thread-Safety Warnings

Despite the robust architecture, several critical concurrency gaps bypass compiler checks or introduce potential race conditions:

### Warning 1: Concurrent JSONDecoder Mutation in `@unchecked Sendable` Client
*   **Location**: `URLSessionAPIClient.swift` (`APIClient.swift:1-531`)
*   **Code Detail**:
    `URLSessionAPIClient` is marked `@unchecked Sendable` to bypass strict compiler checks. It declares:
    ```swift
    private let decoder: JSONDecoder
    ```
    This single `decoder` instance is accessed concurrently inside async methods `sendOnce`, `uploadImageOnce`, and `uploadImageProgressOnce` on cooperative threads:
    ```swift
    // Line 147, 244, 326
    let decoded = try self.decoder.decode(R.self, from: data)
    ```
*   **Risk**: `JSONDecoder` is **not thread-safe** for simultaneous concurrent decode calls. If two concurrent network requests finish at the same time and attempt to decode their responses using `self.decoder`, this will cause undefined behavior, data corruption, or a hard runtime crash.
*   **Remediation**: Avoid sharing a single `JSONDecoder` instance across concurrent methods. Either instantiate `JSONDecoder()` locally within each method or run decoding inside a thread-safe actor or serialized context.

### Warning 2: Unsynchronized Shared State in `@unchecked Sendable` Client
*   **Location**: `URLSessionAPIClient.swift` (`APIClient.swift:99`)
*   **Code Detail**:
    `URLSessionAPIClient` has a mutable property `private var authLostHandler: AuthLostHandler?`. It is written to via:
    ```swift
    func attachAuthDelegate(_ onAuthLost: @escaping AuthLostHandler) {
        self.authLostHandler = onAuthLost
    }
    ```
*   **Risk**: Since `URLSessionAPIClient` is `@unchecked Sendable`, the compiler does not verify thread safety for `authLostHandler`. If a caller writes to `attachAuthDelegate` while another background request reads/triggers `authLostHandler?()`, a data race occurs.
*   **Remediation**: Isolate `URLSessionAPIClient`'s mutable delegate behind a lock, or convert the client into a thread-safe actor (since it performs mostly async operations anyway).

### Warning 3: Thread-Safety and `@Published` Mutations on Background Threads
*   **Location**: `LocationOneShotManager.swift`
*   **Code Detail**:
    `LocationOneShotManager` conforms to `ObservableObject` and declares:
    ```swift
    @Published var isAuthorized: Bool = false
    ```
    However, the class has no `@MainActor` or actor isolation. The delegate callbacks (e.g. `locationManagerDidChangeAuthorization` and `didUpdateLocations`) are called by `CLLocationManager` on whatever thread it uses.
*   **Risk**: Mutating the `@Published` property `isAuthorized` or the completion handler callback `pending` from a background thread can cause data races and triggers SwiftUI's runtime purple warnings (*"Publishing changes from background threads is not allowed"*).
*   **Remediation**: Mark `LocationOneShotManager` as `@MainActor` to force all delegate callbacks and property mutations to run on the main actor:
    ```swift
    @MainActor
    final class LocationOneShotManager: NSObject, ObservableObject, CLLocationManagerDelegate { ... }
    ```

---

## 4. Main-Thread Blocking Bottlenecks

Blocking the main thread results in dropped frames, sluggish scrolling, and delayed app starts. The following operations are performed synchronously on the main thread:

### Bottleneck 1: Synchronous Launch-Time Keychain Queries
*   **Location**: `LinkfitApp.swift` -> `AppContainer.swift` -> `KeychainStore.swift`
*   **Code Detail**:
    During `LinkfitApp` initialization, `AppContainer.live()` is called to construct the root container:
    ```swift
    @State private var container = AppContainer.live()
    ```
    This structural initialization runs synchronously on the main thread. Inside `AppContainer.init`, it performs:
    ```swift
    self.isAuthenticated = tokenStore.accessToken() != nil
    ```
    `KeychainTokenStore.accessToken()` executes a **synchronous security query** (`SecItemCopyMatching`) on the Keychain.
*   **Risk**: Keychain reads involve inter-process communication (IPC) with the iOS security daemon. On cold boot or heavy system load, this synchronous IPC blocks the main thread, directly contributing to slow app startup and potential watchdog terminations.
*   **Remediation**: Lazily evaluate authentication status, or perform the initial Keychain read asynchronously within a background `Task` before updating the main actor state.

### Bottleneck 2: Synchronous Audio Preloading on Main Thread
*   **Location**: `AudioHaptics.swift` -> `SoundPlayer.swift` (`SoundPlayer.swift:29-67`)
*   **Code Detail**:
    `SoundPlayer` is `@MainActor` isolated. During its `init()`, it calls:
    ```swift
    private func preload() {
        for effect in SoundEffect.allCases {
            guard let url = Bundle.main.url(forResource: effect.fileName, withExtension: "wav") else { continue }
            do {
                let player = try AVAudioPlayer(contentsOf: url) // Synchronous Disk IO
                player.prepareToPlay()
                players[effect] = player
            } catch { ... }
        }
    }
    ```
*   **Risk**: Preloading 12 WAV files synchronously involves opening and reading multiple audio assets from disk. Because this is executed on the main actor when `AudioHaptics.shared` is first lazily resolved, it introduces a noticeable lag or freeze in the UI on the user's first interaction (such as clicking the haptic toggle in Settings or joining a game on Home).
*   **Remediation**: Run the `preload()` routine asynchronously inside a background `Task` or move the `SoundPlayer`'s asset loading off the main actor using standard file-io techniques.

### Bottleneck 3: Synchronous JSON Serialization on Main Actor
*   **Location**: `ResponseCache.swift` & `HomeViewModel.swift`
*   **Code Detail**:
    `ResponseCache` is `@MainActor` isolated. Its `save` and `load` methods perform synchronous JSON encoding and decoding of arbitrary payloads using `UserDefaults` as storage:
    ```swift
    let data = try encoder.encode(value)
    defaults.set(data, forKey: key)
    ```
    In `HomeViewModel.load()`, this is called for `[GameSummary]`:
    ```swift
    if isCold, let hit = ResponseCache.shared.load([GameSummary].self, forKey: ResponseCache.Key.homeGames) {
        ...
    }
    ```
    And in `HomeViewModel.saveWidgetSnapshot`:
    ```swift
    SharedContainer.saveSnapshot(snapshot) // Synchronous JSON encoding on main actor
    ```
*   **Risk**: If cached payloads grow large (e.g. hundreds of game summaries or user profiles), parsing them synchronously inside the view-model block of the main actor will trigger hitching and frame drops.
*   **Remediation**: Move the serialization/deserialization workloads off the main actor. Either convert `ResponseCache` into a background `actor` that performs the JSON parsing in the cooperative background pool, or perform `JSONDecoder.decode` in a background `Task` and hop back to `@MainActor` only with the resulting model.

---

## 5. Cooperative Thread Starvation Risks

Swift 6 Concurrency relies on a cooperative thread pool with a strict thread count bound by CPU core limits. **Never block cooperative threads with synchronous disk IO or heavy calculations.**

### Thread Starvation Vector: ImageCache Actor Disk IO
*   **Location**: `ImageCache.swift` (`ImageCache.swift:1-211`)
*   **Code Detail**:
    `ImageCache` is a dedicated `actor` designed to handle memory (`NSCache`) and disk (LRU folder) image caching.
    Inside the actor methods, the following synchronous, blocking operations are executed:
    ```swift
    // Line 62: Synchronous file read
    let data = try Data(contentsOf: fileURL)
    
    // Line 67: Synchronous file attribute mutation
    try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: fileURL.path)
    
    // Line 73: CPU-intensive image decoding inside the actor
    let image = UIImage(data: data)
    
    // Line 108: Synchronous atomic write to disk
    try data.write(to: fileURL, options: .atomic)
    
    // Line 118: Synchronous directory scanning
    let urls = try? fileManager.contentsOfDirectory(...)
    
    // Line 137: Synchronous file deletions
    try? fileManager.removeItem(at: entry.url)
    ```
*   **Risk**: When scrolling through a grid or list containing multiple images, `CachedAsyncImage` triggers dozens of parallel image requests. Because these requests hop to `ImageCache`, the cooperative thread pool is flooded with tasks that block waiting for disk reads, writes, directory scanning, and image decoding. This will starve other cooperative async tasks (such as realtime SSE events, API requests, and view transitions), causing the entire application's async execution to lock up or freeze.
*   **Remediation**:
    1.  Offload filesystem IO (`Data(contentsOf:)`, `data.write(to:)`, `removeItem(at:)`) to a custom, serial background dispatch queue (`DispatchQueue.global(qos: .background)`) or execute them inside `Task.detached` to avoid capturing and blocking cooperative threads.
    2.  Perform `UIImage` decoding inside a nonisolated helper to keep the actor's thread unblocked.

---

## 6. Local Data Synchronization & Widget Integration

The app Group data bridge and secure persistence layers were audited for concurrency safety:

### A. WidgetCache & SharedDefaults Synchronization
*   The communication contract with the `LinkfitWidgets` target relies on the App Group container `group.az.linkfit.app` via `SharedDefaults` and `WidgetCache`.
*   **Assessment**: UserDefaults is process-safe and handles multi-process writes safely. The serialization protocol enforces a clean `Codable` contract.
*   **Discovered Gap / TODO**:
    In `WidgetHook.swift`, it is noted that `MyBookingsViewModel` should update `WidgetCache.shared` upon successfully fetching bookings:
    ```swift
    //  2. MyBookingsViewModel.load:
    //      // Same pattern — call WidgetCache.shared.update(…) once the freshest
    //      // bookings list is in hand.
    ```
    However, our inspection of `MyBookingsViewModel.swift` confirmed that this synchronization is **missing**! `MyBookingsViewModel` currently loads data from the API client but never writes or updates `WidgetCache` or `SharedContainer`.
*   **Remediation**: Implement the `WidgetCache` update in `MyBookingsViewModel.load()` immediately after receiving a successful bookings API response.

---

## 7. Strategic Recommendations & Action Plan

To establish perfect concurrency hygiene and maximize performance, we recommend the following step-by-step refactoring strategy:

### Phase 1: High-Priority Security & Race Fixes
1.  **Thread-Safe JSONDecoder**: Modify `URLSessionAPIClient` to declare decoder as `private var decoder: JSONDecoder` but construct it inside local method bodies, or write a thread-safe wrapper.
2.  **Isolate Location Manager**: Mark `LocationOneShotManager` as `@MainActor` to avoid background thread mutations to `@Published var isAuthorized`.

### Phase 2: Main-Thread Responsiveness & Launch Performance
1.  **Asynchronous Launch Authentication**: Refactor `AppContainer` initialization so that `isAuthenticated` is checked inside an asynchronous `Task` rather than blocking the app delegate boot path.
2.  **Asynchronous Audio Preload**: Refactor `SoundPlayer`'s `preload` function to run in a detached background Task, avoiding synchronously loading 12 WAV files from disk on the main actor.
3.  **Background Cache Serialization**: Convert `ResponseCache` into a background `actor` and make all serialization/deserialization asynchronous.

### Phase 3: Cooperative Thread Safety & Widget Completion
1.  **Unblock Cooperative Threads in ImageCache**: Update `ImageCache` to wrap all synchronous FileManager and Data operations inside a background queue or detached tasks with standard dispatch parameters:
    ```swift
    let data = try await Task.detached(priority: .background) {
        try Data(contentsOf: fileURL)
    }.value
    ```
2.  **Integrate Booking Widget Cache**: Complete the missing `WidgetCache.shared` synchronization step in `MyBookingsViewModel.load()`.
