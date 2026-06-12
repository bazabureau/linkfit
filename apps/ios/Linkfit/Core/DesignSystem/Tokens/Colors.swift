import SwiftUI

/// Semantic color tokens for Linkfit.
///
/// Every token is a **dynamic** color: it resolves to a light-mode value
/// when the active `UITraitCollection.userInterfaceStyle == .light` and a
/// dark-mode value otherwise. Resolution happens lazily at draw time via
/// `UIColor(dynamicProvider:)`, so applying `.preferredColorScheme(_:)`
/// at the scene root flips the entire palette instantly.
///
/// Dark mode is Linkfit's signature voice — deep ink canvas, glass
/// surfaces, bright lime accent. Light mode is a polished cream alternative
/// tuned so every token keeps its semantic role (background recedes,
/// surface lifts a touch, elevated controls sit subtly inside) while
/// preserving WCAG AA contrast against the same text tokens.
///
/// Public API: `DSColor.background`, `DSColor.surface`, etc. — same names
/// as the previous dark-only constants, so call sites don't change.
enum DSColor {
    // MARK: - Surfaces

    /// Deepest canvas. Behind everything. Near-white in light, near-black
    /// in dark — guarantees a clean field for content to sit on.
    static let background = Color(
        light: Color(hex: 0xFFFFFF),
        dark:  Color(hex: 0x0A0E14)
    )

    /// Cards & sheets — one step elevated from background. In light mode
    /// this stays bright so cards read as "lifted paper"; in dark mode it's
    /// a step brighter than the canvas.
    static let surface = Color(
        light: Color(hex: 0xFFFFFF),
        dark:  Color(hex: 0x121721)
    )

    /// Chips, inputs inside cards — one step above surface. In light mode
    /// this is a slightly tinted gray/blue so the control reads as "inset"
    /// inside the white surface; in dark mode it's brighter than surface.
    static let surfaceElevated = Color(
        light: Color(hex: 0xF0F2FB),
        dark:  Color(hex: 0x1B2332)
    )

    /// Deepest ink — bottom bar background, hero overlays. Always darker
    /// than `background` so it visually anchors the bottom edge.
    static let inkSurface = Color(
        light: Color(hex: 0xECEEF2),
        dark:  Color(hex: 0x05070A)
    )

    /// Hairline divider / stroke. Soft gray-200 in light, gray-700 in dark.
    static let border = Color(
        light: Color(hex: 0xE5E7EB),
        dark:  Color(hex: 0x1F2937)
    )

    // MARK: - Text

    /// Primary text. Near-black on light, near-white on dark.
    static let textPrimary = Color(
        light: Color(hex: 0x0F1419),
        dark:  Color(hex: 0xFFFFFF)
    )

    /// Secondary text. Gray-600 on light, gray-400 on dark.
    static let textSecondary = Color(
        light: Color(hex: 0x4B5563),
        dark:  Color(hex: 0x9CA3AF)
    )

    /// Tertiary text. Gray-500 in both modes — sits between primary and
    /// secondary on its own scale.
    static let textTertiary = Color(
        light: Color(hex: 0x6B7280),
        dark:  Color(hex: 0x6B7280)
    )

    /// Text that sits on top of the royal blue accent. Always white for contrast.
    static let textOnAccent = Color(
        light: Color(hex: 0xFFFFFF),
        dark:  Color(hex: 0xFFFFFF)
    )

    // MARK: - Brand

    /// Primary brand accent (Royal Blue).
    static let accent = Color(
        light: Color(hex: 0x5662D9),
        dark:  Color(hex: 0x5662D9)
    )

    /// Secondary brand highlight (Lime-Yellow).
    static let secondary = Color(
        light: Color(hex: 0xDCF166),
        dark:  Color(hex: 0xDCF166)
    )

    /// Pressed / hover state for accent. Deeper in both modes so the
    /// pressed feedback is visible.
    static let accentSoft = Color(
        light: Color(hex: 0x4550C4),
        dark:  Color(hex: 0x4550C4)
    )

    /// Tinted background washed with primary accent.
    static let accentMuted = Color(
        light: Color(hex: 0xF0F2FB),
        dark:  Color(hex: 0x15193B)
    )

    /// Muted background washed with secondary brand color.
    static let secondaryMuted = Color(
        light: Color(hex: 0xF2F9D3),
        dark:  Color(hex: 0x242A16)
    )

    // MARK: - Semantic

    /// Success — slightly deeper green in light for AA contrast.
    static let success = Color(
        light: Color(hex: 0x16A34A),
        dark:  Color(hex: 0x22C55E)
    )

    /// Warning — deeper amber in light for AA contrast against text.
    static let warning = Color(
        light: Color(hex: 0xD97706),
        dark:  Color(hex: 0xF59E0B)
    )

    /// Danger — deeper red in light for AA contrast.
    static let danger = Color(
        light: Color(hex: 0xDC2626),
        dark:  Color(hex: 0xEF4444)
    )

    /// Info — deeper blue in light for AA contrast.
    static let info = Color(
        light: Color(hex: 0x2563EB),
        dark:  Color(hex: 0x3B82F6)
    )

    // MARK: - Rank medals

    /// Gold rank (1st place). Use `.opacity` washes for fills.
    static let medalGold = Color(
        light: Color(hex: 0xCA8A04),
        dark:  Color(hex: 0xFACC15)
    )

    /// Silver rank (2nd place).
    static let medalSilver = Color(
        light: Color(hex: 0x4B5563),
        dark:  Color(hex: 0x9CA3AF)
    )

    /// Bronze rank (3rd place).
    static let medalBronze = Color(
        light: Color(hex: 0xC2410C),
        dark:  Color(hex: 0xFB923C)
    )

    // MARK: - Legacy aliases

    /// Legacy aliases — older view files still reference these. They
    /// forward to brand-equivalent values; safe to delete once all call
    /// sites migrate. Kept here so we don't ripple-break unrelated screens.
    static var lime: Color    { Color(hex: 0xDCF166) }
    static var limeInk: Color { Color(hex: 0x0F1419) }
}

struct AppGlassBackground: View {
    var body: some View {
        ZStack {
            DSColor.background
            RadialGradient(
                colors: [
                    DSColor.accent.opacity(0.08),
                    DSColor.background.opacity(0.0)
                ],
                center: .topTrailing,
                startRadius: 16,
                endRadius: 320
            )
            LinearGradient(
                colors: [
                    DSColor.surfaceElevated.opacity(0.1),
                    DSColor.background.opacity(0.05),
                    DSColor.background
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .ignoresSafeArea()
    }
}

typealias HomeBlurBackground = AppGlassBackground
