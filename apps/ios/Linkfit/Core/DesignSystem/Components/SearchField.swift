import SwiftUI

/// Pill-shaped search input used by the global Search screen. Mirrors the
/// visual treatment of the inline search bar in Players/Venues so the
/// magnifying-glass entry on Home feels consistent when the dedicated
/// Search screen opens.
struct SearchField: View {
    @Binding var text: String
    var placeholderKey: LocalizedStringKey
    /// Optional autofocus on appear. Useful when the field is the primary
    /// interaction on a screen (Search) — leave off when the field is one of
    /// several controls (Players, Venues).
    var autofocus: Bool = false
    var onSubmit: (() -> Void)? = nil

    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(DSType.body)
                .foregroundStyle(DSColor.textSecondary)
                .accessibilityHidden(true)
            TextField(
                "",
                text: $text,
                prompt: Text(placeholderKey).foregroundStyle(DSColor.textTertiary)
            )
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled(true)
            .font(DSType.body)
            .foregroundStyle(DSColor.textPrimary)
            .focused($focused)
            .submitLabel(.search)
            .onSubmit { onSubmit?() }

            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(DSType.body)
                        .foregroundStyle(DSColor.textTertiary)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("common.clear"))
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .frame(height: 50)
        .background(Capsule().fill(DSColor.surface))
        .overlay(
            Capsule().strokeBorder(focused ? DSColor.accent : DSColor.border,
                                   lineWidth: focused ? 1.5 : 1)
        )
        .onAppear {
            if autofocus {
                // Slight delay so the field gains focus after the navigation
                // transition completes — focusing during the push tick is a
                // known SwiftUI footgun on iOS 18.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
                    focused = true
                }
            }
        }
    }
}
