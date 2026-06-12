import SwiftUI

/// Wide match card with match details layered over the venue photo as the full background.
///
/// The entire card acts as a single visually cohesive glass/photo block, where the
/// venue's photo (or a sleek royal blue brand gradient fallback) spans the full
/// background. Text is layered directly over the background with a high-contrast
/// linear gradient overlay, and a premium 4pt stripe on the leading edge indicates
/// viewer-owned games.
struct UpcomingMatchCard: View {
    let game: GameSummary
    var format: String = String(localized: "card.format.default")
    let isJoined: Bool
    let onTapCard: () -> Void
    let onJoin: () -> Void

    @Environment(AppContainer.self) private var container

    /// Shared formatters — `formattedStart` runs every body pass, and the
    /// carousel renders many cards. Allocating fresh ISO/Date formatters
    /// per row per redraw was measurable in the audit, so reuse one
    /// configured instance per type for the lifetime of the app.
    private static let isoFormatter = ISO8601DateFormatter()
    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.doesRelativeDateFormatting = true
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()

    private var isHost: Bool {
        guard let me = container.currentUser?.id else { return false }
        return game.host_user_id == me
    }

    var body: some View {
        ZStack {
            // 1. Full-bleed background venue photo or royal blue fallback court artwork
            artwork
            
            // 2. Double-gradient legibility layer for absolute contrast in Light & Dark modes
            LinearGradient(
                colors: [
                    Color.black.opacity(0.85),
                    Color.black.opacity(0.35),
                    Color.black.opacity(0.15)
                ],
                startPoint: .bottom,
                endPoint: .top
            )
            
            // 3. Left-edge premium gradient stripe for the viewer's own games
            if isHost {
                HStack {
                    Rectangle()
                        .fill(DSColor.secondary)
                        .frame(width: 4)
                    Spacer()
                }
            }
            
            // 4. Clean text overlay (white and light-gray opacity for premium contrast)
            info
        }
        .frame(width: 320, height: 230)
        .background(DSColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            onTapCard()
        }
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Top row: Sport badge on the left, "Sənin oyunun" badge on the right
            HStack {
                Text(format)
                    .font(.system(.caption2, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.textOnAccent) // Pure white
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(DSColor.accent)) // Dynamic Royal Blue badge
                
                Spacer()
                
                if isHost {
                    Text("match.host_badge.you")
                        .font(.system(size: 9, weight: .bold, design: .default))
                        .foregroundStyle(DSColor.limeInk) // Ink on lime fill
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(DSColor.secondary)) // Lime-Yellow background
                        .accessibilityLabel(Text("match.host_badge.you"))
                }
            }
            
            Spacer()
            
            // Bold Main Title (Venue Name)
            Text(game.venue_name ?? String(localized: "card.open_invite"))
                .font(.system(.body, design: .default, weight: .heavy))
                .foregroundStyle(.white)
                .lineLimit(1)
            
            // High-contrast translucent metadata list
            VStack(alignment: .leading, spacing: 4) {
                metaRow(icon: "calendar", text: formattedStart)
                metaRow(icon: "person.2.fill",
                        text: String(format: String(localized: "card.players_count_format"),
                                     game.participants_count, game.capacity))
                metaRow(icon: "crown.fill", text: game.host_display_name)
                if let min = game.skill_min_elo, let max = game.skill_max_elo {
                    metaRow(icon: "chart.bar.fill",
                            text: String(format: String(localized: "card.level_format"), min, max))
                }
            }
            .padding(.top, 4)
            
            // Join CTA / Status
            HStack {
                Spacer()
                if !isHost {
                    if isJoined {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 11, weight: .bold))
                            Text(String(localized: "home.match.joined", defaultValue: "Qoşulmusan"))
                                .font(.system(.footnote, design: .default, weight: .bold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(Color.white.opacity(0.2)))
                    } else if game.participants_count >= game.capacity || game.status == .full {
                        Text(String(localized: "home.match.full", defaultValue: "Dolu"))
                            .font(.system(.footnote, design: .default, weight: .bold))
                            .foregroundStyle(.white.opacity(0.6))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(Capsule().fill(Color.white.opacity(0.1)))
                    } else {
                        Button(action: onJoin) {
                            Text("home.match.join")
                                .font(.system(.footnote, design: .default, weight: .bold))
                                .foregroundStyle(DSColor.textOnAccent)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .background(Capsule().fill(DSColor.accent))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.top, 4)
        }
        .padding(DSSpacing.md)
    }

    private func metaRow(icon: String, text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.white.opacity(0.8))
            Text(text)
                .font(.system(.caption, design: .default))
                .foregroundStyle(.white.opacity(0.8))
                .lineLimit(1)
        }
    }

    private var artwork: some View {
        ZStack {
            if let photoStr = game.venue_photo_url, !photoStr.isEmpty, let url = URL(string: photoStr) {
                CachedAsyncImage(url: url) { image in
                    image
                        .resizable()
                        .scaledToFill()
                } placeholder: {
                    ZStack {
                        DSColor.surfaceElevated
                        ProgressView()
                    }
                }
            } else {
                // High-end brand gradient fallback for games with no venue photo
                ZStack {
                    LinearGradient(
                        colors: [DSColor.accent, DSColor.info],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    
                    CourtArtwork()
                        .stroke(Color.white.opacity(0.20), lineWidth: 1.2)
                        .padding(24)
                    
                    Image(systemName: "figure.tennis")
                        .font(.system(size: 36, weight: .regular))
                        .foregroundStyle(Color.white.opacity(0.15))
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private var formattedStart: String {
        guard let date = Date.fromISO(game.starts_at) else {
            return game.starts_at
        }
        return Self.dateFormatter.string(from: date)
    }
}

private struct CourtArtwork: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        // Outer court
        p.addRect(rect)
        // Net horizontal
        p.move(to: CGPoint(x: rect.minX, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        // Service line top + bottom
        let topQ = rect.minY + rect.height * 0.25
        let botQ = rect.minY + rect.height * 0.75
        p.move(to: CGPoint(x: rect.minX, y: topQ))
        p.addLine(to: CGPoint(x: rect.maxX, y: topQ))
        p.move(to: CGPoint(x: rect.minX, y: botQ))
        p.addLine(to: CGPoint(x: rect.maxX, y: botQ))
        // Center line
        p.move(to: CGPoint(x: rect.midX, y: topQ))
        p.addLine(to: CGPoint(x: rect.midX, y: botQ))
        return p
    }
}
