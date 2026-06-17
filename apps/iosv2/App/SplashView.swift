import SwiftUI
import DesignSystem

/// In-app splash: centered wordmark + fading tagline on a solid brand canvas.
/// No decorative animation; honors Reduce Motion.
struct SplashView: View {
    @State private var taglineVisible = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            VStack(spacing: DSSpacing.m) {
                LogoWordmark(size: 40)
                Text("splash.tagline")
                    .font(DSFont.callout)
                    .foregroundStyle(DSColor.textMuted)
                    .opacity(taglineVisible ? 1 : 0)
            }
        }
        .onAppear {
            guard !reduceMotion else { taglineVisible = true; return }
            withAnimation(.easeOut(duration: 0.32).delay(0.1)) {
                taglineVisible = true
            }
        }
    }
}

#Preview { SplashView() }
