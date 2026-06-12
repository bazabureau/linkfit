import SwiftUI

// MARK: - Game joined card

/// Story-aspect (1080×1920) share graphic the host renders right after a
/// player joins one of their padel games — or that a player renders after
/// they themselves join. Designed to thrive on Instagram Stories /
/// WhatsApp Status / Telegram: heavy gradients, big rounded panels, strong
/// typography, and a 4-slot court mock so viewers see at a glance who's
/// in and who's still missing.
///
/// Visual rhythm matches `MatchResultCard.story` so the share library
/// reads as a single family:
///   • Linkfit wordmark + brandmark at the top
///   • Huge "Yeni oyun!" headline
///   • Big rounded panel — date, time, venue, ELO band
///   • 4 player slots arranged 2×2 (court half-courts); filled slots show
///     the participant initials chip, empty slots a dashed outline
///   • Linkfit logo + referral CTA at the bottom for the growth loop
///
/// All copy is localised via `Localizable.xcstrings`. Avatars fall back to
/// initial-disc renderings (same `Avatar` idiom as `MatchResultCard`) so
/// the card always renders something graphical — important for the actor
/// that rasterises off-screen with no view tree to populate `AsyncImage`.
struct GameJoinedCard: View {
    let data: GameJoinedCardData

    var body: some View {
        ZStack {
            background
            CourtBackdrop()
                .blendMode(.plusLighter)
                .opacity(0.10)
                .allowsHitTesting(false)
            content
                .padding(.horizontal, 32)
                .padding(.vertical, 40)
        }
        .frame(width: ShareCardVariant.story.pointSize.width,
               height: ShareCardVariant.story.pointSize.height)
        .clipped()
        .environment(\.colorScheme, .dark)
    }

    // MARK: - Pieces

    private var background: some View {
        LinearGradient(
            colors: [
                Color(.sRGB, red: 0.03, green: 0.06, blue: 0.09, opacity: 1),
                Color(.sRGB, red: 0.06, green: 0.10, blue: 0.06, opacity: 1),
                Color(.sRGB, red: 0.02, green: 0.04, blue: 0.07, opacity: 1)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(
            // Bright lime halo behind the headline — pulls the eye into
            // the most graphic part of the card on the IG story carousel.
            RadialGradient(
                colors: [DSColor.accent.opacity(0.30), .clear],
                center: .topLeading,
                startRadius: 0,
                endRadius: 280
            )
        )
        .overlay(
            LinearGradient(
                colors: [.clear, Color.black.opacity(0.55)],
                startPoint: .center,
                endPoint: .bottom
            )
        )
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 28) {
            header
            headline
            detailsPanel
            slotsPanel
            Spacer(minLength: 0)
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var header: some View {
        HStack(spacing: 10) {
            LogoWordmark(size: .custom(24))
            Spacer(minLength: 0)
            Text("share_card.join.kicker")
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .tracking(2.5)
                .foregroundStyle(DSColor.textTertiary)
        }
    }

    private var headline: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Yellow chip above the headline — fast visual anchor so the
            // viewer can tell what kind of card this is from across the
            // story feed thumbnail.
            HStack(spacing: 6) {
                Circle().fill(DSColor.accent).frame(width: 8, height: 8)
                Text("share_card.join.banner")
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .tracking(3)
                    .foregroundStyle(DSColor.accent)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Capsule().fill(Color.white.opacity(0.06)))
            .overlay(Capsule().strokeBorder(DSColor.accent.opacity(0.5), lineWidth: 1))

            Text("share_card.join.headline")
                .font(.system(size: 56, weight: .black, design: .rounded))
                .foregroundStyle(DSColor.textPrimary)
                .tracking(-1.5)
                .minimumScaleFactor(0.5)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .shadow(color: DSColor.accent.opacity(0.20), radius: 30, y: 8)
        }
    }

    private var detailsPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            detailRow(symbol: "calendar",
                      labelKey: "share_card.join.detail.date",
                      value: formattedDate(data.startsAt))
            Rectangle().fill(DSColor.border.opacity(0.4)).frame(height: 1)
            detailRow(symbol: "clock.fill",
                      labelKey: "share_card.join.detail.time",
                      value: formattedTime(data.startsAt))
            Rectangle().fill(DSColor.border.opacity(0.4)).frame(height: 1)
            detailRow(symbol: "mappin.and.ellipse",
                      labelKey: "share_card.join.detail.venue",
                      value: data.venueName ?? data.sportLabel,
                      highlightValue: true)
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .fill(Color.white.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .strokeBorder(Color.white.opacity(0.09), lineWidth: 1)
        )
    }

    private func detailRow(
        symbol: String,
        labelKey: LocalizedStringKey,
        value: String,
        highlightValue: Bool = false
    ) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(DSColor.accent)
                .frame(width: 18)
            Text(labelKey)
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .tracking(2)
                .foregroundStyle(DSColor.textTertiary)
            Spacer(minLength: 0)
            Text(value)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(highlightValue ? DSColor.accent : DSColor.textPrimary)
                .lineLimit(1)
        }
    }

    private var slotsPanel: some View {
        // 2×2 mini-court layout. Slot 0 (top-left) is reserved for the
        // host so they always sit "behind the baseline"; the joining
        // player + remaining open slots fan out from there.
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("share_card.join.players.title")
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                    .tracking(2)
                    .foregroundStyle(DSColor.textSecondary)
                Spacer()
                Text("\(data.filledSlots.count)/\(data.capacity)")
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundStyle(DSColor.accent)
                    .monospacedDigit()
            }
            HStack(spacing: 12) {
                slotChip(index: 0)
                slotChip(index: 1)
            }
            HStack(spacing: 12) {
                slotChip(index: 2)
                slotChip(index: 3)
            }
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .fill(Color.white.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .strokeBorder(Color.white.opacity(0.09), lineWidth: 1)
        )
    }

    @ViewBuilder
    private func slotChip(index: Int) -> some View {
        if let player = data.filledSlots.indices.contains(index) ? data.filledSlots[index] : nil {
            HStack(spacing: 10) {
                ShareAvatar(name: player.displayName, size: 38, highlighted: player.isSelf)
                VStack(alignment: .leading, spacing: 0) {
                    Text(player.displayName)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    if player.isSelf {
                        Text("share_card.you_badge")
                            .font(.system(size: 9, weight: .heavy, design: .rounded))
                            .tracking(1.5)
                            .foregroundStyle(DSColor.accent)
                    } else if player.isHost {
                        Text("share_card.join.host_badge")
                            .font(.system(size: 9, weight: .heavy, design: .rounded))
                            .tracking(1.5)
                            .foregroundStyle(DSColor.textTertiary)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(player.isSelf
                          ? DSColor.accent.opacity(0.12)
                          : Color.white.opacity(0.04))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(player.isSelf
                                  ? DSColor.accent.opacity(0.55)
                                  : Color.white.opacity(0.08),
                                  lineWidth: 1)
            )
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            HStack(spacing: 10) {
                Circle()
                    .strokeBorder(DSColor.border.opacity(0.5),
                                  style: StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
                    .frame(width: 38, height: 38)
                    .overlay(
                        Image(systemName: "person.fill.questionmark")
                            .font(.system(size: 13, weight: .heavy))
                            .foregroundStyle(DSColor.textTertiary)
                    )
                Text("share_card.join.empty_slot")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(DSColor.textTertiary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.white.opacity(0.025))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(DSColor.border.opacity(0.35),
                                  style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            )
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var footer: some View {
        ShareCardFooter(
            ctaKey: "share.card.cta",
            referralCode: data.referralCode,
            shareURL: data.shareURL
        )
    }

    // MARK: - Date helpers

    private func formattedDate(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = .current
        f.dateStyle = .long
        f.timeStyle = .none
        return f.string(from: date)
    }

    private func formattedTime(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = .current
        f.timeStyle = .short
        f.dateStyle = .none
        return f.string(from: date)
    }
}

// MARK: - Card data

/// Immutable payload for the joined-game share card. Built off the
/// existing `GameDetail` shape in `ShareCardHook` so the host VM doesn't
/// have to round-trip another endpoint.
struct GameJoinedCardData: Sendable, Equatable {
    /// Up to 4 confirmed participants. Order matters — slot 0 reads as
    /// the host's chair, the rest fan out from there. `isSelf` flags the
    /// signed-in user so we can light up the chip with the brand accent.
    let filledSlots: [ShareCardPlayer]
    /// Total court capacity (typically 4). The 2×2 layout always draws
    /// `min(capacity, 4)` slots; remaining slots render as dashed
    /// outlines so the viewer can tell at a glance there's room to join.
    let capacity: Int
    /// "Padel" / "Tennis" — already localised at the call site.
    let sportLabel: String
    /// Optional venue. When nil we fall back to `sportLabel` so the
    /// venue row still has something to say.
    let venueName: String?
    /// When the game kicks off — formatted at render time so the locale
    /// matches the user's device language.
    let startsAt: Date
    /// Optional referral code. When set we render
    /// `linkfit.az/r/<code>` in the footer so every share becomes a
    /// growth loop. Without it the footer collapses to a plain CTA.
    let referralCode: String?
    /// Optional deep-link URL. Drives the QR code in the footer.
    let shareURL: URL?
}

extension GameJoinedCardData {
    static let preview = GameJoinedCardData(
        filledSlots: [
            ShareCardPlayer(id: "u1", displayName: "Elvin Q.", isHost: true),
            ShareCardPlayer(id: "u2", displayName: "Kamran N.", isSelf: true)
        ],
        capacity: 4,
        sportLabel: "Padel",
        venueName: "Olympic Padel Arena",
        startsAt: Date(timeIntervalSince1970: 1_715_000_000),
        referralCode: "KMRN12",
        shareURL: URL(string: "https://linkfit.az/g/abc123")
    )
}

// MARK: - Previews

#Preview("Game joined — story") {
    GameJoinedCard(data: .preview)
        .background(Color.black)
}

#Preview("Game joined — full house") {
    var slots = GameJoinedCardData.preview.filledSlots
    slots.append(ShareCardPlayer(id: "u3", displayName: "Rauf M."))
    slots.append(ShareCardPlayer(id: "u4", displayName: "Tural A."))
    let data = GameJoinedCardData(
        filledSlots: slots,
        capacity: 4,
        sportLabel: "Padel",
        venueName: "Linkfit Padel Centre",
        startsAt: Date(timeIntervalSince1970: 1_715_000_000),
        referralCode: "KMRN12",
        shareURL: URL(string: "https://linkfit.az/g/abc123")
    )
    return GameJoinedCard(data: data)
        .background(Color.black)
}
