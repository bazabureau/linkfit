import SwiftUI

/// Horizontal carousel of players near the viewer. The third
/// discovery surface on home (alongside upcoming matches and clubs)
/// and the one the Linkfit experience previously lacked an entry
/// point to — the PlayersView itself was orphaned. With this carousel
/// you can tap a face, land on their profile, and follow / message in
/// a single second.
///
/// Each card is intentionally small (140pt wide) so 2.5–3 cards
/// peek at the viewport edge — the canonical "there's more" cue.
struct HomePlayersRow: View {
    let players: [PlayerSummary]
    var onTapPlayer: (PlayerSummary) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(players.prefix(10)) { player in
                    PlayerCarouselCard(player: player) {
                        onTapPlayer(player)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

private struct PlayerCarouselCard: View {
    let player: PlayerSummary
    var action: () -> Void

    var body: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            action()
        } label: {
            VStack(spacing: 10) {
                avatar
                VStack(spacing: 2) {
                    Text(player.display_name)
                        .font(.system(size: 13, weight: .heavy, design: .default))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .minimumScaleFactor(0.85)
                    if player.primary_elo != nil {
                        // Word-based skill label (Yeni / Orta / Təcrübəli /
                        // Peşəkar) hides the raw ELO integer — the term
                        // means nothing to most padel players. Backend
                        // keeps the ELO mechanism; iOS surfaces the
                        // semantic bucket via `SkillLevel.from(elo:)`.
                        Text(SkillLevel.from(elo: player.primary_elo).labelKey)
                            .font(.system(size: 11, weight: .semibold, design: .default))
                            .foregroundStyle(SkillLevel.from(elo: player.primary_elo).accent)
                            .lineLimit(1)
                    } else if let km = player.distance_km {
                        Text(DistanceFormatter.km(km))
                            .font(.system(size: 11, weight: .semibold, design: .default))
                            .foregroundStyle(DSColor.textSecondary)
                            .monospacedDigit()
                            .lineLimit(1)
                    }
                }
                .padding(.horizontal, 4)
            }
            .padding(.vertical, 14)
            .padding(.horizontal, 12)
            .frame(width: 140)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                    .fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                    .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }

    private var avatar: some View {
        let url: URL? = {
            guard let raw = player.photo_url, !raw.hasPrefix("data:") else { return nil }
            return URL(string: raw)
        }()
        return ZStack {
            if let url {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initialsGradient
                }
            } else {
                initialsGradient
            }
        }
        .frame(width: 60, height: 60)
        .clipShape(Circle())
        .overlay(
            Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1)
        )
    }

    /// Brand-lime gradient with player initials — used as the
    /// avatar placeholder while the real photo loads (or when the
    /// user hasn't set one).
    private var initialsGradient: some View {
        ZStack {
            Circle()
                .fill(LinearGradient(
                    colors: [DSColor.accent.opacity(0.7), DSColor.accent.opacity(0.4)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                ))
            Text(initials)
                .font(.system(size: 22, weight: .heavy, design: .default))
                .foregroundStyle(DSColor.textOnAccent)
        }
    }

    private var initials: String {
        let parts = player.display_name.split(separator: " ").prefix(2)
        return parts.map { $0.prefix(1).uppercased() }.joined()
    }
}
