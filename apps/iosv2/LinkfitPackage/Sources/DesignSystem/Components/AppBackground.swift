import SwiftUI

/// Adaptive app canvas with a very faint court-net hairline grid and two
/// low-opacity radial tints (royal blue / lime) — the same restrained
/// atmosphere as the website. No glow, no mesh gradients.
public struct AppBackground: View {
    public init() {}

    public var body: some View {
        ZStack {
            DSColor.canvas

            // Faint court-net grid.
            GeometryReader { geo in
                Path { path in
                    let step: CGFloat = 56
                    var x: CGFloat = 0
                    while x < geo.size.width { path.move(to: .init(x: x, y: 0)); path.addLine(to: .init(x: x, y: geo.size.height)); x += step }
                    var y: CGFloat = 0
                    while y < geo.size.height { path.move(to: .init(x: 0, y: y)); path.addLine(to: .init(x: geo.size.width, y: y)); y += step }
                }
                .stroke(DSColor.textPrimary.opacity(0.025), lineWidth: 1)
            }

            // Atmospheric tints, top-right blue + bottom-left lime.
            RadialGradient(
                colors: [DSColor.accent.opacity(0.05), .clear],
                center: .topTrailing, startRadius: 0, endRadius: 420
            )
            RadialGradient(
                colors: [DSColor.lime.opacity(0.05), .clear],
                center: .bottomLeading, startRadius: 0, endRadius: 380
            )
        }
        .ignoresSafeArea()
    }
}

#Preview {
    AppBackground()
}
