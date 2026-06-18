import SwiftUI

/// Brand reveal that takes over from the native launch screen.
///
/// Visual story (~0.9s on a cold launch):
///   1. Logo scales `SplashTimings.logoStartScale → .logoEndScale` with a
///      spring over the adaptive app canvas.
///   2. Tagline fades up underneath one beat later.
///   3. We hold long enough for the brand to register, then dissolve the
///      whole splash (`.exitFadeDuration` easeInOut) before calling
///      `onFinished`. The internal fade gives the parent a true crossfade
///      regardless of the transition it wires around us.
///
/// Reduce Motion: all elements appear at full opacity simultaneously and we
/// still hold for `reduceMotionHold` so the user sees the brand.
///
/// All durations live in `SplashTimings` — no magic-number `Task.sleep`
/// values in this file.
struct SplashView: View {
    var onFinished: () -> Void

    @State private var markVisible = false
    @State private var taglineVisible = false
    @State private var isLeaving = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()

            VStack(spacing: DSSpacing.md) {
                Spacer()

                LogoWordmark(size: .custom(40))
                    .scaleEffect(markVisible ? SplashTimings.logoEndScale
                                              : SplashTimings.logoStartScale)
                    .opacity(markVisible ? 1 : 0)

                Text("linkfit.brand_tagline")
                    .font(.system(.subheadline, design: .default, weight: .medium))
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
