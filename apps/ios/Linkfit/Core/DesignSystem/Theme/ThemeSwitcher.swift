import SwiftUI

/// Segmented picker that lets the user pick System / Light / Dark.
/// Reads and writes `ThemeManager` from the environment so the change
/// takes effect everywhere through `.preferredColorScheme(_:)` at the
/// scene root.
///
/// This view is exported but **not** wired into Settings here — the
/// Settings agent embeds it on the appropriate row. It's self-contained
/// and just needs `ThemeManager` in the environment.
struct ThemeSwitcher: View {
    @Environment(ThemeManager.self) private var theme

    var body: some View {
        @Bindable var theme = theme
        HStack(spacing: 6) {
            ForEach(AppearanceMode.allCases) { mode in
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    withAnimation(.easeInOut(duration: 0.25)) {
                        theme.mode = mode
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: mode.symbolName)
                            .font(.system(size: 13, weight: .semibold))
                        Text(mode.displayKey)
                            .font(.system(.footnote, design: .rounded, weight: .semibold))
                    }
                    .foregroundStyle(
                        theme.mode == mode
                            ? DSColor.textOnAccent
                            : DSColor.textPrimary
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(theme.mode == mode ? DSColor.accent : Color.clear)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .animation(.easeInOut(duration: 0.25), value: theme.mode)
    }
}

#Preview {
    ThemeSwitcher()
        .environment(ThemeManager())
        .padding()
        .background(DSColor.background)
}
