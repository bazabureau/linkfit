import Foundation

/// Centralised timing + motion constants for the splash sequence.
///
/// All durations live here (instead of magic-numbered `Task.sleep` calls
/// scattered through `SplashView`) so we can:
///   1. Tune the launch feel from a single file, and
///   2. Reference the same values from snapshot tests / accessibility code
///      without drifting out of sync with the animation timeline.
///
/// Durations are expressed in seconds. The `…Nanos` helpers convert to the
/// `UInt64` form `Task.sleep(nanoseconds:)` expects so callers don't have
/// to inline `1_000_000_000` multiplications.
enum SplashTimings {

    // MARK: Logo entrance

    /// Spring response for the logo scale-in. Lower = snappier.
    static let logoSpringResponse: Double = 0.6

    /// Spring damping fraction. 0.78 lands the scale just past 1.0 with a
    /// barely-perceptible settle — premium but not bouncy.
    static let logoSpringDamping: Double = 0.78

    /// Starting scale before the entrance animation fires.
    static let logoStartScale: CGFloat = 0.85

    /// Resting scale once the entrance has settled.
    static let logoEndScale: CGFloat = 1.0

    // MARK: Tagline cascade

    /// Delay between the logo landing and the tagline beginning to fade in.
    /// Beat-spacing the brand mark from the tagline reads as deliberate.
    static let taglineDelay: Double = 0.28

    /// Fade-in duration for the tagline copy.
    static let taglineFadeDuration: Double = 0.32

    // MARK: Hold + exit

    /// Hold time between the tagline finishing and the splash starting to
    /// exit. Long enough for the brand to register on a cold launch.
    static let postTaglineHold: Double = 0.55

    /// Reduce-Motion path skips the cascade but still holds long enough
    /// for the wordmark to be perceived.
    static let reduceMotionHold: Double = 0.7

    /// Crossfade duration as the splash dissolves into the routed content.
    /// 250ms ease-in-out is the spec target; soft enough to feel cinematic,
    /// quick enough to avoid blocking the user's first interaction.
    static let exitFadeDuration: Double = 0.25

    // MARK: Nanosecond helpers

    /// Convert seconds → nanoseconds for `Task.sleep(nanoseconds:)`.
    /// Clamps negatives to 0 so we never trap on a misconfigured constant.
    static func nanos(_ seconds: Double) -> UInt64 {
        UInt64(max(0, seconds) * 1_000_000_000)
    }
}
