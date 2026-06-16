import SwiftUI

/// Magazine-quality post-match summary card, designed to be exported as a
/// PNG and shared to Instagram Stories / Feed / WhatsApp / Telegram.
///
/// Two layout variants share the same vocabulary so the brand reads
/// instantly no matter where the post lands:
/// - `square` (1080×1080) — IG feed, WhatsApp Status, Telegram.
/// - `story`  (1080×1920) — IG / Snapchat / WhatsApp Status full screen.
///
/// All copy is localised via `Localizable.xcstrings` under the
/// `_section.share_card_agent` marker. Avatars are drawn with `BrandMark`-
/// style initials so the card renders offline when the network fixtures
/// haven't loaded a photo yet — important for the renderer running in a
/// background task.
struct MatchResultCard: View {
    let data: ShareCardData
    let variant: ShareCardVariant

    var body: some View {
        ZStack {
            background
            CourtLinesOverlay()
                .blendMode(.plusLighter)
                .opacity(0.10)
                .allowsHitTesting(false)
            content
                .padding(.horizontal, paddingH)
                .padding(.vertical, paddingV)
        }
        .frame(width: variant.pointSize.width,
               height: variant.pointSize.height)
        .clipped()
        .environment(\.colorScheme, .dark)
    }

    // MARK: - Layout numbers

    private var paddingH: CGFloat { variant == .story ? 28 : 24 }
    private var paddingV: CGFloat { variant == .story ? 36 : 24 }
    private var scoreFontSize: CGFloat { variant == .story ? 120 : 88 }
    private var bannerFontSize: CGFloat { variant == .story ? 22 : 18 }
    private var avatarSize: CGFloat { variant == .story ? 56 : 44 }

    // MARK: - Pieces

    private var background: some View {
        LinearGradient(
            colors: [
                Color(.sRGB, red: 0.04, green: 0.07, blue: 0.10, opacity: 1),
                Color(.sRGB, red: 0.07, green: 0.11, blue: 0.06, opacity: 1),
                Color(.sRGB, red: 0.02, green: 0.05, blue: 0.08, opacity: 1)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(
            RadialGradient(
                colors: [DSColor.accent.opacity(0.18), .clear],
                center: .topTrailing,
                startRadius: 0,
                endRadius: variant.pointSize.width * 0.9
            )
        )
        .overlay(
            // Subtle bottom vignette so the footer copy lifts away from
            // the gradient and reads clean on every device.
            LinearGradient(
                colors: [.clear, Color.black.opacity(0.55)],
                startPoint: .center,
                endPoint: .bottom
            )
        )
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: variant == .story ? 28 : 18) {
            header
            outcomeBanner
            scoreBlock
            teamsBlock
            Spacer(minLength: 0)
            metaRow
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var header: some View {
        HStack(spacing: 8) {
            LogoWordmark(size: .custom(variant == .story ? 24 : 18))
            Spacer(minLength: 0)
            shareKicker
        }
    }

    private var shareKicker: some View {
        Text("share_card.kicker")
            .font(.system(size: variant == .story ? 11 : 10,
                          weight: .bold, design: .default))
            .foregroundStyle(DSColor.textTertiary)
    }

    private var outcomeBanner: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(data.outcome.accent)
                .frame(width: 8, height: 8)
            Text(data.outcome.bannerKey)
                .font(.system(size: bannerFontSize, weight: .black, design: .default))
                .foregroundStyle(data.outcome.accent)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(
            Capsule().fill(Color.white.opacity(0.06))
        )
        .overlay(
            Capsule().strokeBorder(data.outcome.accent.opacity(0.55), lineWidth: 1)
        )
    }

    private var scoreBlock: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            scoreNumeral(data.scoreSelf, highlighted: true)
            Text(":")
                .font(.system(size: scoreFontSize * 0.7,
                              weight: .black, design: .default))
                .foregroundStyle(DSColor.textTertiary)
                .baselineOffset(scoreFontSize * 0.05)
            scoreNumeral(data.scoreOpponent, highlighted: false)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func scoreNumeral(_ value: Int, highlighted: Bool) -> some View {
        Text("\(value)")
            .font(.system(size: scoreFontSize,
                          weight: .black, design: .default))
            .foregroundStyle(highlighted ? DSColor.accent : DSColor.textPrimary)
            .shadow(color: highlighted ? DSColor.accent.opacity(0.35) : .clear,
                    radius: 24, x: 0, y: 8)
            .monospacedDigit()
    }

    private var teamsBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            teamRow(players: data.selfTeam, alignment: .leading,
                    labelKey: "share_card.team.you", isSelfSide: true)
            Rectangle()
                .fill(DSColor.border.opacity(0.4))
                .frame(height: 1)
            teamRow(players: data.opponents, alignment: .leading,
                    labelKey: "share_card.team.opponents", isSelfSide: false)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.lg)
                .fill(Color.white.opacity(0.04))
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private func teamRow(
        players: [ShareCardPlayer],
        alignment: HorizontalAlignment,
        labelKey: LocalizedStringKey,
        isSelfSide: Bool
    ) -> some View {
        VStack(alignment: alignment, spacing: 6) {
            Text(labelKey)
                .font(.system(size: 10, weight: .bold, design: .default))
                .foregroundStyle(DSColor.textTertiary)
            HStack(spacing: 10) {
                ForEach(players) { player in
                    playerChip(player, isSelfSide: isSelfSide)
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func playerChip(_ player: ShareCardPlayer, isSelfSide: Bool) -> some View {
        let highlighted = player.isSelf
        return HStack(spacing: 8) {
            Avatar(name: player.displayName,
                   size: avatarSize,
                   highlighted: highlighted)
            VStack(alignment: .leading, spacing: 0) {
                Text(player.displayName)
                    .font(.system(size: variant == .story ? 15 : 13,
                                  weight: .semibold, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                if highlighted {
                    Text("share_card.you_badge")
                        .font(.system(size: 9, weight: .heavy, design: .default))
                        .foregroundStyle(DSColor.accent)
                }
            }
        }
        .padding(.trailing, 4)
    }

    private var metaRow: some View {
        HStack(spacing: 10) {
            metaChip(symbol: "mappin.and.ellipse", text: Text(data.sportAndVenue))
            metaChip(symbol: "calendar", text: Text(formattedDate))
            if let elo = data.eloChange {
                eloChip(elo)
            }
        }
    }

    private func metaChip(symbol: String, text: Text) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(DSColor.textSecondary)
            text
                .font(.system(size: variant == .story ? 12 : 11,
                              weight: .semibold, design: .default))
                .foregroundStyle(DSColor.textSecondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            Capsule().fill(Color.white.opacity(0.06))
        )
    }

    private func eloChip(_ delta: Int) -> some View {
        let sign = delta > 0 ? "+" : (delta < 0 ? "−" : "±")
        let magnitude = abs(delta)
        let positive = delta >= 0
        let tint: Color = positive ? DSColor.accent : DSColor.danger

        return HStack(spacing: 6) {
            Image(systemName: positive ? "arrow.up.right" : "arrow.down.right")
                .font(.system(size: 11, weight: .heavy))
            // Share card delta — same "+/-N xal/pts" treatment as
            // FinalResultCard so social shares stay jargon-free.
            Text(String(format: String(localized: "score.delta_format"), "\(sign)\(magnitude)"))
                .font(.system(size: variant == .story ? 12 : 11,
                              weight: .heavy, design: .default))
        }
        .foregroundStyle(positive ? DSColor.textOnAccent : Color.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            Capsule().fill(tint)
        )
        .shadow(color: tint.opacity(0.4), radius: 12, x: 0, y: 4)
    }

    private var footer: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("share_card.footer.tagline")
                    .font(.system(size: variant == .story ? 11 : 10,
                                  weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textTertiary)
                if let url = data.shareURL {
                    Text(url.host.map { $0 + url.path } ?? url.absoluteString)
                        .font(.system(size: variant == .story ? 13 : 11,
                                      weight: .semibold, design: .monospaced))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if let url = data.shareURL {
                QRCodeView(text: url.absoluteString)
                    .frame(width: variant == .story ? 64 : 48,
                           height: variant == .story ? 64 : 48)
            }
        }
        .padding(.top, 6)
    }

    // MARK: - Helpers

    private var formattedDate: String {
        let formatter = DateFormatter()
        formatter.locale = ShareCardLocale.current
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: data.date)
    }
}

// MARK: - Avatar

/// Tight, brand-matched avatar used inside the share card. Falls back to
/// initials on a lime-tinted disc so the card always renders something
/// graphical, even when no avatar URL is supplied. The renderer never
/// blocks waiting on a network image.
private struct Avatar: View {
    let name: String
    let size: CGFloat
    let highlighted: Bool

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: highlighted
                            ? [DSColor.accent, DSColor.accentSoft]
                            : [Color(.sRGB, red: 0.30, green: 0.35, blue: 0.42, opacity: 1),
                               Color(.sRGB, red: 0.18, green: 0.22, blue: 0.28, opacity: 1)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                )
            Text(initials(name))
                .font(.system(size: size * 0.38,
                              weight: .black, design: .default))
                .foregroundStyle(highlighted ? DSColor.textOnAccent : DSColor.textPrimary)
        }
        .frame(width: size, height: size)
        .overlay(
            Circle()
                .strokeBorder(highlighted ? DSColor.accent.opacity(0.6) : Color.white.opacity(0.12),
                              lineWidth: highlighted ? 2 : 1)
        )
        .shadow(color: highlighted ? DSColor.accent.opacity(0.35) : .clear,
                radius: 12, x: 0, y: 4)
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first }.map { String($0).uppercased() }
        return letters.joined()
    }
}

// MARK: - Court lines overlay

/// Subtle court-line motif drawn vector-style so it stays crisp at any
/// export resolution. Doubles as visual texture: a tennis service-line
/// grid that whispers "sport" without competing with the score.
private struct CourtLinesOverlay: View {
    var body: some View {
        Canvas { ctx, size in
            let w = size.width
            let h = size.height
            let inset: CGFloat = 24
            let strokeColor = GraphicsContext.Shading.color(Color.white.opacity(0.35))
            let line = StrokeStyle(lineWidth: 1.2, lineCap: .round)

            // Outer court
            var outer = Path()
            outer.addRect(CGRect(x: inset, y: inset,
                                 width: w - inset * 2, height: h - inset * 2))
            ctx.stroke(outer, with: strokeColor, style: line)

            // Centre service line
            var midV = Path()
            midV.move(to: CGPoint(x: w / 2, y: inset))
            midV.addLine(to: CGPoint(x: w / 2, y: h - inset))
            ctx.stroke(midV, with: strokeColor, style: line)

            // Horizontal mid line
            var midH = Path()
            midH.move(to: CGPoint(x: inset, y: h / 2))
            midH.addLine(to: CGPoint(x: w - inset, y: h / 2))
            ctx.stroke(midH, with: strokeColor, style: line)

            // Service boxes — quarter offsets
            let qx = (w - inset * 2) / 4
            let qy = (h - inset * 2) / 4
            for i in 1...3 {
                var v = Path()
                v.move(to: CGPoint(x: inset + qx * CGFloat(i), y: h / 2 - qy))
                v.addLine(to: CGPoint(x: inset + qx * CGFloat(i), y: h / 2 + qy))
                ctx.stroke(v, with: strokeColor, style: StrokeStyle(lineWidth: 0.7))
            }
        }
    }
}

// MARK: - QR Code

/// CoreImage-backed QR generator. We render here (not in the renderer)
/// so the QR pixels share the SwiftUI hierarchy and end up baked into
/// the exported PNG at the same scale as the rest of the card.
private struct QRCodeView: View {
    let text: String

    var body: some View {
        if let image = makeImage() {
            image
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .padding(4)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.white)
                )
        } else {
            // Graceful fallback — keep the visual rhythm intact.
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.white.opacity(0.08))
        }
    }

    private func makeImage() -> Image? {
        #if canImport(CoreImage) && canImport(UIKit)
        guard let cgImage = QRCodeRenderer.cgImage(for: text) else { return nil }
        return Image(decorative: cgImage, scale: 1, orientation: .up)
        #else
        return nil
        #endif
    }
}

// MARK: - Previews

#Preview("Square — Win") {
    MatchResultCard(data: .preview, variant: .square)
        .padding()
        .background(Color.black)
}

#Preview("Story — Win") {
    MatchResultCard(data: .preview, variant: .story)
        .padding()
        .background(Color.black)
}

#Preview("Story — Loss") {
    var data = ShareCardData.preview
    data = ShareCardData(
        outcome: .loss,
        scoreSelf: 3,
        scoreOpponent: 6,
        selfTeam: data.selfTeam,
        opponents: data.opponents,
        sportAndVenue: data.sportAndVenue,
        date: data.date,
        eloChange: -12,
        shareURL: data.shareURL
    )
    return MatchResultCard(data: data, variant: .story)
        .padding()
        .background(Color.black)
}
