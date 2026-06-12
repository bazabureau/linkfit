import SwiftUI

/// Page 4 — "Hazırsan?".
///
/// A giant outlined padel racket with a lime ball mid-bounce sits at the
/// centre, framed by faint orbiting court markers. The whole composition
/// breathes in on appear, then a soft lime glow pulses behind to suggest
/// "go time".
struct ReadyIllustration: View {
    var animateIn: Bool

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.05, green: 0.16, blue: 0.18),
                        Color(red: 0.06, green: 0.10, blue: 0.13),
                    ],
                    startPoint: .top, endPoint: .bottom
                )

                // Pulsing lime aura
                RadialGradient(
                    colors: [DSColor.accent.opacity(animateIn ? 0.35 : 0.12), .clear],
                    center: .center,
                    startRadius: 10,
                    endRadius: proxy.size.width * 0.55
                )
                .animation(
                    .easeInOut(duration: 1.6).repeatForever(autoreverses: true),
                    value: animateIn
                )

                // Orbiting court tiles in the back
                ForEach(0..<6, id: \.self) { i in
                    let angle = Double(i) / 6 * 2 * .pi
                    let radius = proxy.size.width * 0.36
                    let cx = proxy.size.width / 2 + cos(angle) * radius
                    let cy = proxy.size.height / 2 + sin(angle) * radius
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .strokeBorder(DSColor.accent.opacity(0.35), lineWidth: 1)
                        .frame(width: 36, height: 24)
                        .rotationEffect(.degrees(angle * 180 / .pi))
                        .position(x: cx, y: cy)
                        .opacity(animateIn ? 1 : 0)
                        .scaleEffect(animateIn ? 1 : 0.4)
                        .animation(.spring(response: 0.55, dampingFraction: 0.78).delay(0.04 * Double(i)), value: animateIn)
                }

                // Big racket
                RacketShape()
                    .fill(DSColor.accent.opacity(0.18))
                    .overlay(
                        RacketShape().stroke(DSColor.accent, lineWidth: 3)
                    )
                    .frame(width: 160, height: 240)
                    .position(x: proxy.size.width / 2,
                              y: proxy.size.height / 2 + 10)
                    .scaleEffect(animateIn ? 1 : 0.7)
                    .opacity(animateIn ? 1 : 0)
                    .rotationEffect(.degrees(animateIn ? -12 : -28),
                                    anchor: .center)
                    .animation(.spring(response: 0.6, dampingFraction: 0.7).delay(0.12), value: animateIn)

                // Ball mid-bounce, glowing
                ZStack {
                    Circle()
                        .fill(DSColor.accent)
                        .frame(width: 36, height: 36)
                    Circle()
                        .strokeBorder(Color.black.opacity(0.25), lineWidth: 1)
                        .frame(width: 36, height: 36)
                }
                .shadow(color: DSColor.accent.opacity(0.7), radius: 24)
                .position(x: proxy.size.width * 0.62,
                          y: proxy.size.height * 0.34)
                .scaleEffect(animateIn ? 1 : 0.2)
                .opacity(animateIn ? 1 : 0)
                .animation(.spring(response: 0.5, dampingFraction: 0.55).delay(0.30), value: animateIn)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Padel-style racket: rounded oval head with little vent holes outlined,
/// short tapered handle, grip wrap at the bottom.
private struct RacketShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        // Head — oval taking the top 60%
        let headHeight = rect.height * 0.60
        let headRect = CGRect(x: rect.minX, y: rect.minY,
                              width: rect.width, height: headHeight)
        p.addEllipse(in: headRect)

        // Short throat
        let throatWidth = rect.width * 0.22
        let throatRect = CGRect(
            x: rect.midX - throatWidth / 2,
            y: headRect.maxY - 8,
            width: throatWidth,
            height: rect.height * 0.10
        )
        p.addRoundedRect(in: throatRect, cornerSize: CGSize(width: 6, height: 6))

        // Handle
        let handleWidth = rect.width * 0.16
        let handleRect = CGRect(
            x: rect.midX - handleWidth / 2,
            y: throatRect.maxY,
            width: handleWidth,
            height: rect.height * 0.28
        )
        p.addRoundedRect(in: handleRect, cornerSize: CGSize(width: 8, height: 8))

        // Vent holes (decorative)
        let cols = 4
        let rows = 4
        let inset: CGFloat = 22
        let holeArea = headRect.insetBy(dx: inset, dy: inset + 10)
        let stepX = holeArea.width / CGFloat(cols - 1)
        let stepY = holeArea.height / CGFloat(rows - 1)
        for r in 0..<rows {
            for c in 0..<cols {
                let cx = holeArea.minX + CGFloat(c) * stepX
                let cy = holeArea.minY + CGFloat(r) * stepY
                let dx = cx - headRect.midX
                let dy = cy - headRect.midY
                let nx = dx / (headRect.width / 2)
                let ny = dy / (headRect.height / 2)
                guard (nx * nx + ny * ny) <= 0.78 else { continue }
                p.addEllipse(in: CGRect(x: cx - 3, y: cy - 3, width: 6, height: 6))
            }
        }
        return p
    }
}
