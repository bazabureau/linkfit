import SwiftUI

/// Modern auth text field with a floating label, focus ring, and
/// inline validation slot.
///
/// Behavior:
///   - Empty + unfocused → label sits inside the field looking like a
///     standard placeholder. The real TextField is always present and
///     tappable; the label just overlays it at full size.
///   - Focused OR has text → label springs up, shrinks, and the actual
///     input value becomes visible underneath.
///   - Errors paint the ring red and surface an inline message below.
///   - `isSecure` adds an eye toggle. `trailing` is reserved for future
///     accessory views (e.g., a custom action button).
///
/// CRITICAL: the TextField must always be hit-testable — earlier versions
/// hid it with `.opacity(0)` when not focused, which broke first-tap
/// focus. The current implementation keeps the TextField visible at all
/// times and animates the LABEL on top of it instead.
struct FloatingTextField: View {
    let labelKey: LocalizedStringKey
    let icon: String
    @Binding var text: String

    var keyboard: UIKeyboardType = .default
    var contentType: UITextContentType? = nil
    var autocapitalization: TextInputAutocapitalization = .never
    var isSecure: Bool = false
    var errorMessage: String? = nil
    var trailing: AnyView? = nil

    @FocusState private var isFocused: Bool
    @State private var revealSecure: Bool = false

    private var hasText: Bool { !text.isEmpty }
    private var floats: Bool { hasText || isFocused }
    private var hasError: Bool { errorMessage != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldRow
                .padding(.horizontal, 14)
                // minHeight (not a fixed height) so the field grows with
                // Dynamic Type instead of clipping the input at large sizes.
                .frame(minHeight: 58)
                .background(fieldBackground)
                .overlay(fieldBorder)
                .contentShape(Rectangle())
                // Wrapper tap routes focus into the actual TextField. This
                // matters when the label fills the visible space — a tap
                // on the label itself must still focus the input.
                .onTapGesture { isFocused = true }
                .animation(.spring(response: 0.32, dampingFraction: 0.85), value: isFocused)
                .animation(.spring(response: 0.32, dampingFraction: 0.85), value: hasText)
                .animation(.easeInOut(duration: 0.2), value: hasError)

            if let message = errorMessage {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.system(size: 11, weight: .semibold))
                    Text(message)
                        .font(.system(.caption, design: .default, weight: .medium))
                }
                .foregroundStyle(DSColor.danger)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private var fieldRow: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(isFocused ? DSColor.accent : DSColor.textTertiary)
                .frame(width: 22)
                .animation(.easeInOut(duration: 0.2), value: isFocused)

            // Input column: TextField is ALWAYS visible. Label rides on
            // top, shrinking + lifting when the field gains content or
            // focus. We never hide the TextField — that broke tap-to-focus
            // in the previous version.
            ZStack(alignment: .leading) {
                Group {
                    if isSecure && !revealSecure {
                        SecureField("", text: $text)
                    } else {
                        TextField("", text: $text)
                    }
                }
                .focused($isFocused)
                .keyboardType(keyboard)
                .textContentType(contentType)
                .textInputAutocapitalization(autocapitalization)
                .autocorrectionDisabled(true)
                // Dynamic Type-relative so the input scales with the user's
                // text size instead of staying pinned at 16pt.
                .font(DSType.body)
                .foregroundStyle(DSColor.textPrimary)
                .tint(DSColor.accent)
                // Push content down to make room for the floated label so
                // text doesn't crash into it. When the label is in
                // placeholder position the offset is harmless because the
                // label covers it anyway.
                .offset(y: floats ? 8 : 0)

                Text(labelKey)
                    // Dynamic Type-relative on both states: caption-scale +
                    // semibold when floated, body-scale + regular as a
                    // placeholder. Sizes track the user's text size so the
                    // label stays in step with the input as the field grows.
                    .font(floats ? DSType.caption2 : DSType.body)
                    .foregroundStyle(floats
                        ? (hasError ? DSColor.danger : DSColor.textSecondary)
                        : DSColor.textTertiary)
                    .offset(y: floats ? -14 : 0)
                    // Label must NOT swallow taps — the TextField behind
                    // it has to receive them so first-tap focus works.
                    .allowsHitTesting(false)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if isSecure {
                Button {
                    revealSecure.toggle()
                    Haptics.soft()
                } label: {
                    Image(systemName: revealSecure ? "eye.slash.fill" : "eye.fill")
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(DSColor.textTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(revealSecure
                    ? Text("auth.a11y.hide_password")
                    : Text("auth.a11y.show_password"))
            }
            trailing
        }
    }

    private var fieldBackground: some View {
        RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
            .fill(DSColor.surfaceElevated.opacity(isFocused ? 0.92 : 0.72))
    }

    @ViewBuilder
    private var fieldBorder: some View {
        let borderColor: Color = {
            if hasError { return DSColor.danger }
            if isFocused { return DSColor.accent }
            return DSColor.border.opacity(0.5)
        }()
        RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
            .strokeBorder(borderColor, lineWidth: isFocused || hasError ? 1.5 : 1)
            .shadow(color: isFocused ? DSColor.accent.opacity(0.22) : .clear,
                    radius: 10, y: 0)
    }
}
