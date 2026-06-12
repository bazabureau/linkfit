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
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(labelKey)
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                Spacer()
                if let link = trailingLink {
                    Button(action: link.action) {
                        Text(link.key)
                            .font(.system(.footnote, design: .default, weight: .semibold))
                            .foregroundStyle(DSColor.accent)
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: 10) {
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
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(revealed ? String(localized: "auth.password.hide") : String(localized: "auth.password.show"))
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(DSColor.surfaceElevated.opacity(0.86))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
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
        .font(.system(size: 16, weight: .regular, design: .default))
        .foregroundStyle(DSColor.textPrimary)
        .focused($focused)
    }
}
