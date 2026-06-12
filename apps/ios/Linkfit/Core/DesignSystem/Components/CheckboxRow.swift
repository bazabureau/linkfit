import SwiftUI

struct CheckboxRow: View {
    let labelKey: LocalizedStringKey
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
            UISelectionFeedbackGenerator().selectionChanged()
        } label: {
            HStack(spacing: DSSpacing.sm) {
                ZStack {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(isOn ? DSColor.secondary : Color.clear)
                        .frame(width: 22, height: 22)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .strokeBorder(isOn ? DSColor.secondary : DSColor.textSecondary,
                                              lineWidth: 1.6)
                        )
                    if isOn {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundStyle(Color.white)
                    }
                }
                Text(labelKey)
                    .font(.system(.subheadline, design: .rounded))
                    .foregroundStyle(DSColor.textPrimary)
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
    }
}
