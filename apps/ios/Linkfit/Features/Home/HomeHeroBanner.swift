import SwiftUI

/// Pitch-green hero band that anchors the Home screen. Adapts to the device
/// safe-area at the top so the greeting never collides with the status bar
/// or Dynamic Island. The background extends ABOVE the safe area; only the
/// foreground content respects it.
struct HomeHeroBanner: View {
    let firstName: String
    let unreadCount: Int
    let topInset: CGFloat
    let onAvatarTap: () -> Void
    let onBellTap: () -> Void

    private let contentHeight: CGFloat = 230

    var body: some View {
        ZStack(alignment: .top) {
            backdrop
                .frame(height: contentHeight + topInset)
                .clipShape(BannerShape())

            VStack(alignment: .leading, spacing: DSSpacing.lg) {
                topBar
                title
                Spacer(minLength: 0)
            }
            .padding(.horizontal, DSSpacing.lg)
            .padding(.top, topInset + DSSpacing.sm)
            .frame(height: contentHeight + topInset, alignment: .top)
        }
        .frame(height: contentHeight + topInset)
    }

    private var backdrop: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.40, blue: 0.24),
                    Color(red: 0.08, green: 0.55, blue: 0.32),
                    Color(red: 0.11, green: 0.66, blue: 0.40),
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            CourtLineSweep()
                .stroke(Color.white.opacity(0.10), lineWidth: 1)
            RadialGradient(
                colors: [Color.white.opacity(0.18), .clear],
                center: .init(x: 0.7, y: 0.12),
                startRadius: 8, endRadius: 220
            )
            Image(systemName: "figure.tennis")
                .font(.system(size: 52))
                .foregroundStyle(.white.opacity(0.10))
                .rotationEffect(.degrees(-18))
                .offset(x: -110, y: 80)
            Image(systemName: "sportscourt")
                .font(.system(size: 72))
                .foregroundStyle(.white.opacity(0.10))
                .offset(x: 120, y: 30)
        }
    }

    private var topBar: some View {
        HStack(spacing: DSSpacing.sm) {
            Button(action: onAvatarTap) {
                ZStack {
                    Circle().fill(Color.white.opacity(0.22))
                        .frame(width: 42, height: 42)
                    Text(initials(firstName))
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("home.your_profile"))

            VStack(alignment: .leading, spacing: 2) {
                Text("home.greeting")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(.white.opacity(0.75))
                HStack(spacing: 4) {
                    Text(firstName.isEmpty ? String(localized: "home.placeholder.player") : firstName)
                        .font(.system(.callout, design: .rounded, weight: .semibold))
                        .foregroundStyle(.white)
                    Text("👋").font(.callout)
                }
            }

            Spacer()

            Button(action: onBellTap) {
                ZStack(alignment: .topTrailing) {
                    ZStack {
                        Circle().fill(Color.white.opacity(0.22))
                            .frame(width: 42, height: 42)
                        Image(systemName: "bell.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                    if unreadCount > 0 {
                        Text(unreadCount > 9 ? "9+" : "\(unreadCount)")
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .frame(minWidth: 16, minHeight: 16)
                            .background(Capsule().fill(DSColor.danger))
                            .overlay(Capsule().strokeBorder(Color.white, lineWidth: 1.5))
                            .offset(x: 6, y: -4)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(unreadCount > 0
                ? String(format: String(localized: "home.notifications.unread_format"), unreadCount)
                : String(localized: "home.notifications"))
        }
    }

    private var title: some View {
        Text("home.title")
            .font(.system(size: 32, weight: .heavy, design: .rounded))
            .foregroundStyle(.white)
            .lineSpacing(1)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        let joined = parts.map { $0.prefix(1).uppercased() }.joined()
        return joined.isEmpty ? "L" : joined
    }
}

private struct BannerShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 0, y: 0))
        p.addLine(to: CGPoint(x: rect.maxX, y: 0))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - 30))
        p.addQuadCurve(
            to: CGPoint(x: 0, y: rect.maxY - 30),
            control: CGPoint(x: rect.midX, y: rect.maxY + 14)
        )
        p.closeSubpath()
        return p
    }
}

private struct CourtLineSweep: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let step: CGFloat = 26
        var x: CGFloat = -rect.height
        while x < rect.width {
            p.move(to: CGPoint(x: x, y: 0))
            p.addLine(to: CGPoint(x: x + rect.height, y: rect.height))
            x += step
        }
        return p
    }
}
