import SwiftUI

// MARK: - Milestone (skill-level) share card

/// Story-aspect (1080×1920) share graphic the user can post when they
/// reach a new `SkillLevel` — Strava-style achievement card. Renders
/// outside the rating flow so the user can share their *current* level
/// too (handy for the very first onboarding moment, when nobody has yet
/// "levelled up" but they still want to flex what they are).
///
/// Visual hierarchy from top to bottom:
///   • Linkfit wordmark + brandmark
///   • Yellow chip "YENİ SƏVİYYƏ" — the kicker
///   • Huge "Yeni səviyyə!" headline
///   • Optional from→to arrow (only when `previousLevel` is set)
///   • Big circular badge with the level's SF Symbol + Azerbaijani name
///   • Microline "Bu N-ci oyunumdan sonra"
///   • Linkfit logo + referral CTA at the bottom (growth loop)
struct MilestoneCard: View {
    let data: MilestoneCardData

    var body: some View {
        ZStack {
            background
            CourtBackdrop()
                .blendMode(.plusLighter)
                .opacity(0.08)
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
                Color(.sRGB, red: 0.04, green: 0.07, blue: 0.10, opacity: 1),
                Color(.sRGB, red: 0.08, green: 0.10, blue: 0.05, opacity: 1),
                Color(.sRGB, red: 0.02, green: 0.04, blue: 0.07, opacity: 1)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(
            // Lime halo pushed to the centre so the big badge feels
            // illuminated — the badge is the hero of this card.
            RadialGradient(
                colors: [DSColor.accent.opacity(0.35), .clear],
                center: .center,
                startRadius: 30,
                endRadius: 360
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
        VStack(alignment: .leading, spacing: 24) {
            header
            headlineBlock
            Spacer(minLength: 0)
            badge
            Spacer(minLength: 0)
            microline
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var header: some View {
        HStack(spacing: 10) {
            LogoWordmark(size: .custom(24))
            Spacer(minLength: 0)
            Text("share_card.milestone.kicker")
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .tracking(2.5)
                .foregroundStyle(DSColor.textTertiary)
        }
    }

    private var headlineBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Circle().fill(DSColor.accent).frame(width: 8, height: 8)
                Text("share_card.milestone.banner")
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .tracking(3)
                    .foregroundStyle(DSColor.accent)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Capsule().fill(Color.white.opacity(0.06)))
            .overlay(Capsule().strokeBorder(DSColor.accent.opacity(0.5), lineWidth: 1))

            Text("share_card.milestone.headline")
                .font(.system(size: 56, weight: .black, design: .rounded))
                .foregroundStyle(DSColor.textPrimary)
                .tracking(-1.5)
                .minimumScaleFactor(0.5)
                .lineLimit(2)
                .shadow(color: DSColor.accent.opacity(0.20), radius: 30, y: 8)
        }
    }

    private var badge: some View {
        VStack(spacing: 18) {
            // From→To pill (only when we know the previous level — for
            // the very first milestone share we just lead with the
            // current level, no arrow.)
            if let previous = data.previousLevel, previous != data.currentLevel {
                HStack(spacing: 12) {
                    levelPill(previous, dimmed: true)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 18, weight: .heavy))
                        .foregroundStyle(DSColor.accent)
                    levelPill(data.currentLevel, dimmed: false)
                }
            }

            // Big round badge — the hero element. Uses the SF Symbol
            // from `SkillLevel` so beginner→pro feel visually
            // distinguishable even before the user reads the label.
            ZStack {
                // Outer halo
                Circle()
                    .fill(DSColor.accent.opacity(0.18))
                    .frame(width: 280, height: 280)
                    .blur(radius: 30)
                // Ring + ink fill
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(.sRGB, red: 0.08, green: 0.12, blue: 0.14, opacity: 1),
                                Color(.sRGB, red: 0.05, green: 0.08, blue: 0.10, opacity: 1)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 220, height: 220)
                    .overlay(
                        Circle()
                            .strokeBorder(DSColor.accent.opacity(0.6), lineWidth: 3)
                    )
                    .shadow(color: DSColor.accent.opacity(0.30), radius: 24, y: 8)

                VStack(spacing: 8) {
                    Image(systemName: data.currentLevel.systemImage)
                        .font(.system(size: 64, weight: .heavy))
                        .foregroundStyle(DSColor.accent)
                    Text(data.currentLevel.labelKey)
                        .font(.system(size: 22, weight: .black, design: .rounded))
                        .foregroundStyle(DSColor.textPrimary)
                        .multilineTextAlignment(.center)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func levelPill(_ level: SkillLevel, dimmed: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: level.systemImage)
                .font(.system(size: 11, weight: .heavy))
            Text(level.labelKey)
                .font(.system(size: 13, weight: .heavy, design: .rounded))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .foregroundStyle(dimmed ? DSColor.textTertiary : DSColor.accent)
        .background(
            Capsule().fill(Color.white.opacity(dimmed ? 0.04 : 0.10))
        )
        .overlay(
            Capsule().strokeBorder(
                dimmed ? Color.white.opacity(0.10) : DSColor.accent.opacity(0.5),
                lineWidth: 1
            )
        )
    }

    private var microline: some View {
        // "Bu 12-ci oyunumdan sonra" — supplies social proof. We hide
        // the line altogether when the games-played count is zero
        // (e.g. fresh profile shares) so the card doesn't say "0-ci
        // oyunumdan sonra" which reads odd in Azerbaijani.
        Group {
            if data.gamesPlayed > 0 {
                Text(String(format: String(localized: "share_card.milestone.after_games_format"),
                            data.gamesPlayed))
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
    }

    private var footer: some View {
        ShareCardFooter(
            ctaKey: "share.card.cta",
            referralCode: data.referralCode,
            shareURL: data.shareURL
        )
    }
}

// MARK: - Card data

struct MilestoneCardData: Sendable, Equatable {
    /// The level the user is announcing. Drives the hero badge.
    let currentLevel: SkillLevel
    /// Previous skill level — when set, the card renders a from→to
    /// arrow so the "jump" reads visually. Pass `nil` for first-time
    /// shares where we just want to flex the current level.
    let previousLevel: SkillLevel?
    /// The user's display name. Rendered nowhere on the body of the
    /// card today, but kept around so future copy variants ("Kamran,
    /// you're now Təcrübəli!") can opt in without re-threading the
    /// payload through every call site.
    let displayName: String
    /// Number of games played in the relevant sport. Drives the
    /// "after N games" microline beneath the badge.
    let gamesPlayed: Int
    /// Optional referral code. Same growth-loop behaviour as
    /// `GameJoinedCardData`.
    let referralCode: String?
    /// Optional deep-link URL for the QR code.
    let shareURL: URL?
}

extension MilestoneCardData {
    static let preview = MilestoneCardData(
        currentLevel: .advanced,
        previousLevel: .intermediate,
        displayName: "Kamran N.",
        gamesPlayed: 12,
        referralCode: "KMRN12",
        shareURL: URL(string: "https://linkfit.az/u/abc")
    )
}

// MARK: - Previews

#Preview("Milestone — advanced") {
    MilestoneCard(data: .preview)
        .background(Color.black)
}

#Preview("Milestone — first share") {
    let data = MilestoneCardData(
        currentLevel: .intermediate,
        previousLevel: nil,
        displayName: "Kamran N.",
        gamesPlayed: 0,
        referralCode: nil,
        shareURL: URL(string: "https://linkfit.az/u/abc")
    )
    return MilestoneCard(data: data)
        .background(Color.black)
}

#Preview("Milestone — pro") {
    let data = MilestoneCardData(
        currentLevel: .expert,
        previousLevel: .advanced,
        displayName: "Kamran N.",
        gamesPlayed: 87,
        referralCode: "KMRN12",
        shareURL: URL(string: "https://linkfit.az/u/abc")
    )
    return MilestoneCard(data: data)
        .background(Color.black)
}
