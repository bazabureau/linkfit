import SwiftUI

/// Compact auth text field with an iOS-native dark input surface.
struct IconTextField: View {
    let labelKey: LocalizedStringKey
    let icon: String
    @Binding var text: String
    var placeholderKey: LocalizedStringKey
    var keyboard: UIKeyboardType = .default
    var contentType: UITextContentType? = nil
    var isSecure: Bool = false
    var autocapitalization: TextInputAutocapitalization = .never
    var trailingLink: (key: LocalizedStringKey, action: () -> Void)? = nil
    var errorMessage: String? = nil

    @State private var revealed = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            HStack {
                Text(labelKey)
                    .font(DSType.bodyStrong)
                    .foregroundStyle(DSColor.textPrimary)
                Spacer()
                if let link = trailingLink {
                    Button(action: link.action) {
                        Text(link.key)
                            .font(DSType.metaCaption)
                            .foregroundStyle(DSColor.accent)
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: DSSpacing.xs) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
                    .frame(width: 22)
                field
                if isSecure {
                    Button {
                        revealed.toggle()
                    } label: {
                        Image(systemName: revealed ? "eye.slash" : "eye")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(DSColor.textSecondary)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(revealed ? Text("auth.password.hide") : Text("auth.password.show"))
                }
            }
            .padding(.horizontal, DSSpacing.md)
            .frame(minHeight: 48)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                    .fill(DSColor.surfaceElevated.opacity(0.86))
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                    .strokeBorder(borderColor, lineWidth: focused ? 1.5 : 1)
            )

            if let errorMessage {
                Text(errorMessage)
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.danger)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var borderColor: Color {
        if errorMessage != nil { return DSColor.danger }
        return focused ? DSColor.accent : DSColor.border
    }

    @ViewBuilder
    private var field: some View {
        Group {
            if isSecure && !revealed {
                SecureField("", text: $text,
                            prompt: Text(placeholderKey).foregroundStyle(DSColor.textTertiary))
            } else {
                TextField("", text: $text,
                          prompt: Text(placeholderKey).foregroundStyle(DSColor.textTertiary))
            }
        }
        .keyboardType(keyboard)
        .textContentType(contentType)
        .textInputAutocapitalization(autocapitalization)
        .autocorrectionDisabled(true)
        .font(DSType.body)
        .foregroundStyle(DSColor.textPrimary)
        .focused($focused)
    }
}
