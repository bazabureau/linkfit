import SwiftUI

/// Shadow-lifted card surface — the canonical container for a single item/tool.
/// Light mode: white fill + soft shadow. Dark mode: elevated tone + hairline
/// border (shadows don't read on the dark canvas). Never nest cards.
public struct DSCardModifier: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    let padding: CGFloat
    let radius: CGFloat

    public func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(DSColor.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
                    .opacity(scheme == .dark ? 1 : 0)
            )
            .dsCardShadow()
    }
}

public extension View {
    func dsCard(padding: CGFloat = DSSpacing.card, radius: CGFloat = DSRadius.card) -> some View {
        modifier(DSCardModifier(padding: padding, radius: radius))
    }
}

#Preview {
    VStack(spacing: 16) {
        VStack(alignment: .leading, spacing: 6) {
            Text("Padel at Meydan").font(DSFont.cardTitle).foregroundStyle(DSColor.textPrimary)
            Text("Today · 19:00 · 2 spots left").font(DSFont.callout).foregroundStyle(DSColor.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .dsCard()
    }
    .padding()
    .background(DSColor.canvas)
}
