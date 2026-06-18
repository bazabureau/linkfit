import SwiftUI

struct PrimaryButton: View {
    let title: String
    var icon: String? = nil
    var isLoading: Bool = false
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: {
            if !isLoading && isEnabled {
                Haptics.medium()   // CTA haptic per the design-system ladder
                action()
            }
        }) {
            buttonLabel
        }
        .buttonStyle(SpringPressStyle())
        .accessibilityLabel(Text(LocalizedStringKey(title)))
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(isLoading ? String(localized: "loading.button_hint") : "")
        .disabled(!isEnabled || isLoading)
    }

    @ViewBuilder
    private var buttonLabel: some View {
        let shape = RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)

        labelContent
            .foregroundStyle(DSColor.textOnAccent)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(shape.fill(isEnabled ? DSColor.accent : DSColor.accent.opacity(0.5)))
            .contentShape(shape)
    }

    private var labelContent: some View {
        HStack(spacing: DSSpacing.xs) {
            if isLoading {
                ProgressView()
                    .controlSize(.small)
                    .tint(DSColor.textOnAccent)
            } else if let icon {
                Image(systemName: icon)
            }
            Text(LocalizedStringKey(title))
                .font(DSType.buttonLabel)
        }
    }
}
