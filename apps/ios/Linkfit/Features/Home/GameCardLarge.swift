import SwiftUI

/// Horizontal "photo" card for the games carousel on Home. Since we don't
/// have venue photography, each card uses a sport-themed gradient with a
/// stylized court motif, then overlays a price/badge top-left and an info
/// card at the bottom — same composition as the booking-app reference.
struct GameCardLarge: View {
    let game: GameSummary

    /// Shared formatters — `timeRelative` is read twice per body (once for
    /// the visible label, once for the accessibility string) and the
    /// carousel can render many of these at a time.
    private static let isoFormatter = ISO8601DateFormatter()
    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.doesRelativeDateFormatting = true
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()

    var body: some View {
        ZStack(alignment: .topLeading) {
            artwork
            VStack(alignment: .leading, spacing: 0) {
                topBadge
                Spacer()
                infoOverlay
            }
            .padding(DSSpacing.md)
        }
        .frame(width: 260, height: 320)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 14, x: 0, y: 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(String(format: String(localized: "card.game_accessibility_format"),
                                   sportLabel, game.host_display_name, timeRelative))
    }

    // MARK: - Layers

    private var artwork: some View {
        ZStack {
            LinearGradient(
                colors: sportColors,
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            CourtDecor()
                .stroke(Color.white.opacity(0.22), lineWidth: 1)
            // Big background icon
            Image(systemName: sportSystemImage)
                .font(.system(size: 130, weight: .bold))
                .foregroundStyle(.white.opacity(0.14))
                .rotationEffect(.degrees(-10))
                .offset(x: 40, y: 60)
            // Vignette
            LinearGradient(
                colors: [.clear, .black.opacity(0.45)],
                startPoint: .top, endPoint: .bottom
            )
        }
    }

    private var topBadge: some View {
        HStack {
            HStack(spacing: 6) {
                Circle().fill(DSColor.lime).frame(width: 8, height: 8)
                Text(statusLabel)
                    .font(.system(.caption2, design: .rounded, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, DSSpacing.sm)
            .padding(.vertical, 6)
            .background(Capsule().fill(Color.black.opacity(0.55)))

            Spacer()

            Text(sportLabel)
                .font(.system(.caption2, design: .rounded, weight: .bold))
                .foregroundStyle(.black)
                .padding(.horizontal, DSSpacing.sm)
                .padding(.vertical, 6)
                .background(Capsule().fill(DSColor.lime))
        }
    }

    private var infoOverlay: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(game.venue_name ?? String(localized: "card.open_invite"))
                .font(.system(.callout, design: .rounded, weight: .bold))
                .foregroundStyle(.white)
                .lineLimit(1)

            HStack(spacing: DSSpacing.sm) {
                Label(timeRelative, systemImage: "calendar")
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(.white.opacity(0.88))
                Spacer()
                Label("\(game.participants_count)/\(game.capacity)", systemImage: "person.2.fill")
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(.white.opacity(0.88))
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.black.opacity(0.45))
        )
    }

    // MARK: - Computed

    private var sportColors: [Color] {
        switch game.sport_slug {
        case "padel":
            return [Color(red: 0.05, green: 0.36, blue: 0.22),
                    Color(red: 0.09, green: 0.55, blue: 0.32)]
        case "football_5":
            return [Color(red: 0.08, green: 0.28, blue: 0.48),
                    Color(red: 0.16, green: 0.45, blue: 0.65)]
        default:
            return [Color(red: 0.18, green: 0.20, blue: 0.28),
                    Color(red: 0.32, green: 0.30, blue: 0.42)]
        }
    }

    private var sportSystemImage: String {
        game.sport_slug == "padel" ? "figure.tennis" : "sportscourt"
    }
    private var sportLabel: String {
        switch game.sport_slug {
        case "padel": return String(localized: "sport.padel")
        case "football_5": return String(localized: "sport.football_5")
        default: return game.sport_slug
        }
    }
    private var statusLabel: String {
        switch game.status {
        case .open: return String(localized: "game.status.open")
        case .full: return String(localized: "game.status.full")
        case .cancelled: return String(localized: "game.status.cancelled")
        case .completed: return String(localized: "game.status.played")
        }
    }
    private var timeRelative: String {
        guard let date = Self.isoFormatter.date(from: game.starts_at) else {
            return game.starts_at
        }
        return Self.dateFormatter.string(from: date)
    }
}

private struct CourtDecor: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let inset: CGFloat = 24
        let court = rect.insetBy(dx: inset, dy: inset)
        p.addRect(court)
        p.move(to: CGPoint(x: court.minX, y: court.midY))
        p.addLine(to: CGPoint(x: court.maxX, y: court.midY))
        p.move(to: CGPoint(x: court.midX, y: court.minY + court.height * 0.3))
        p.addLine(to: CGPoint(x: court.midX, y: court.minY + court.height * 0.7))
        return p
    }
}
