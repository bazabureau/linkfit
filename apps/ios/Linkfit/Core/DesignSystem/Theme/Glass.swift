import SwiftUI

/// Linkfit's single source of truth for "glass" surfaces — Apple Liquid Glass.
///
/// On **iOS 26+** this renders Apple's real Liquid Glass (`.glassEffect`): a
/// translucent, refractive material that picks up and bends the content behind
/// it and reacts to motion. On **iOS 18–25** (our deployment floor is iOS 18)
/// it falls back to `.ultraThinMaterial` / `.regularMaterial` plus a hairline
/// top highlight, so the app still reads as glass on every OS we ship.
///
/// Use `.dsGlass(in:)` instead of scattering `.ultraThinMaterial` ad-hoc — one
/// knob, one place to tune, and we inherit real Liquid Glass for free as users
/// move to iOS 26.
///
/// ## Where glass belongs (Apple HIG)
/// Liquid Glass is the *navigation / control layer* that floats above content —
/// tab bars, toolbars, sheets, floating controls, and prominent CTAs. It is
/// **not** wallpaper for every content card; over-glassing flattens the very
/// hierarchy the material exists to create. Native `TabView` /
/// `NavigationStack` / sheets adopt it automatically on iOS 26 — this primitive
/// is for our *custom* floating surfaces and controls.
enum DSGlass {
    /// Standard floating surface — bars, controls, prominent cards.
    case regular
    /// More translucent — for chips / controls sitting over photos or vivid art.
    case clear
}

/// Builds the configured Liquid Glass value. Kept out of the `@ViewBuilder`
/// below because result builders can't host the imperative tint/interactive
/// mutations. iOS 26+ only.
@available(iOS 26.0, *)
private func linkfitGlass(_ variant: DSGlass, tint: Color?, interactive: Bool) -> Glass {
    var glass: Glass = variant == .clear ? .clear : .regular
    if let tint { glass = glass.tint(tint) }
    if interactive { glass = glass.interactive() }
    return glass
}

extension View {
    /// Clips Linkfit glass to `shape`. Real Liquid Glass on iOS 26+, a material
    /// fallback below. `tint` colors the glass (use sparingly — a tinted glass
    /// reads as "active / branded"); `interactive` lets the glass flex and
    /// highlight under touch (iOS 26 only — ignored on the fallback).
    @ViewBuilder
    func dsGlass(_ variant: DSGlass = .regular,
                 in shape: some Shape = RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous),
                 tint: Color? = nil,
                 interactive: Bool = false) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(linkfitGlass(variant, tint: tint, interactive: interactive), in: shape)
        } else {
            let material: Material = variant == .clear ? .ultraThinMaterial : .regularMaterial
            self
                .background(material, in: shape)
                .overlay {
                    shape.stroke(
                        LinearGradient(
                            colors: [Color.white.opacity(0.28), Color.white.opacity(0.04)],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        lineWidth: 0.5
                    )
                }
        }
    }

    /// iOS 26: the tab bar minimizes to a floating glass pill as the user
    /// scrolls down and restores on scroll up — Apple's signature Liquid Glass
    /// tab-bar behavior. No-op below iOS 26.
    @ViewBuilder
    func glassTabBarMinimize() -> some View {
        if #available(iOS 26.0, *) {
            self.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            self
        }
    }

    /// A selectable pill on the floating layer: accent-filled when selected,
    /// Liquid Glass when not. Keeps the active choice prominent while inactive
    /// options recede into glass — the iOS 26 segmented-control idiom. Apply to
    /// an already-padded label.
    @ViewBuilder
    func glassChip(isOn: Bool, tint: Color = DSColor.accent) -> some View {
        if isOn {
            self.background(Capsule().fill(tint))
        } else {
            self.dsGlass(.regular, in: Capsule())
        }
    }
}
