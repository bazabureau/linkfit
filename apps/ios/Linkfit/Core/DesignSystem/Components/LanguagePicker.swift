import SwiftUI

/// Pill-style language menu, used in the top-right of Auth screens. Reads
/// and writes `LanguageManager` so the choice takes effect everywhere.
struct LanguagePicker: View {
    @Environment(LanguageManager.self) private var language

    var body: some View {
        Menu {
            ForEach(AppLanguage.allCases) { lang in
                Button {
                    language.current = lang
                    UISelectionFeedbackGenerator().selectionChanged()
                } label: {
                    Label(lang.displayKey, systemImage: lang == language.current ? "checkmark" : "")
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "globe")
                    .font(.system(size: 12, weight: .semibold))
                Text(language.current.displayKey)
                    .font(.system(.footnote, design: .rounded, weight: .semibold))
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(DSColor.textPrimary)
            .padding(.horizontal, DSSpacing.sm)
            .padding(.vertical, 8)
            .background(Capsule().fill(DSColor.surface.opacity(0.6)))
            .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: 1))
        }
    }
}
