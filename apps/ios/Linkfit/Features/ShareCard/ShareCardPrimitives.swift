import SwiftUI

// MARK: - Shared share-card primitives
//
// Visual atoms used across `MatchResultCard`, `GameJoinedCard`,
// `MilestoneCard`. Promoted here (rather than embedded in each card)
// so the three cards stay in lock-step — when we tweak the brand
// halo, the lime gradient, or the footer treatment, every card moves
// together. The original `MatchResultCard` keeps its own private
// `Avatar`/`CourtLinesOverlay`/`QRCodeView` so existing previews and
// the FAZA-47 spec it shipped against don't break.

/// Initial-disc avatar used inside the new share cards
/// (`GameJoinedCard`, `MilestoneCard`). Mirrors the visual idiom from
/// the private `Avatar` inside `MatchResultCard.swift` but lives at
/// module scope so multiple cards can reach it.
///
/// `highlighted` swaps the disc fill to the lime brand gradient and
/// turns the initials ink the same dark used everywhere else — keeps
/// the "you" treatment consistent across cards.
struct ShareAvatar: View {
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
                              weight: .black, design: .rounded))
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
        return parts.compactMap { $0.first }
            .map { String($0).uppercased() }
            .joined()
    }
}

/// Subtle padel-court geometry drawn vector-style. Used as a low-opacity
/// motif behind the headline so the card whispers "sport" without
/// competing with the foreground content. The class-mate of
/// `CourtLinesOverlay` (private to `MatchResultCard`) — kept separate so
/// the two cards can iterate independently if needed.
struct CourtBackdrop: View {
    var body: some View {
        Canvas { ctx, size in
            let w = size.width
            let h = size.height
            let inset: CGFloat = 32
            let strokeColor = GraphicsContext.Shading.color(Color.white.opacity(0.35))
            let line = StrokeStyle(lineWidth: 1.2, lineCap: .round)

            // Outer court outline
            var outer = Path()
            outer.addRect(CGRect(x: inset, y: inset,
                                 width: w - inset * 2, height: h - inset * 2))
            ctx.stroke(outer, with: strokeColor, style: line)

            // Centre service line (vertical)
            var midV = Path()
            midV.move(to: CGPoint(x: w / 2, y: inset))
            midV.addLine(to: CGPoint(x: w / 2, y: h - inset))
            ctx.stroke(midV, with: strokeColor, style: line)

            // Two service lines at thirds — padel has a glass-wall band
            // we can't draw, so we cheat with extra horizontals to make
            // the geometry feel padel-ish rather than tennis-ish.
            for fraction in [1.0 / 3.0, 2.0 / 3.0] {
                var path = Path()
                path.move(to: CGPoint(x: inset, y: h * fraction))
                path.addLine(to: CGPoint(x: w - inset, y: h * fraction))
                ctx.stroke(path, with: strokeColor, style: StrokeStyle(lineWidth: 0.8))
            }
        }
    }
}

/// Bottom-of-card brand footer — "Linkfit logo · download CTA ·
/// referral URL". Shared by `GameJoinedCard` and `MilestoneCard` so
/// the growth loop is identical across both cards. `MatchResultCard`
/// keeps its bespoke QR footer because its existing layout uses a
/// different bottom rhythm.
struct ShareCardFooter: View {
    /// LocalizedStringKey for the CTA line (e.g. "Linkfit-i endir:
    /// linkfit.az"). Passed in so per-card customisation stays a
    /// one-liner at the call site.
    let ctaKey: LocalizedStringKey
    /// Optional referral code. When set, the second line shows
    /// `linkfit.az/r/<code>` — the share becomes a growth loop.
    let referralCode: String?
    /// Optional deep-link / web URL. When set, drives the QR code on
    /// the right-hand side of the footer.
    let shareURL: URL?

    var body: some View {
        HStack(spacing: 14) {
            HStack(spacing: 10) {
                LogoWordmark(size: .custom(20))
                VStack(alignment: .leading, spacing: 2) {
                    Text(ctaKey)
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .tracking(1.5)
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    if let code = referralCode, !code.isEmpty {
                        Text(verbatim: "linkfit.az/r/\(code)")
                            .font(.system(size: 12, weight: .semibold, design: .monospaced))
                            .foregroundStyle(DSColor.accent)
                            .lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 0)
            if let url = shareURL {
                // Wave-10 QR — keeps the visual rhythm of the
                // existing MatchResultCard footer. Renders through
                // the same `QRCodeRenderer` so the encoding settings
                // stay in lock-step.
                ShareCardQR(text: url.absoluteString)
                    .frame(width: 60, height: 60)
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 4)
    }
}

/// QR code rendered via `QRCodeRenderer.cgImage`. Same idiom as the
/// private `QRCodeView` inside `MatchResultCard` — promoted here so
/// the new cards can reuse the encoding settings.
private struct ShareCardQR: View {
    let text: String

    var body: some View {
        if let image = makeImage() {
            image
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .padding(4)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white)
                )
        } else {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
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

#Preview("Footer") {
    ShareCardFooter(
        ctaKey: "share.card.cta",
        referralCode: "KMRN12",
        shareURL: URL(string: "https://linkfit.az/g/abc123")
    )
    .padding()
    .background(Color.black)
    .environment(\.colorScheme, .dark)
}
