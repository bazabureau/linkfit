import SwiftUI

struct PrimaryButton: View {
    let title: String
    var icon: String? = nil
    var isLoading: Bool = false
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: { if !isLoading && isEnabled { action() } }) {
            HStack(spacing: DSSpacing.xs) {
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .tint(DSColor.textOnAccent)
                } else if let icon {
                    Image(systemName: icon)
                }
                Text(title)
                    .font(DSType.buttonLabel)
            }
            .foregroundStyle(DSColor.textOnAccent)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                    .fill(isEnabled ? DSColor.accent : DSColor.accent.opacity(0.5))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(isLoading ? String(localized: "loading.button_hint") : "")
        .disabled(!isEnabled || isLoading)
    }
}
