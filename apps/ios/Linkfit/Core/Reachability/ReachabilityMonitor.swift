import Foundation
import Network
import Observation

/// App-wide network reachability flag, driven by `NWPathMonitor`.
///
/// SwiftUI views read `isReachable` to drive the offline banner. The first
/// path callback may take a moment after launch on a cold start; until it
/// arrives we assume reachable so the banner doesn't flash on app launch
/// for users who do have connectivity. A genuine offline device will
/// settle to `false` within the first callback (typically <1s).
///
/// Mirrors the `@Observable` + `@MainActor` pattern used by `ToastCenter` /
/// `ThemeManager` so SwiftUI picks up changes without any `@Published` shim.
/// The `NWPathMonitor` itself runs on a background `DispatchQueue` per
/// Apple's guidance; the path-update handler hops to MainActor before
/// touching `isReachable` so the observation system sees consistent
/// main-thread mutations.
@Observable
@MainActor
final class ReachabilityMonitor {

    /// Singleton — reachability is inherently process-global. A per-scene
    /// instance would mean every feature has to thread an environment
    /// object just to read a flag the OS reports once.
    static let shared = ReachabilityMonitor()

    /// `true` when the device has a usable network path. Drives the
    /// offline banner's visibility. Defaults to `true` so the banner is
    /// hidden until `NWPathMonitor` reports otherwise — avoids a banner
    /// flash on cold launch.
    private(set) var isReachable: Bool = true

    /// Underlying path monitor. `nil` until `start()` is invoked.
    /// MainActor-isolated alongside `isReachable` — the singleton lives
    /// for the process lifetime, so the deinit path is academic and we
    /// don't need a cross-actor escape hatch.
    private var monitor: NWPathMonitor?

    /// Dedicated serial queue for path updates. Apple's docs require a
    /// background queue here — `NWPathMonitor` will assert if handed the
    /// main queue, and even if it didn't the path callbacks shouldn't
    /// contend with UI work.
    private let queue = DispatchQueue(label: "az.linkfit.reachability", qos: .utility)

    /// Guards against double-start. `start()` is called from the app root
    /// `.task`, which can re-fire if the view tree rebuilds (e.g. on
    /// theme change); we want a single monitor for the process lifetime.
    private var didStart = false

    private init() {}

    /// Begin observing the device's network path. Safe to call repeatedly —
    /// the second and subsequent calls are no-ops. The path-update
    /// callback hops to MainActor before mutating `isReachable` so
    /// SwiftUI re-renders happen on the main thread.
    func start() {
        guard !didStart else { return }
        didStart = true

        let monitor = NWPathMonitor()
        self.monitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            // `pathUpdateHandler` is invoked on `queue`. Hop to MainActor
            // before touching the observable property — `@Observable`
            // tracks property writes per the actor's isolation domain,
            // and SwiftUI redraws need to be triggered on the main run
            // loop anyway.
            let reachable = (path.status == .satisfied)
            Task { @MainActor [weak self] in
                guard let self else { return }
                if self.isReachable != reachable {
                    self.isReachable = reachable
                }
            }
        }
        monitor.start(queue: queue)
    }

    // No `deinit` cleanup: this singleton lives for the process
    // lifetime, and reaching MainActor-isolated state from a
    // `nonisolated` deinit isn't legal under Swift 6 strict concurrency.
    // If we ever introduce a per-scene instance, swap to an explicit
    // `stop()` API rather than relying on `deinit`.
}
