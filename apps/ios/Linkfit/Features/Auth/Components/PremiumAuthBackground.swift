import SwiftUI

/// Auth background — multi-layer mesh gradient that gives the screen
/// depth without competing with the form.
///
/// Composition (bottom → top):
///   1. `DSColor.background` — adapts to light or dark mode.
///   2. Two soft radial gradients in lime accent + cool blue, offset to
///      opposite corners — creates a subtle "stage lighting" effect.
///   3. A thin vignette film that uses the colorScheme: black on dark to
///      deepen edges on OLED, near-clear on light so the cream canvas
///      stays open and bright.
///
/// Animated: the upper-right blob slowly orbits over 8 seconds so the
/// page never feels static. Respects Reduce Motion.
struct PremiumAuthBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @State private var phase: CGFloat = 0

    /// Edge vignette opacity. Strong on dark (deepens OLED corners);
    /// gentle on light (just a hint of shading at the bottom).
    private var vignetteOpacityTop: Double { colorScheme == .dark ? 0.18 : 0.04 }
    private var vignetteOpacityBottom: Double { colorScheme == .dark ? 0.30 : 0.06 }

    /// The vignette tint: deepest ink token, adaptive per scheme — darkens
    /// corners on OLED, soft cool gray on light for the same effect.
    private var vignetteColor: Color { DSColor.inkSurface }

    var body: some View {
        ZStack {
            DSColor.background
                .ignoresSafeArea()

            GeometryReader { proxy in
                let w = proxy.size.width
                let h = proxy.size.height

                // Upper-right royal-blue glow — the "stage" key light.
                Circle()
                    .fill(DSColor.accent.opacity(colorScheme == .dark ? 0.22 : 0.11))
                    .frame(width: w * 0.95, height: w * 0.95)
                    .blur(radius: 90)
                    .offset(
                        x: w * 0.45 + (reduceMotion ? 0 : sin(phase) * 12),
                        y: -h * 0.18 + (reduceMotion ? 0 : cos(phase) * 10)
                    )

                // Lower-left lime glow — fills the warm side of the frame.
                Circle()
                    .fill(DSColor.secondary.opacity(colorScheme == .dark ? 0.32 : 0.14))
                    .frame(width: w * 1.0, height: w * 1.0)
                    .blur(radius: 100)
                    .offset(
                        x: -w * 0.45,
                        y: h * 0.55 + (reduceMotion ? 0 : sin(phase + .pi) * 8)
                    )

                // Small counter-glow upper-left — breaks the diagonal
                // symmetry so the canvas reads as lit, not tinted.
                Circle()
                    .fill(DSColor.accent.opacity(colorScheme == .dark ? 0.10 : 0.06))
                    .frame(width: w * 0.55, height: w * 0.55)
                    .blur(radius: 80)
                    .offset(x: -w * 0.35, y: -h * 0.05)
            }
            .ignoresSafeArea()
            // Thin top/bottom vignette — strong on dark to mask Mach
            // banding on AMOLED, gentle on light so the canvas stays open.
            .overlay(
                Group {
                    if colorScheme == .dark {
                        LinearGradient(
                            colors: [
                                vignetteColor.opacity(vignetteOpacityTop),
                                Color.clear,
                                vignetteColor.opacity(vignetteOpacityBottom)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    }
                }
                .ignoresSafeArea()
                .allowsHitTesting(false)
            )
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 8).repeatForever(autoreverses: false)) {
                phase = .pi * 2
            }
        }
    }
}

#Preview {
    PremiumAuthBackground()
}
