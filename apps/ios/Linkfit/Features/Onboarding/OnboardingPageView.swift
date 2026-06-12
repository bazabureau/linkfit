import SwiftUI

struct OnboardingPageView: View {
    let page: OnboardingPage
    var isActive: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var revealed = false

    var body: some View {
        GeometryReader { proxy in
            Image(page.imageName)
                .resizable()
                .scaledToFill()
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: page.imageAlignment)
                .clipped()
                .opacity(reduceMotion ? 1 : (revealed ? 1 : 0.0))
                .scaleEffect(reduceMotion ? 1 : (revealed ? 1 : 1.025))
                .animation(reduceMotion ? nil : .easeOut(duration: 0.45), value: revealed)
                .accessibilityHidden(true)
                .overlay(topScrim)
                .overlay(bottomScrim)
        }
        .background(DSColor.background)
        .ignoresSafeArea()
        .onAppear { schedule() }
        .onChange(of: isActive) { _, active in if active { schedule() } }
    }

    private var topScrim: some View {
        LinearGradient(
            colors: [
                DSColor.background.opacity(0.62),
                DSColor.background.opacity(0.16),
                Color.clear
            ],
            startPoint: .top,
            endPoint: .center
        )
        .allowsHitTesting(false)
    }

    private var bottomScrim: some View {
        LinearGradient(
            stops: [
                .init(color: Color.clear, location: 0.38),
                .init(color: DSColor.background.opacity(0.42), location: 0.64),
                .init(color: DSColor.background.opacity(0.94), location: 1.0)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .allowsHitTesting(false)
    }

    private func schedule() {
        revealed = false
        if reduceMotion {
            revealed = true
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.78)) {
                revealed = true
            }
        }
    }
}
