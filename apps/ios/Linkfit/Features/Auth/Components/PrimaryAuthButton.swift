import SwiftUI

/// The primary brand CTA. Solid accent fill, three states, and a small native
/// press response. Use as the primary action on auth screens.
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
            .foregroundStyle(DSColor.textOnAccent.opacity(isEnabled ? 1 : 0.85))
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                    .fill(isEnabled ? DSColor.accent : DSColor.accent.opacity(0.42))
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                    .strokeBorder(DSColor.border.opacity(isEnabled ? 0 : 0.4), lineWidth: 1)
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
