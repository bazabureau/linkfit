import Foundation
import AVFoundation

/// Audio/Haptic agent — sound dispatcher.
///
/// Owns one preloaded `AVAudioPlayer` per `SoundEffect` so a tap-driven
/// call into `play(_:)` doesn't pay the file-open + decode cost on the
/// hot path. The cache is built once during `AudioHaptics.shared` init.
///
/// Audio session policy:
///   * Category `.ambient` — explicitly chosen over `.playback` so iOS
///     respects the user's silent switch AND ducks for VoiceOver / phone
///     calls / Apple Music. Effects feel like UI sounds, not media.
///   * `.mixWithOthers` is the default for `.ambient` — when the user is
///     listening to music we layer underneath rather than pausing them.
///
/// Concurrency: `final class`, used through a single shared instance
/// inside `AudioHaptics`. All AVFoundation calls happen on the main
/// actor because `AudioHaptics` itself is `@MainActor`.
@MainActor
final class SoundPlayer {
    /// All sounds keyed by effect. Built once in `preload()`.
    private var players: [SoundEffect: AVAudioPlayer] = [:]

    /// Whether the ambient session was successfully activated. If not,
    /// `play` no-ops rather than throwing — sound is best-effort UX.
    private var sessionConfigured = false

    init() {
        configureSession()
        preload()
    }

    /// One-time `AVAudioSession` setup — `.ambient` category so we
    /// honor the silent switch, `.mixWithOthers` so background music
    /// keeps playing.
    private func configureSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
            try session.setActive(true, options: [])
            sessionConfigured = true
        } catch {
            sessionConfigured = false
        }
    }

    /// Loads every `SoundEffect`'s WAV from the main bundle. Missing
    /// resources are silently skipped — `play(_:)` will become a no-op
    /// for that effect rather than crashing.
    private func preload() {
        Task {
            var loadedPlayers: [SoundEffect: AVAudioPlayer] = [:]
            for effect in SoundEffect.allCases {
                guard let url = Bundle.main.url(forResource: effect.fileName, withExtension: "wav") else {
                    continue
                }
                do {
                    let player = try AVAudioPlayer(contentsOf: url)
                    player.numberOfLoops = 0
                    player.volume = effect.defaultVolume
                    player.prepareToPlay()
                    loadedPlayers[effect] = player
                } catch {
                    // Skip — corrupt asset, log nothing user-visible.
                    continue
                }
            }
            await MainActor.run { [weak self] in
                self?.players = loadedPlayers
            }
        }
    }

    /// Plays an effect. If the player is mid-play (e.g. a rapid burst
    /// of `pointScored` events), we rewind to zero so each tap feels
    /// immediate instead of waiting for the previous tail to fade.
    func play(_ effect: SoundEffect) {
        guard sessionConfigured, let player = players[effect] else { return }
        if player.isPlaying {
            player.currentTime = 0
        }
        player.play()
    }

    /// Re-activates the session — call from `applicationDidBecomeActive`
    /// if you ever see playback go silent after a backgrounded route
    /// change. Currently not wired up; the default boot is sufficient
    /// for the common case.
    func reactivate() {
        guard !sessionConfigured else { return }
        configureSession()
    }
}

// MARK: - SoundEffect

/// Catalog of every sound shipped in the bundle.
///
/// Filenames live in `Resources/Sounds/<rawValue>.wav` and are generated
/// by `_generate.py` — see that script for tone recipes. Keep this enum
/// in lockstep with both `HapticEffect` and the .wav files on disk.
enum SoundEffect: String, CaseIterable, Sendable {
    case gameJoined           = "game_joined"
    case gameLeft             = "game_left"
    case bookingConfirmed     = "booking_confirmed"
    case messageReceived      = "message_received"
    case messageSent          = "message_sent"
    case achievementUnlocked  = "achievement_unlocked"
    case pointScored          = "point_scored"
    case setWon               = "set_won"
    case matchWon             = "match_won"
    case matchLost            = "match_lost"
    case error                = "error"
    case lightSelection       = "light_selection"

    var fileName: String { rawValue }

    /// Per-effect attenuation. Light/incidental effects play quieter so
    /// they sit underneath VoiceOver and system sounds; outcome events
    /// (match-won, achievement) get a touch more presence — but never
    /// above 0.85 to keep the "respectful" volume contract.
    var defaultVolume: Float {
        switch self {
        case .lightSelection, .messageSent, .pointScored, .messageReceived:
            return 0.45
        case .gameJoined, .gameLeft, .error:
            return 0.55
        case .setWon, .bookingConfirmed:
            return 0.65
        case .achievementUnlocked, .matchWon, .matchLost:
            return 0.7
        }
    }
}
