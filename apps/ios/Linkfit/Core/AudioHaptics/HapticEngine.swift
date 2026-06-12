import Foundation
import UIKit
import CoreHaptics

/// Audio/Haptic agent — haptic dispatcher.
///
/// Wraps three tiers of taptic feedback so callers don't have to know
/// which generator class fits a given moment:
///
///   * `UINotificationFeedbackGenerator` — coarse success / warning /
///     error patterns. Used for outcome-shaped events
///     (match-won, error, booking-confirmed).
///   * `UISelectionFeedbackGenerator` — single-tick "something changed"
///     pulse. Used for light-selection events.
///   * `CHHapticEngine` — fine-grained custom patterns (sharpness +
///     intensity over time). Used for the richer moments
///     (achievement-unlocked, set-won, match-won) where we want a tiny
///     "rise" instead of the stock success thud.
///
/// We pre-prepare the UIKit generators since they decay back to a cold
/// state after ~1s; that's the documented way to keep latency low when a
/// burst of taps lands in quick succession.
///
/// Concurrency: this type is `@MainActor` because all UIKit feedback
/// generators must be driven on the main thread, and `CHHapticEngine`'s
/// callbacks expect a stable run-loop context.
@MainActor
final class HapticEngine {
    // MARK: - Stock UIKit generators (kept "primed" between events)

    private let notification = UINotificationFeedbackGenerator()
    private let selection = UISelectionFeedbackGenerator()
    private let lightImpact = UIImpactFeedbackGenerator(style: .light)
    private let mediumImpact = UIImpactFeedbackGenerator(style: .medium)
    private let heavyImpact = UIImpactFeedbackGenerator(style: .heavy)

    // MARK: - Core Haptics (custom patterns)

    /// Lazily-built engine. iPhone 8 and up support Core Haptics — on
    /// devices that don't, `supportsHaptics` is false and we fall back to
    /// the closest UIKit generator.
    private var engine: CHHapticEngine?
    private var engineStartFailed = false

    /// `true` once we've successfully booted the engine. We only attempt
    /// the boot when an event that needs it actually fires, to avoid
    /// burning a process slot on devices that won't use it.
    private var didStart = false

    init() {
        // Pre-prime UIKit generators so the first invocation isn't stuck
        // waiting on the taptic actuator to warm up.
        notification.prepare()
        selection.prepare()
        lightImpact.prepare()
        mediumImpact.prepare()
        heavyImpact.prepare()
    }

    // MARK: - Public surface

    /// Routes a `HapticEffect` to the cheapest generator that produces
    /// the intended feel. Safe to call from any feature view-model — the
    /// `@MainActor` annotation funnels it onto the main thread.
    func play(_ effect: HapticEffect) {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics ||
                effect.fallbackGenerator != .none else {
            return
        }

        switch effect {
        // Notification-shaped events ----------------------------------
        case .matchWon, .bookingConfirmed:
            notification.notificationOccurred(.success)
            notification.prepare()
        case .matchLost:
            notification.notificationOccurred(.warning)
            notification.prepare()
        case .error:
            notification.notificationOccurred(.error)
            notification.prepare()

        // Selection-shaped events -------------------------------------
        case .lightSelection, .messageSent:
            selection.selectionChanged()
            selection.prepare()

        // Impact-shaped events ----------------------------------------
        case .gameJoined, .gameLeft:
            mediumImpact.impactOccurred()
            mediumImpact.prepare()
        case .pointScored, .messageReceived:
            lightImpact.impactOccurred()
            lightImpact.prepare()

        // Pattern-shaped events ---------------------------------------
        case .setWon:
            playRisingPattern(steps: 2, peakIntensity: 0.7)
        case .achievementUnlocked:
            playRisingPattern(steps: 3, peakIntensity: 0.85)
        }
    }

    // MARK: - Core Haptics — rising "ladder" pattern

    /// Emits N short transient haptics with linearly rising intensity
    /// and sharpness. Used to differentiate "achievement-unlocked"
    /// from a stock success thud: the user feels a tiny "stair-step"
    /// instead of a single beat. Falls back to a `.success`
    /// notification on devices without Core Haptics.
    private func playRisingPattern(steps: Int, peakIntensity: Float) {
        let capabilities = CHHapticEngine.capabilitiesForHardware()
        guard capabilities.supportsHaptics else {
            notification.notificationOccurred(.success)
            notification.prepare()
            return
        }

        ensureEngineStarted()
        guard let engine, !engineStartFailed else {
            notification.notificationOccurred(.success)
            notification.prepare()
            return
        }

        var events: [CHHapticEvent] = []
        let stride: TimeInterval = 0.06
        for i in 0..<steps {
            let frac = Float(i + 1) / Float(steps)
            let intensity = CHHapticEventParameter(parameterID: .hapticIntensity, value: peakIntensity * frac)
            let sharpness = CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.4 + 0.4 * frac)
            events.append(
                CHHapticEvent(
                    eventType: .hapticTransient,
                    parameters: [intensity, sharpness],
                    relativeTime: stride * Double(i)
                )
            )
        }

        do {
            let pattern = try CHHapticPattern(events: events, parameters: [])
            let player = try engine.makePlayer(with: pattern)
            try player.start(atTime: 0)
        } catch {
            // Engine can fail mid-session (e.g. interrupted by a phone
            // call). Reset so the next call retries from scratch, and
            // fall back so the user still feels *something*.
            engine.stop(completionHandler: nil)
            self.engine = nil
            didStart = false
            notification.notificationOccurred(.success)
            notification.prepare()
        }
    }

    /// Lazily boots `CHHapticEngine`. Wires up reset & stop handlers
    /// because the engine can be torn down by the system at any time
    /// (background, phone call, route change).
    private func ensureEngineStarted() {
        guard !didStart, !engineStartFailed else { return }
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }

        do {
            let engine = try CHHapticEngine()
            engine.isAutoShutdownEnabled = true
            engine.stoppedHandler = { [weak self] _ in
                Task { @MainActor in
                    self?.didStart = false
                }
            }
            engine.resetHandler = { [weak self] in
                Task { @MainActor in
                    self?.didStart = false
                    try? self?.engine?.start()
                    self?.didStart = true
                }
            }
            try engine.start()
            self.engine = engine
            self.didStart = true
        } catch {
            // Some simulators and locked-down devices reject the engine.
            // Mark as failed so we don't retry every single tap.
            engineStartFailed = true
            engine = nil
        }
    }
}

// MARK: - HapticEffect

/// Catalog of every "moment" the app can punctuate with a haptic.
/// Adding a case here also requires picking a sound in `SoundEffect`
/// (so callers always get a paired audio+haptic response).
enum HapticEffect: String, CaseIterable, Sendable {
    case gameJoined
    case gameLeft
    case bookingConfirmed
    case messageReceived
    case messageSent
    case achievementUnlocked
    case pointScored
    case setWon
    case matchWon
    case matchLost
    case error
    case lightSelection

    /// Coarse classification used by `HapticEngine` to choose its
    /// fallback path when Core Haptics is unavailable.
    enum Fallback {
        case notification
        case selection
        case impact
        case none
    }

    var fallbackGenerator: Fallback {
        switch self {
        case .matchWon, .matchLost, .bookingConfirmed, .error, .achievementUnlocked, .setWon:
            return .notification
        case .lightSelection, .messageSent:
            return .selection
        case .gameJoined, .gameLeft, .pointScored, .messageReceived:
            return .impact
        }
    }
}
