import SwiftUI

/// Page 2 — "Səviyyənə uyğun oyun" (ELO matchmaking).
///
/// Two opposing player chips face each other across a hairline divider,
/// each labelled with an ELO badge. A lime "MATCH" connector animates
/// across between them. Reads as: Linkfit pairs you with players at your
/// level, not by chance.
struct StadiumIllustration: View {
    var animateIn: Bool

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                // Deep teal backdrop with subtle scoreboard grid
                LinearGradient(
                    colors: [
                        Color(red: 0.04, green: 0.18, blue: 0.20),
                        Color(red: 0.06, green: 0.10, blue: 0.14),
                    ],
                    startPoint: .top, endPoint: .bottom
                )

                // Bracket diagonal stripes — sport scoreboard feel
                GridStripes()
                    .stroke(DSColor.accent.opacity(0.08), lineWidth: 1)

                // Vertical dashed divider in the middle
                Path { p in
                    p.move(to: CGPoint(x: proxy.size.width / 2, y: 20))
                    p.addLine(to: CGPoint(x: proxy.size.width / 2,
                                          y: proxy.size.height - 20))
                }
                .stroke(DSColor.accent.opacity(0.4),
                        style: StrokeStyle(lineWidth: 1.2, dash: [4, 6]))

                // Two players
                playerChip(
                    initials: "AY",
                    elo: 1420,
                    accent: DSColor.accent,
                    align: .left
                )
                .position(x: proxy.size.width * 0.25, y: proxy.size.height * 0.40)
                .opacity(animateIn ? 1 : 0)
                .offset(x: animateIn ? 0 : -30)
                .animation(.spring(response: 0.55, dampingFraction: 0.75).delay(0.06), value: animateIn)

                playerChip(
                    initials: "KN",
                    elo: 1435,
                    accent: DSColor.accent,
                    align: .right
                )
                .position(x: proxy.size.width * 0.75, y: proxy.size.height * 0.40)
                .opacity(animateIn ? 1 : 0)
                .offset(x: animateIn ? 0 : 30)
                .animation(.spring(response: 0.55, dampingFraction: 0.75).delay(0.12), value: animateIn)

                // Central MATCH badge with crossed connector
                ZStack {
                    Capsule()
                        .fill(DSColor.accent)
                        .frame(width: 132, height: 44)
                        .shadow(color: DSColor.accent.opacity(0.55), radius: 18, y: 6)
                    HStack(spacing: 6) {
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 14, weight: .heavy))
                        Text("MATCH")
                            .font(.system(.subheadline, design: .rounded, weight: .heavy))
                    }
                    .foregroundStyle(DSColor.textOnAccent)
                }
                .position(x: proxy.size.width / 2, y: proxy.size.height * 0.40)
                .scaleEffect(animateIn ? 1 : 0.4)
                .opacity(animateIn ? 1 : 0)
                .animation(.spring(response: 0.5, dampingFraction: 0.6).delay(0.28), value: animateIn)

                // ELO progression bars at the bottom (skill curve)
                HStack(alignment: .bottom, spacing: 10) {
                    eloBar(h: 0.30, delay: 0.18)
                    eloBar(h: 0.48, delay: 0.22)
                    eloBar(h: 0.62, delay: 0.26)
                    eloBar(h: 0.80, delay: 0.30)
                    eloBar(h: 1.00, delay: 0.34, crown: true)
                }
                .frame(height: proxy.size.height * 0.25)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .padding(.horizontal, proxy.size.width * 0.10)
                .padding(.bottom, proxy.size.height * 0.08)
            }
        }
        .accessibilityHidden(true)
    }

    // MARK: - Player chip

    private enum Align { case left, right }

    private func playerChip(initials: String, elo: Int, accent: Color, align: Align) -> some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [DSColor.surfaceElevated, DSColor.surface],
                            startPoint: .top, endPoint: .bottom
                        )
                    )
                    .frame(width: 92, height: 92)
                    .overlay(Circle().strokeBorder(accent.opacity(0.6), lineWidth: 1.5))
                    .shadow(color: .black.opacity(0.35), radius: 8, y: 4)
                Text(initials)
                    .font(.system(size: 30, weight: .heavy, design: .rounded))
                    .foregroundStyle(DSColor.textPrimary)
            }
            HStack(spacing: 4) {
                Image(systemName: "rosette")
                    .font(.system(size: 10, weight: .bold))
                Text("\(elo) ELO")
                    .font(.system(.caption, design: .rounded, weight: .heavy))
            }
            .foregroundStyle(DSColor.textOnAccent)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(accent))
        }
        .frame(width: 110)
    }

    private func eloBar(h: CGFloat, delay: Double, crown: Bool = false) -> some View {
        ZStack(alignment: .top) {
            VStack {
                Spacer()
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [DSColor.accent, DSColor.accentSoft],
                            startPoint: .top, endPoint: .bottom
                        )
                    )
                    .frame(width: 18)
                    .frame(maxHeight: .infinity)
                    .scaleEffect(y: animateIn ? h : 0.02, anchor: .bottom)
                    .animation(.spring(response: 0.65, dampingFraction: 0.7).delay(delay), value: animateIn)
            }
            if crown {
                Image(systemName: "crown.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(DSColor.accent)
                    .offset(y: -24)
                    .opacity(animateIn ? 1 : 0)
                    .scaleEffect(animateIn ? 1 : 0.3)
                    .animation(.spring(response: 0.5, dampingFraction: 0.6).delay(delay + 0.2), value: animateIn)
                    .shadow(color: DSColor.accent.opacity(0.5), radius: 8)
            }
        }
    }
}

private struct GridStripes: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let step: CGFloat = 22
        var x: CGFloat = -rect.height
        while x < rect.width + rect.height {
            p.move(to: CGPoint(x: x, y: 0))
            p.addLine(to: CGPoint(x: x + rect.height, y: rect.height))
            x += step
        }
        return p
    }
}
