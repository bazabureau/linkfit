import SwiftUI

/// Brand reveal that takes over from the native launch screen.
///
/// Visual story (~0.9s on a cold launch):
///   1. Logo scales `SplashTimings.logoStartScale → .logoEndScale` with a
///      spring while a lime accent ring pulses softly behind it.
///   2. Tagline fades up underneath one beat later.
///   3. We hold long enough for the brand to register, then dissolve the
///      whole splash (`.exitFadeDuration` easeInOut) before calling
///      `onFinished`. The internal fade gives the parent a true crossfade
///      regardless of the transition it wires around us.
///
/// Reduce Motion: all elements appear at full opacity simultaneously, the
/// pulse ring stays static, and we still hold for `reduceMotionHold` so
/// the user sees the brand.
///
/// All durations live in `SplashTimings` — no magic-number `Task.sleep`
/// values in this file.
struct SplashView: View {
    var onFinished: () -> Void

    @State private var markVisible = false
    @State private var taglineVisible = false
    @State private var pulseActive = false
    @State private var isLeaving = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()

            VStack(spacing: DSSpacing.md) {
                Spacer()

                // Logo + lime pulse ring. The ring lives behind the
                // wordmark so the breathing motion is visible on the
                // outer edge without competing with the brand.
                ZStack {
                    pulseRing
                    LogoWordmark(size: .custom(40))
                }
                .scaleEffect(markVisible ? SplashTimings.logoEndScale
                                          : SplashTimings.logoStartScale)
                .opacity(markVisible ? 1 : 0)

                Text("linkfit.brand_tagline")
                    .font(.system(.subheadline, design: .rounded, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
                    .opacity(taglineVisible ? 1 : 0)
                    .offset(y: taglineVisible ? 0 : 4)

                Spacer()
                Spacer()
            }
        }
        // Splash owns its own dissolve so the handoff to routed content
        // reads as a real crossfade rather than a hard cut — even if the
        // host re-skins the transition layer above us.
        .opacity(isLeaving ? 0 : 1)
        .animation(.easeInOut(duration: SplashTimings.exitFadeDuration),
                   value: isLeaving)
        .statusBarHidden(true)
        .task { await sequence() }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("splash.voice"))
    }

    // MARK: - Pulse ring

    /// Lime accent ring that breathes softly while we wait for auth state.
    /// Sized generously around the wordmark so the pulse is felt at the
    /// edges rather than colliding with the letterforms.
    private var pulseRing: some View {
        Circle()
            .stroke(DSColor.accent.opacity(0.35), lineWidth: 1.5)
            .frame(width: 96, height: 96)
            .scaleEffect(pulseActive ? SplashTimings.pulseScaleMax
                                     : SplashTimings.pulseScaleMin)
            .opacity(pulseActive ? 0.55 : 0.9)
            .blur(radius: 0.5)
    }

    // MARK: - Sequence

    private func sequence() async {
        if reduceMotion {
            markVisible = true
            taglineVisible = true
            try? await Task.sleep(nanoseconds:
                SplashTimings.nanos(SplashTimings.reduceMotionHold))
            await leave()
            return
        }

        // Logo entrance: spring response/damping pulled straight from
        // SplashTimings so the curve can be tuned without touching the
        // view.
        withAnimation(.spring(response: SplashTimings.logoSpringResponse,
                              dampingFraction: SplashTimings.logoSpringDamping)) {
            markVisible = true
        }

        // Start the lime pulse on the same beat as the logo lands so the
        // ring feels native to the entrance rather than bolted on.
        withAnimation(.easeInOut(duration: SplashTimings.pulseDuration)
                        .repeatForever(autoreverses: true)) {
            pulseActive = true
        }

        // Tagline a beat later.
        try? await Task.sleep(nanoseconds:
            SplashTimings.nanos(SplashTimings.taglineDelay))
        withAnimation(.easeOut(duration: SplashTimings.taglineFadeDuration)) {
            taglineVisible = true
        }

        // Hold so the brand registers, then dissolve out.
        try? await Task.sleep(nanoseconds:
            SplashTimings.nanos(SplashTimings.postTaglineHold))
        await leave()
    }

    /// Trigger the internal fade-out, wait for it to complete, then hand
    /// control to the parent. The wait matches the easeInOut animation
    /// duration so the parent never sees an abrupt swap.
    private func leave() async {
        isLeaving = true
        try? await Task.sleep(nanoseconds:
            SplashTimings.nanos(SplashTimings.exitFadeDuration))
        onFinished()
    }
}
