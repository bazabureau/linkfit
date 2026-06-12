import SwiftUI

/// Page 1 — "Bakı'da padel oyna".
///
/// A player silhouette (rounded head + shoulders + racket) plants on a dark
/// teal court tile, while a lime locator pin drops into place beside them
/// with concentric "ping" rings rippling outward. The visual idiom: there
/// are courts and players right where you are — Linkfit shows you who's
/// playing nearby right now.
struct CourtIllustration: View {
    var animateIn: Bool

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                // Deep teal canvas with a lime spotlight from top-right.
                LinearGradient(
                    colors: [
                        Color(red: 0.04, green: 0.18, blue: 0.20),
                        Color(red: 0.06, green: 0.12, blue: 0.16),
                    ],
                    startPoint: .topTrailing, endPoint: .bottomLeading
                )
                RadialGradient(
                    colors: [DSColor.accent.opacity(0.22), .clear],
                    center: .init(x: 0.85, y: 0.12),
                    startRadius: 8,
                    endRadius: proxy.size.width * 0.85
                )

                // Faint court grid in the background (lime, low alpha).
                CourtGrid()
                    .stroke(DSColor.accent.opacity(0.18), lineWidth: 1)
                    .padding(.horizontal, proxy.size.width * 0.10)
                    .padding(.vertical, proxy.size.height * 0.14)
                    .rotation3DEffect(.degrees(22), axis: (x: 1, y: 0, z: 0))

                // Concentric "ping" rings around the pin
                let pinCenter = CGPoint(x: proxy.size.width * 0.66,
                                        y: proxy.size.height * 0.42)
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .stroke(DSColor.accent.opacity(0.45 - Double(i) * 0.12), lineWidth: 1.4)
                        .frame(width: 80, height: 80)
                        .scaleEffect(animateIn ? (1.0 + CGFloat(i) * 0.55) : 0.4)
                        .opacity(animateIn ? 0 : 0.9)
                        .position(pinCenter)
                        .animation(
                            .easeOut(duration: 1.6)
                                .repeatForever(autoreverses: false)
                                .delay(Double(i) * 0.45),
                            value: animateIn
                        )
                }

                // Locator pin
                LocatorPin()
                    .position(x: pinCenter.x, y: pinCenter.y - 14)
                    .scaleEffect(animateIn ? 1 : 0.4, anchor: .bottom)
                    .opacity(animateIn ? 1 : 0)
                    .offset(y: animateIn ? 0 : -40)
                    .animation(.spring(response: 0.55, dampingFraction: 0.62).delay(0.15), value: animateIn)

                // Player silhouette
                PlayerSilhouette()
                    .frame(width: 130, height: 200)
                    .position(x: proxy.size.width * 0.32,
                              y: proxy.size.height * 0.58)
                    .opacity(animateIn ? 1 : 0)
                    .offset(y: animateIn ? 0 : 30)
                    .animation(.spring(response: 0.6, dampingFraction: 0.78).delay(0.05), value: animateIn)

                // Subtle floor shadow under the player
                Ellipse()
                    .fill(Color.black.opacity(0.32))
                    .frame(width: 110, height: 18)
                    .blur(radius: 6)
                    .position(x: proxy.size.width * 0.32,
                              y: proxy.size.height * 0.78)
                    .opacity(animateIn ? 1 : 0)
                    .animation(.easeOut(duration: 0.4).delay(0.2), value: animateIn)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Pieces

private struct CourtGrid: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.addRect(rect)
        p.move(to: CGPoint(x: rect.minX, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        let upper = rect.minY + rect.height * 0.3
        let lower = rect.maxY - rect.height * 0.3
        p.move(to: CGPoint(x: rect.minX, y: upper))
        p.addLine(to: CGPoint(x: rect.maxX, y: upper))
        p.move(to: CGPoint(x: rect.minX, y: lower))
        p.addLine(to: CGPoint(x: rect.maxX, y: lower))
        p.move(to: CGPoint(x: rect.midX, y: upper))
        p.addLine(to: CGPoint(x: rect.midX, y: lower))
        return p
    }
}

private struct LocatorPin: View {
    var body: some View {
        ZStack {
            PinShape()
                .fill(
                    LinearGradient(
                        colors: [DSColor.accent, DSColor.accentSoft],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                .frame(width: 56, height: 76)
                .shadow(color: DSColor.accent.opacity(0.5), radius: 16, y: 6)

            Circle()
                .fill(DSColor.inkSurface)
                .frame(width: 22, height: 22)
                .offset(y: -10)
        }
    }
}

private struct PinShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let cx = rect.midX
        let topY = rect.minY
        let bottomY = rect.maxY
        let radius = rect.width / 2
        let bodyHeight = rect.height * 0.7
        // Top semicircle
        p.addArc(
            center: CGPoint(x: cx, y: topY + radius),
            radius: radius,
            startAngle: .degrees(180),
            endAngle: .degrees(0),
            clockwise: false
        )
        // Two curves narrowing to the point
        p.addQuadCurve(
            to: CGPoint(x: cx, y: bottomY),
            control: CGPoint(x: rect.maxX, y: topY + bodyHeight)
        )
        p.addQuadCurve(
            to: CGPoint(x: rect.minX, y: topY + radius),
            control: CGPoint(x: rect.minX, y: topY + bodyHeight)
        )
        p.closeSubpath()
        return p
    }
}

/// Stylised padel player silhouette built from primitives — head circle,
/// rounded body, leg trapezoid, and racket. Single tone (deep teal+white
/// outline) so it reads as a logo-style mark even at small sizes.
private struct PlayerSilhouette: View {
    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            ZStack {
                // Body
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(DSColor.textPrimary.opacity(0.92))
                    .frame(width: w * 0.62, height: h * 0.52)
                    .position(x: w * 0.5, y: h * 0.48)

                // Legs (split)
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(DSColor.textPrimary.opacity(0.92))
                        .frame(width: 24, height: h * 0.30)
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(DSColor.textPrimary.opacity(0.92))
                        .frame(width: 24, height: h * 0.30)
                }
                .position(x: w * 0.5, y: h * 0.85)

                // Head
                Circle()
                    .fill(DSColor.textPrimary.opacity(0.96))
                    .frame(width: w * 0.32, height: w * 0.32)
                    .position(x: w * 0.45, y: h * 0.15)

                // Racket arm + racket
                ZStack {
                    Capsule()
                        .fill(DSColor.textPrimary.opacity(0.92))
                        .frame(width: 12, height: 70)
                        .rotationEffect(.degrees(-18))
                        .offset(x: 18, y: -8)
                    Ellipse()
                        .strokeBorder(DSColor.accent, lineWidth: 3)
                        .background(
                            Ellipse().fill(DSColor.accent.opacity(0.18))
                        )
                        .frame(width: 40, height: 50)
                        .rotationEffect(.degrees(-18))
                        .offset(x: 32, y: -52)
                }
                .position(x: w * 0.78, y: h * 0.30)

                // Lime jersey accent band
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(DSColor.accent)
                    .frame(width: w * 0.62, height: 4)
                    .position(x: w * 0.5, y: h * 0.42)
            }
        }
    }
}
