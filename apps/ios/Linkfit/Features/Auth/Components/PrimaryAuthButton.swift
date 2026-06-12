import SwiftUI

/// The primary brand CTA. Locks in the accent gradient, ships with three states
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
            .foregroundStyle(DSColor.textOnAccent.opacity(isEnabled ? 1 : 0.85))
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(
                // Disabled keeps the brand fill at reduced strength so the
                // button still reads as "the action lives here" instead of
                // a dead gray slab; enabling it just turns the light on.
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: isEnabled
                                ? [DSColor.accent, DSColor.accentSoft]
                                : [DSColor.accent.opacity(0.48), DSColor.accent.opacity(0.40)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
            )
            .overlay(
                // Hairline top highlight gives the pill a slight convex
                // "pressable" sheen without resorting to heavy gloss.
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(DSColor.textOnAccent.opacity(isEnabled ? 0.18 : 0.08), lineWidth: 1)
                    .blendMode(.plusLighter)
            )
            .shadow(
                color: DSColor.accent.opacity(isEnabled ? 0.35 : 0),
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
