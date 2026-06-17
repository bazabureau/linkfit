import SwiftUI
import UIKit

/// Text field with a floating label that rises when focused or filled, an
/// optional leading icon, secure-entry reveal toggle, and inline error text.
/// Tap-to-focus works on the first tap (no opacity traps).
public struct FloatingTextField: View {
    private let label: LocalizedStringKey
    private let icon: String?
    @Binding private var text: String
    private let isSecure: Bool
    private let keyboard: UIKeyboardType
    private let contentType: UITextContentType?
    private let submitLabel: SubmitLabel
    private let error: String?
    private let onSubmit: () -> Void

    @FocusState private var focused: Bool
    @State private var revealed = false

    public init(
        _ label: LocalizedStringKey,
        text: Binding<String>,
        icon: String? = nil,
        isSecure: Bool = false,
        keyboard: UIKeyboardType = .default,
        contentType: UITextContentType? = nil,
        submitLabel: SubmitLabel = .next,
        error: String? = nil,
        onSubmit: @escaping () -> Void = {}
    ) {
        self.label = label
        self._text = text
        self.icon = icon
        self.isSecure = isSecure
        self.keyboard = keyboard
        self.contentType = contentType
        self.submitLabel = submitLabel
        self.error = error
        self.onSubmit = onSubmit
    }

    private var isFloating: Bool { focused || !text.isEmpty }

    public var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            HStack(spacing: DSSpacing.m) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(focused ? DSColor.accent : DSColor.textDim)
                        .frame(width: 20)
                }

                ZStack(alignment: .leading) {
                    Text(label)
                        .font(isFloating ? DSFont.micro : DSFont.body)
                        .foregroundStyle(focused ? DSColor.accent : DSColor.textDim)
                        .offset(y: isFloating ? -16 : 0)
                        .scaleEffect(isFloating ? 1 : 1, anchor: .leading)
                        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isFloating)

                    field
                        .font(DSFont.body)
                        .foregroundStyle(DSColor.textPrimary)
                        .tint(DSColor.accent)
                        .keyboardType(keyboard)
                        .textContentType(contentType)
                        .textInputAutocapitalization(keyboard == .emailAddress ? .never : .sentences)
                        .autocorrectionDisabled(keyboard == .emailAddress)
                        .submitLabel(submitLabel)
                        .focused($focused)
                        .onSubmit(onSubmit)
                        .offset(y: isFloating ? 8 : 0)
                }

                if isSecure && !text.isEmpty {
                    Button {
                        revealed.toggle()
                    } label: {
                        Image(systemName: revealed ? "eye.slash.fill" : "eye.fill")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(DSColor.textDim)
                    }
                    .accessibilityLabel(revealed ? "Hide password" : "Show password")
                }
            }
            .padding(.horizontal, DSSpacing.l)
            .frame(height: 58)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.button, style: .continuous)
                    .fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.button, style: .continuous)
                    .strokeBorder(borderColor, lineWidth: 1.5)
            )
            .contentShape(Rectangle())
            .onTapGesture { focused = true }

            if let error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(DSFont.caption)
                    .foregroundStyle(DSColor.danger)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: error)
    }

    @ViewBuilder private var field: some View {
        if isSecure && !revealed {
            SecureField("", text: $text)
        } else {
            TextField("", text: $text)
        }
    }

    private var borderColor: Color {
        if error != nil { return DSColor.danger }
        return focused ? DSColor.accent : DSColor.border
    }
}

#Preview {
    struct Demo: View {
        @State var email = ""
        @State var pass = "secret"
        var body: some View {
            VStack(spacing: 16) {
                FloatingTextField("Email", text: $email, icon: "envelope.fill", keyboard: .emailAddress, contentType: .emailAddress)
                FloatingTextField("Password", text: $pass, icon: "lock.fill", isSecure: true, error: "Password is too short")
            }
            .padding()
            .background(DSColor.canvas)
        }
    }
    return Demo()
}
