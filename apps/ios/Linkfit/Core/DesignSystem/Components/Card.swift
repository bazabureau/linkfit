import SwiftUI

struct Card<Content: View>: View {
    var padding: CGFloat = DSSpacing.md
    var radius: CGFloat = DSRadius.lg
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
            .shadow(color: DSColor.inkSurface.opacity(0.025), radius: 8, y: 3)
    }
}

extension View {
    /// Standard content surface for feature screens.
    ///
    /// Use this for content cards, empty states, and form groups. Reserve
    /// Liquid Glass/material for navigation chrome, sheets, and controls that
    /// float above content.
    func dsSurfaceCard(radius: CGFloat = DSRadius.lg,
                       borderOpacity: Double = 1,
                       shadowOpacity: Double = 0.025) -> some View {
        background(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(DSColor.border.opacity(borderOpacity), lineWidth: 1)
        )
        .shadow(color: DSColor.inkSurface.opacity(shadowOpacity), radius: 8, y: 3)
    }
}
