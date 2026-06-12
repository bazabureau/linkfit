import SwiftUI

/// Animated page indicator used on Onboarding. The active page is a wide
/// capsule; inactive pages are short. The whole row springs when the active
/// index changes — matches the reference's progress-bar feel.
struct ProgressPills: View {
    let count: Int
    let active: Int
    var spacing: CGFloat = 6
    var height: CGFloat = 5
    var inactiveWidth: CGFloat = 14
    var activeWidth: CGFloat = 32

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: spacing) {
            ForEach(0..<count, id: \.self) { i in
                Capsule()
                    .fill(i == active ? DSColor.textPrimary : DSColor.textPrimary.opacity(0.18))
                    .frame(width: i == active ? activeWidth : inactiveWidth, height: height)
            }
        }
        // Reduce Motion: skip the springy width morph; the active pill still
        // updates, just without the decorative animation.
        .animation(reduceMotion ? nil : .spring(response: 0.45, dampingFraction: 0.78),
                   value: active)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(String(format: String(localized: "progress.page_voice_format"), active + 1, count))
    }
}
