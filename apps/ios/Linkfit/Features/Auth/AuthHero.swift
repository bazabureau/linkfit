import SwiftUI

/// Dark hero shown above the auth form card. Left side carries the LinkFit
/// wordmark + greeting; right side is a stylized "night padel court" scene
/// composited from SwiftUI shapes (no raster assets needed). Language picker
/// sits absolute top-right.
struct AuthHero: View {
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey
    let topInset: CGFloat

    var body: some View {
        ZStack(alignment: .topTrailing) {
            backdrop

            HStack(alignment: .top, spacing: 0) {
                leftBlock
                Spacer()
                nightCourtScene
                    .frame(width: 200, height: 280)
                    .offset(y: topInset)
                    .accessibilityHidden(true)
            }

            LanguagePicker()
                .padding(.top, topInset + DSSpacing.sm)
                .padding(.trailing, DSSpacing.md)
        }
    }

    private var backdrop: some View {
        ZStack {
            DSColor.background
            // Subtle stadium-light bloom from the right
            RadialGradient(
                colors: [Color(red: 0.10, green: 0.20, blue: 0.35).opacity(0.55), .clear],
                center: .init(x: 0.85, y: 0.30),
                startRadius: 8, endRadius: 280
            )
        }
        .ignoresSafeArea(edges: .top)
    }

    private var leftBlock: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            Spacer().frame(height: topInset + 60)

            // The hero on auth screens shows the brand wordmark at a
            // larger size — designers ship one PNG, we just resize.
            LogoWordmark(size: .l)
            Text("PLAY PADEL · CONNECT")
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .foregroundStyle(.white.opacity(0.65))
                .padding(.top, -DSSpacing.md)

            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 32, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.system(.body, design: .default))
                    .foregroundStyle(.white.opacity(0.65))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, DSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var nightCourtScene: some View {
        ZStack {
            // Court floor: deep blue gradient
            LinearGradient(
                colors: [
                    Color(red: 0.10, green: 0.25, blue: 0.45),
                    Color(red: 0.04, green: 0.11, blue: 0.22),
                ],
                startPoint: .topTrailing, endPoint: .bottomLeading
            )
            .clipShape(RoundedRectangle(cornerRadius: 32, style: .continuous))
            .padding(.leading, 20)

            // White court lines (perspective)
            CourtLinesArtwork()
                .stroke(Color.white.opacity(0.40), lineWidth: 1.2)
                .padding(.leading, 20)
                .padding(.top, 80)

            // Stadium floodlights at top
            HStack(spacing: 24) {
                StadiumLight()
                StadiumLight()
                StadiumLight()
            }
            .offset(y: -110)

            // Light bloom
            Circle()
                .fill(RadialGradient(
                    colors: [Color.white.opacity(0.25), .clear],
                    center: .center, startRadius: 0, endRadius: 90
                ))
                .frame(width: 200, height: 200)
                .offset(y: -50)

            // Player silhouette
            Image(systemName: "figure.tennis")
                .font(.system(size: 130, weight: .bold))
                .foregroundStyle(.white.opacity(0.92))
                .offset(x: 10, y: 20)

            // Yellow ball arcing toward player
            Circle()
                .fill(DSColor.accent)
                .frame(width: 10, height: 10)
                .shadow(color: DSColor.accent.opacity(0.7), radius: 6)
                .offset(x: -10, y: -90)
        }
    }
}

private struct CourtLinesArtwork: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        // Outer rectangle with perspective (top narrower than bottom).
        let topInsetX = rect.width * 0.20
        p.move(to: CGPoint(x: rect.minX + topInsetX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - topInsetX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        p.closeSubpath()
        // Net line (mid)
        let midY = rect.midY
        p.move(to: CGPoint(x: rect.minX + rect.width * 0.10, y: midY))
        p.addLine(to: CGPoint(x: rect.maxX - rect.width * 0.10, y: midY))
        // Center stripe
        p.move(to: CGPoint(x: rect.midX, y: rect.minY + (rect.height * 0.25)))
        p.addLine(to: CGPoint(x: rect.midX, y: rect.maxY - (rect.height * 0.10)))
        return p
    }
}

private struct StadiumLight: View {
    var body: some View {
        VStack(spacing: 2) {
            // Bulb
            ZStack {
                Circle()
                    .fill(RadialGradient(
                        colors: [.white, .white.opacity(0.05)],
                        center: .center, startRadius: 0, endRadius: 10
                    ))
                    .frame(width: 12, height: 12)
            }
            // Pole
            Rectangle()
                .fill(Color.white.opacity(0.3))
                .frame(width: 1, height: 16)
        }
        .shadow(color: .white.opacity(0.6), radius: 6)
    }
}
