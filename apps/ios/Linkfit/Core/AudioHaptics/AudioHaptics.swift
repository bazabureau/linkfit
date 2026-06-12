import Foundation
import SwiftUI
import Combine

/// Audio/Haptic agent — public façade.
///
/// One-line invocation site for feature view-models:
///
/// ```swift
/// AudioHaptics.shared.play(.gameJoined)
/// ```
///
/// Internally fan-outs to:
///   * `HapticEngine` — taptic feedback (Core Haptics on iPhone 8+,
///     UIKit generators everywhere else)
///   * `SoundPlayer` — short WAV from `Resources/Sounds`
///
/// Both layers respect the user's `AudioHapticsSettings` toggles, so a
/// caller doesn't have to gate manually. The class is `@MainActor`
/// because every downstream API (UIKit, AVFoundation, CoreHaptics)
/// requires the main thread anyway.
@MainActor
final class AudioHaptics {
    static let shared = AudioHaptics()

    private let haptics = HapticEngine()
    private let sounds = SoundPlayer()

    /// Observable settings — read at call-time so toggling in the
    /// Settings screen takes effect immediately, no app restart.
    let settings = AudioHapticsSettings.shared

    private init() {}

    // MARK: - Public

    /// Plays both the haptic and the paired sound for a given moment.
    ///
    /// Effect mapping is intentionally 1:1 between `HapticEffect` and
    /// `SoundEffect` (same case names) so callers only need to remember
    /// one vocabulary. If you ever introduce an event with *only* sound
    /// or *only* haptic, add a separate `playSound`/`playHaptic` entry
    /// rather than overloading this method — the simplicity of the
    /// shared catalog is a feature.
    func play(_ effect: HapticEffect) {
        if settings.hapticEnabled {
            haptics.play(effect)
        }
        if settings.soundEnabled, let sound = SoundEffect(haptic: effect) {
            sounds.play(sound)
        }
    }

    /// Plays only the haptic — useful for ultra-frequent UI taps where
    /// even a 100 ms WAV would be too much.
    func playHaptic(_ effect: HapticEffect) {
        guard settings.hapticEnabled else { return }
        haptics.play(effect)
    }

    /// Plays only the sound — rare. Most callers should use `play(_:)`.
    func playSound(_ effect: SoundEffect) {
        guard settings.soundEnabled else { return }
        sounds.play(effect)
    }
}

// MARK: - Effect bridge

private extension SoundEffect {
    /// Maps a `HapticEffect` to its paired `SoundEffect`. The two enums
    /// share case names by design — a 1:1 lookup table keeps the
    /// pairing impossible to drift.
    init?(haptic: HapticEffect) {
        switch haptic {
        case .gameJoined:           self = .gameJoined
        case .gameLeft:             self = .gameLeft
        case .bookingConfirmed:     self = .bookingConfirmed
        case .messageReceived:      self = .messageReceived
        case .messageSent:          self = .messageSent
        case .achievementUnlocked:  self = .achievementUnlocked
        case .pointScored:          self = .pointScored
        case .setWon:               self = .setWon
        case .matchWon:             self = .matchWon
        case .matchLost:            self = .matchLost
        case .error:                self = .error
        case .lightSelection:       self = .lightSelection
        }
    }
}

// MARK: - User-controllable settings

/// Two-bit user preference store backing the toggles in
/// `AudioHapticsToggle`. Defaults: sound ON, haptic ON. Keys live in
/// the standard `UserDefaults` so we don't need a separate store.
///
/// Observable so SwiftUI views automatically rerender when the user
/// flips a switch.
@MainActor
final class AudioHapticsSettings: ObservableObject {
    static let shared = AudioHapticsSettings()

    /// `UserDefaults` keys — namespaced under `linkfit.` to avoid
    /// collisions with third-party SDKs that might also use the
    /// standard suite.
    enum Keys {
        static let sound = "linkfit.sound.enabled"
        static let haptic = "linkfit.haptic.enabled"
    }

    private let defaults: UserDefaults

    @Published var soundEnabled: Bool {
        didSet { defaults.set(soundEnabled, forKey: Keys.sound) }
    }

    @Published var hapticEnabled: Bool {
        didSet { defaults.set(hapticEnabled, forKey: Keys.haptic) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        // Defaults: both ON. `register` gives us "if-absent" semantics —
        // explicit user toggles persist across launches.
        defaults.register(defaults: [
            Keys.sound: true,
            Keys.haptic: true,
        ])
        self.soundEnabled = defaults.bool(forKey: Keys.sound)
        self.hapticEnabled = defaults.bool(forKey: Keys.haptic)
    }
}

// MARK: - SwiftUI Toggle Surface

/// Tiny pair of toggles meant to be dropped into the Settings screen.
/// Reads from `AudioHapticsSettings.shared`, so flipping a switch takes
/// effect on the very next call to `AudioHaptics.shared.play(...)`.
///
/// Localization: the labels go through the standard `Localizable.xcstrings`
/// catalog under the `audio.*` namespace. See the `// === Audio/Haptic
/// agent ===` block at the bottom of that file.
struct AudioHapticsToggle: View {
    @ObservedObject private var settings = AudioHapticsSettings.shared

    var body: some View {
        VStack(spacing: 0) {
            Toggle(isOn: $settings.soundEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("audio.settings.sound.title", bundle: .main)
                        .font(.body)
                    Text("audio.settings.sound.subtitle", bundle: .main)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 8)

            Divider()

            Toggle(isOn: $settings.hapticEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("audio.settings.haptic.title", bundle: .main)
                        .font(.body)
                    Text("audio.settings.haptic.subtitle", bundle: .main)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 8)
        }
        .padding(.horizontal, 16)
        // Light haptic when toggling so the user feels the affordance —
        // gated on hapticEnabled so disabling it doesn't paradoxically
        // emit one more buzz.
        .onChange(of: settings.hapticEnabled) { _, newValue in
            if newValue { AudioHaptics.shared.playHaptic(.lightSelection) }
        }
        .onChange(of: settings.soundEnabled) { _, newValue in
            if newValue { AudioHaptics.shared.playSound(.lightSelection) }
        }
    }
}

#Preview("AudioHapticsToggle") {
    AudioHapticsToggle()
        .padding()
}
