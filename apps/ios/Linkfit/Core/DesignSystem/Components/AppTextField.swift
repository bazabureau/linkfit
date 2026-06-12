import SwiftUI

struct AppTextField: View {
    let title: String
    @Binding var text: String
    var placeholder: String = ""
    var keyboard: UIKeyboardType = .default
    var contentType: UITextContentType? = nil
    var isSecure: Bool = false
    var autocapitalization: TextInputAutocapitalization = .never
    var errorMessage: String? = nil

    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            Text(title)
                .font(DSType.caption)
                .foregroundStyle(DSColor.textSecondary)
            field
                .padding(.horizontal, DSSpacing.md)
                .frame(height: 48)
                .background(
                    RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                        .fill(DSColor.surfaceElevated)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                        .strokeBorder(borderColor, lineWidth: focused ? 1.5 : 1)
                )
                .focused($focused)
            if let errorMessage {
                Text(errorMessage)
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.danger)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .accessibilityValue(text)
    }

    private var borderColor: Color {
        if errorMessage != nil { return DSColor.danger }
        return focused ? DSColor.accent : DSColor.border
    }

    @ViewBuilder
    private var field: some View {
        Group {
            if isSecure {
                SecureField(placeholder, text: $text)
            } else {
                TextField(placeholder, text: $text)
            }
        }
        .keyboardType(keyboard)
        .textContentType(contentType)
        .textInputAutocapitalization(autocapitalization)
        .autocorrectionDisabled(true)
        .font(DSType.body)
        .foregroundStyle(DSColor.textPrimary)
    }
}
