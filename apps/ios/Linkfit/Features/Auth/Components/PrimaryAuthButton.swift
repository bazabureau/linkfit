import SwiftUI

/// The big lime CTA. Locks in the brand accent, ships with three states
/// (idle, disabled, loading), and animates the press with a tiny scale +
/// haptic. Use as the primary action on auth screens.
struct PrimaryAuthButton: View {
    let titleKey: LocalizedStringKey
    let isLoading: Bool
    let isEnabled: Bool
    let action: () -> Void

    @State private var pressed = false

    var body: some View {
        Button {
            Haptics.medium()
            action()
        } label: {
            HStack(spacing: 10) {
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .tint(DSColor.textOnAccent)
                } else {
                    Text(titleKey)
                        .font(DSType.button)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 15, weight: .heavy))
                }
            }
            .foregroundStyle(isEnabled ? DSColor.textOnAccent : DSColor.textSecondary)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(isEnabled ? DSColor.accent : DSColor.surfaceElevated.opacity(0.55))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(
                        isEnabled ? Color.clear : DSColor.border.opacity(0.5),
                        lineWidth: 1
                    )
            )
            .shadow(
                color: isEnabled ? DSColor.accent.opacity(0.35) : .clear,
                radius: pressed ? 6 : 16,
                y: pressed ? 2 : 8
            )
            .scaleEffect(pressed ? 0.97 : 1)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled || isLoading)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    if !pressed {
                        withAnimation(.spring(response: 0.22, dampingFraction: 0.7)) {
                            pressed = true
                        }
                    }
                }
                .onEnded { _ in
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                        pressed = false
                    }
                }
        )
        .accessibilityLabel(Text(titleKey))
    }
}
