import SwiftUI

/// Page 3 — "Klubları kəşf et" (partner courts / clubs).
///
/// A stack of three club cards fans out, each pinned to a map dot. A
/// dashed route weaves between them to suggest the network of partner
/// venues you can roam across with a single Linkfit profile.
struct CommunityIllustration: View {
    var animateIn: Bool

    private struct Club {
        let name: String
        let badge: String
        let icon: String
        let dot: CGPoint     // 0..1 in container
        let cardOffset: CGSize
        let rotation: Double
        let delay: Double
    }

    private let clubs: [Club] = [
        Club(name: "Padel İçəri Şəhər", badge: "★ 4.9", icon: "figure.tennis",
             dot: CGPoint(x: 0.22, y: 0.28),
             cardOffset: CGSize(width: -70, height: -50),
             rotation: -6, delay: 0.05),
        Club(name: "Sahil Arena", badge: "★ 4.8", icon: "sportscourt",
             dot: CGPoint(x: 0.78, y: 0.40),
             cardOffset: CGSize(width: 70, height: 30),
             rotation: 5, delay: 0.16),
        Club(name: "Yasamal Court Club", badge: "★ 4.7", icon: "figure.badminton",
             dot: CGPoint(x: 0.42, y: 0.78),
             cardOffset: CGSize(width: -30, height: 50),
             rotation: -3, delay: 0.27),
    ]

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.05, green: 0.10, blue: 0.14),
                        Color(red: 0.07, green: 0.16, blue: 0.20),
                    ],
                    startPoint: .top, endPoint: .bottom
                )

                MapGrid()
                    .stroke(DSColor.accent.opacity(0.10), lineWidth: 1)

                Path { p in
                    let pts = clubs.map { CGPoint(x: $0.dot.x * proxy.size.width,
                                                  y: $0.dot.y * proxy.size.height) }
                    guard let first = pts.first else { return }
                    p.move(to: first)
                    for pt in pts.dropFirst() { p.addLine(to: pt) }
                }
                .trimmedPath(from: 0, to: animateIn ? 1 : 0)
                .stroke(
                    DSColor.accent.opacity(0.7),
                    style: StrokeStyle(lineWidth: 1.6, lineCap: .round, dash: [3, 5])
                )
                .animation(.easeOut(duration: 0.9).delay(0.15), value: animateIn)

                ForEach(0..<clubs.count, id: \.self) { i in
                    let c = clubs[i]
                    let pos = CGPoint(x: c.dot.x * proxy.size.width,
                                      y: c.dot.y * proxy.size.height)
                    ZStack {
                        Circle()
                            .fill(DSColor.accent.opacity(0.25))
                            .frame(width: 30, height: 30)
                        Circle()
                            .fill(DSColor.accent)
                            .frame(width: 12, height: 12)
                            .shadow(color: DSColor.accent.opacity(0.7), radius: 8)
                    }
                    .position(pos)
                    .scaleEffect(animateIn ? 1 : 0.2)
                    .opacity(animateIn ? 1 : 0)
                    .animation(.spring(response: 0.45, dampingFraction: 0.7).delay(c.delay), value: animateIn)
                }

                ForEach(0..<clubs.count, id: \.self) { i in
                    let c = clubs[i]
                    let basePos = CGPoint(x: c.dot.x * proxy.size.width,
                                          y: c.dot.y * proxy.size.height)
                    clubCard(c)
                        .rotationEffect(.degrees(c.rotation))
                        .position(x: basePos.x + c.cardOffset.width,
                                  y: basePos.y + c.cardOffset.height)
                        .scaleEffect(animateIn ? 1 : 0.6)
                        .opacity(animateIn ? 1 : 0)
                        .animation(.spring(response: 0.6, dampingFraction: 0.78).delay(c.delay + 0.05), value: animateIn)
                }
            }
        }
        .accessibilityHidden(true)
    }

    private func clubCard(_ club: Club) -> some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(DSColor.accent.opacity(0.18))
                    .frame(width: 38, height: 38)
                Image(systemName: club.icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(club.name)
                    .font(.system(.footnote, design: .rounded, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                Text(club.badge)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(DSColor.accent)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(DSColor.surface)
                .shadow(color: .black.opacity(0.45), radius: 14, y: 8)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .frame(maxWidth: 200)
    }
}

private struct MapGrid: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let step: CGFloat = 40
        var x = rect.minX
        while x < rect.maxX {
            p.move(to: CGPoint(x: x, y: rect.minY))
            p.addLine(to: CGPoint(x: x, y: rect.maxY))
            x += step
        }
        var y = rect.minY
        while y < rect.maxY {
            p.move(to: CGPoint(x: rect.minX, y: y))
            p.addLine(to: CGPoint(x: rect.maxX, y: y))
            y += step
        }
        return p
    }
}
