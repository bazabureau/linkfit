import SwiftUI

struct SecondaryButton: View {
    let title: String
    var icon: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            buttonLabel
        }
        .dsGlassButtonStyle()
        .accessibilityLabel(Text(LocalizedStringKey(title)))
        .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder
    private var buttonLabel: some View {
        let shape = RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)

        if #available(iOS 26.0, *) {
            labelContent
                .foregroundStyle(DSColor.accent)
                .frame(maxWidth: .infinity, minHeight: 52)
                .contentShape(shape)
        } else {
            labelContent
                .foregroundStyle(DSColor.accent)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(shape.strokeBorder(DSColor.accent, lineWidth: 1.5))
                .contentShape(shape)
        }
    }

    private var labelContent: some View {
        HStack(spacing: DSSpacing.xs) {
            if let icon { Image(systemName: icon) }
            Text(LocalizedStringKey(title)).font(DSType.buttonLabel)
        }
    }
}
