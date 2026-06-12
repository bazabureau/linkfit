import SwiftUI

/// Reusable `ButtonStyle` that applies a subtle press-spring to any
/// tappable card — the same micro-interaction Strava, Instagram, and
/// Apple Sports use to acknowledge a tap before the navigation push
/// lands. Without it, a card-tap feels "dead" until the new screen
/// animates in; a 3% scale dip + spring rebound gives the user
/// instant tactile feedback that their tap registered.
///
/// Usage:
/// ```
/// Button { ... } label: { CardView() }
///     .buttonStyle(SpringPressStyle())
/// ```
///
/// The values here are deliberately conservative: too much scale or
/// too long a spring reads as "bouncy" and clashes with the calm
/// home-feed tone. 0.97 / response 0.3 / damping 0.7 matches the
/// "press-down" feel of the system `.borderedProminent` style without
/// the rectangle background.
///
/// Respects `accessibilityReduceMotion`: when reduce-motion is on, we
/// skip the scale animation entirely (a still card-press is fine; the
/// visual indication isn't load-bearing for understanding).
struct SpringPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(scale(for: configuration))
            .animation(
                reduceMotion ? .none : .spring(response: 0.3, dampingFraction: 0.7),
                value: configuration.isPressed
            )
    }

    private func scale(for configuration: Configuration) -> CGFloat {
        guard !reduceMotion else { return 1.0 }
        return configuration.isPressed ? 0.97 : 1.0
    }
}

// MARK: - Scroll-aware section reveal

/// Subtle opacity + scale fade as a section enters the scroll
/// viewport — same micro-treatment Instagram and Apple Sports use
/// to make a feed feel "alive" rather than statically pre-rendered.
/// The effect is deliberately understated (opacity 0.4 → 1.0,
/// scale 0.96 → 1.0) so it reads as polish, not a transition.
///
/// Applied via the `.homeSectionReveal(enabled:)` view extension —
/// when `enabled` is false (e.g. accessibilityReduceMotion) the
/// modifier is a no-op and the content renders at full opacity.
private struct HomeSectionRevealModifier: ViewModifier {
    let enabled: Bool

    func body(content: Content) -> some View {
        if enabled {
            content.scrollTransition(axis: .vertical) { view, phase in
                view
                    .opacity(phase.isIdentity ? 1.0 : 0.4)
                    .scaleEffect(phase.isIdentity ? 1.0 : 0.96)
                    .offset(y: phase.isIdentity ? 0 : 10)
            }
        } else {
            content
        }
    }
}

extension View {
    /// Subtle opacity-and-scale fade-in as the section enters the
    /// scroll viewport. Pass `enabled: false` from
    /// `accessibilityReduceMotion` to keep content static for users
    /// who opted out of motion.
    func homeSectionReveal(enabled: Bool = true) -> some View {
        modifier(HomeSectionRevealModifier(enabled: enabled))
    }
}

