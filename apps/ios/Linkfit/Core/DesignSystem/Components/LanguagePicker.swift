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
                    if lang == language.current {
                        Label(lang.displayKey, systemImage: "checkmark")
                    } else {
                        Text(lang.displayKey)
                    }
                }
            }
        } label: {
            HStack(spacing: DSSpacing.xxs) {
                Image(systemName: "globe")
                    .font(.system(size: 12, weight: .semibold))
                Text(language.current.displayKey)
                    .font(DSType.metaCaption)
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(DSColor.textPrimary)
            .padding(.horizontal, DSSpacing.sm)
            .frame(minHeight: 44)
            .background(Capsule().fill(DSColor.surface.opacity(0.6)))
            .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: 1))
        }
        .accessibilityLabel(Text("settings.language"))
    }
}
