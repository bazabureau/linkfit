import SwiftUI

/// Linkfit's shared motion vocabulary.
///
/// A small set of native SwiftUI animation curves so the whole app moves with
/// one rhythm, plus a few reduce-motion-aware modifiers. Apple's guidance is
/// **restraint**: motion should clarify state changes and hierarchy, not
/// decorate. Everything here degrades to "instant" under Reduce Motion.
enum Motion {
    /// Most state changes — selection, expand/collapse, reordering.
    static let spring: Animation = .snappy(duration: 0.34)
    /// Larger surfaces — sheets, hero cards, section reveals.
    static let soft: Animation = .smooth(duration: 0.44)
    /// Immediate reactions — taps, toggles, chips.
    static let quick: Animation = .snappy(duration: 0.22)
}

// MARK: - Appear (staggered fade + rise)

private struct AppearStagger: ViewModifier {
    let index: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 14)
            .onAppear {
                guard !shown else { return }
                if reduceMotion { shown = true; return }
                withAnimation(.smooth(duration: 0.5).delay(Double(index) * 0.06)) {
                    shown = true
                }
            }
    }
}

extension View {
    /// Fade + rise on first appearance, staggered by `index` so a list/feed
    /// arrives as a calm cascade instead of snapping in. Reduce Motion → the
    /// content is shown instantly with no offset. Best for feed sections and
    /// card rows; keep `index` small (the delay is `index * 0.06s`).
    func appearStagger(_ index: Int) -> some View {
        modifier(AppearStagger(index: index))
    }

    /// Animate digit changes with the native rolling-number transition. Pair on
    /// a `Text` whose value changes (scores, counts, ELO). `value` is what the
    /// number derives from, so the roll fires exactly when it updates.
    func rollingNumber(_ value: some Equatable) -> some View {
        self
            .contentTransition(.numericText())
            .animation(.snappy(duration: 0.35), value: value)
    }
}
