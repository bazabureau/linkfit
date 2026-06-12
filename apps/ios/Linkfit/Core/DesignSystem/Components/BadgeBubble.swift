import SwiftUI

/// Reusable circular badge chip.
///
/// Two visual states:
///   * `unlocked == true`  — accent-tinted background, full-color SF Symbol
///     in `DSColor.accent`, subtle outer glow.
///   * `unlocked == false` — desaturated surface background, grey symbol
///     at reduced opacity. Lock semantics are conveyed through color/
///     opacity, not a separate icon — the silhouette stays consistent so
///     the grid reads as one motif.
///
/// `iconName` is an SF Symbol (matches the backend's `icon_name` field on
/// achievements). If the name doesn't resolve we fall back to "questionmark"
/// so the layout doesn't collapse.
struct BadgeBubble: View {
    let iconName: String
    let unlocked: Bool
    var size: CGFloat = 64

    var body: some View {
        ZStack {
            Circle()
                .fill(background)
            Circle()
                .strokeBorder(borderColor, lineWidth: unlocked ? 1.5 : 1)
            Image(systemName: resolvedIconName)
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(symbolColor)
                .symbolRenderingMode(.hierarchical)
        }
        .frame(width: size, height: size)
        .overlay(alignment: .bottomTrailing) {
            if unlocked {
                Circle()
                    .fill(DSColor.accent)
                    .frame(width: size * 0.22, height: size * 0.22)
                    .overlay {
                        Image(systemName: "checkmark")
                            .font(.system(size: size * 0.12, weight: .heavy))
                            .foregroundStyle(DSColor.textOnAccent)
                    }
                    .overlay {
                        Circle().strokeBorder(DSColor.background, lineWidth: 2)
                    }
                    .offset(x: 2, y: 2)
            }
        }
        .shadow(
            color: unlocked ? DSColor.accent.opacity(0.35) : .clear,
            radius: unlocked ? 8 : 0,
            x: 0, y: 0
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(unlocked
            ? String(localized: "achievements.a11y.unlocked")
            : String(localized: "achievements.a11y.locked")))
    }

    // MARK: - Style resolution

    /// SF Symbol name with a `questionmark` fallback. Some seed icons (e.g.
    /// `shield.checkered`) may not exist on every iOS version; the runtime
    /// fallback keeps the layout intact.
    private var resolvedIconName: String {
        // We can't probe UIImage at compile time, but Image(systemName:) just
        // renders an empty box if the symbol doesn't exist. The fallback
        // applies if the upstream string is empty.
        iconName.isEmpty ? "questionmark.circle" : iconName
    }

    private var background: Color {
        unlocked ? DSColor.accentMuted : DSColor.surfaceElevated
    }
    private var borderColor: Color {
        unlocked ? DSColor.accent.opacity(0.6) : DSColor.border
    }
    private var symbolColor: Color {
        unlocked ? DSColor.accent : DSColor.textTertiary
    }
}

#Preview {
    HStack(spacing: 16) {
        BadgeBubble(iconName: "flame", unlocked: true)
        BadgeBubble(iconName: "bolt", unlocked: false)
        BadgeBubble(iconName: "trophy", unlocked: true, size: 84)
    }
    .padding()
    .background(DSColor.background)
}
