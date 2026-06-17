import SwiftUI

/// Selectable filter chip. Selected = accent capsule + white label; unselected =
/// tonal capsule + muted label. (Per Meydan v4: accent capsule, not ink fill.)
public struct Chip: View {
    private let title: LocalizedStringKey
    private let isSelected: Bool
    private let action: () -> Void

    public init(_ title: LocalizedStringKey, isSelected: Bool, action: @escaping () -> Void) {
        self.title = title
        self.isSelected = isSelected
        self.action = action
    }

    public var body: some View {
        Button {
            dsHaptics.selection()
            action()
        } label: {
            Text(title)
                .font(DSFont.caption)
                .foregroundStyle(isSelected ? DSColor.textOnAccent : DSColor.textMuted)
                .padding(.horizontal, DSSpacing.ml)
                .padding(.vertical, DSSpacing.sm)
                .background(
                    Capsule().fill(isSelected ? DSColor.accent : DSColor.surface2)
                )
                .overlay(
                    Capsule().strokeBorder(DSColor.border, lineWidth: isSelected ? 0 : 1)
                )
        }
        .buttonStyle(PressableButtonStyle())
        .animation(.easeOut(duration: 0.15), value: isSelected)
    }
}

#Preview {
    HStack {
        Chip("All", isSelected: true) {}
        Chip("Padel", isSelected: false) {}
        Chip("Tennis", isSelected: false) {}
    }
    .padding()
    .background(DSColor.canvas)
}
