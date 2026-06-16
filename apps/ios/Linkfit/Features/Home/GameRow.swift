import SwiftUI

struct GameRow: View {
    let game: GameSummary

    /// Shared formatter — keep `body` allocation-free. The relative
    /// date formatting flag and dateStyle/timeStyle stay constant per app
    /// lifetime; the locale is refreshed per render so a user who switches
    /// the in-app language sees dates in that language immediately.
    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.doesRelativeDateFormatting = true
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()

    var body: some View {
        Card(padding: DSSpacing.md) {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                HStack(spacing: DSSpacing.xs) {
                    sportIcon
                    Text(sportDisplay)
                        .font(DSType.bodyEmphasis)
                        .foregroundStyle(DSColor.textPrimary)
                    Spacer()
                    statusPill
                }
                HStack(spacing: DSSpacing.xs) {
                    Image(systemName: "calendar")
                        .foregroundStyle(DSColor.textSecondary)
                    Text(timeLine)
                        .font(DSType.footnote)
                        .foregroundStyle(DSColor.textSecondary)
                }
                if let venue = game.venue_name {
                    HStack(spacing: DSSpacing.xs) {
                        Image(systemName: "mappin.and.ellipse")
                            .foregroundStyle(DSColor.textSecondary)
                        Text(venue)
                            .font(DSType.footnote)
                            .foregroundStyle(DSColor.textSecondary)
                            .lineLimit(1)
                        if let km = game.distance_km {
                            Text("· \(DistanceFormatter.km(km))")
                                .font(DSType.footnote)
                                .foregroundStyle(DSColor.textSecondary)
                        }
                    }
                }
                HStack {
                    Label("\(game.participants_count) / \(game.capacity)", systemImage: "person.2")
                        .font(DSType.footnote)
                        .foregroundStyle(DSColor.textSecondary)
                    Spacer()
                    if let min = game.skill_min_elo, let max = game.skill_max_elo {
                        Text(String(format: String(localized: "card.elo_range_format"), min, max))
                            .font(DSType.caption)
                            .padding(.horizontal, DSSpacing.xs)
                            .padding(.vertical, 4)
                            .background(
                                Capsule().fill(DSColor.accentMuted)
                            )
                            .foregroundStyle(DSColor.accent)
                    }
                }
            }
        }
    }

    private var sportIcon: some View {
        Image(systemName: game.sport_slug == "padel" ? "figure.tennis" : "sportscourt")
            .foregroundStyle(DSColor.accent)
    }

    private var sportDisplay: String {
        switch game.sport_slug {
        case "padel": return String(localized: "sport.padel")
        case "football_5": return String(localized: "sport.football_5_long")
        default: return game.sport_slug.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private var timeLine: String {
        guard let date = Date.fromISO(game.starts_at) else {
            return game.starts_at
        }
        Self.dateFormatter.locale = HomeCardLocale.current
        return Self.dateFormatter.string(from: date)
    }

    private var statusPill: some View {
        let (label, color, bg): (String, Color, Color) = {
            switch game.status {
            case .open:      return (String(localized: "game.status.open"),      DSColor.success, DSColor.accentMuted)
            case .full:      return (String(localized: "game.status.full"),      DSColor.warning, DSColor.warning.opacity(0.15))
            case .cancelled: return (String(localized: "game.status.cancelled"), DSColor.danger,  DSColor.danger.opacity(0.12))
            case .completed: return (String(localized: "game.status.played"),    DSColor.textSecondary, DSColor.border)
            }
        }()
        return Text(label)
            .font(DSType.caption)
            .foregroundStyle(color)
            .padding(.horizontal, DSSpacing.xs)
            .padding(.vertical, DSSpacing.xxs)
            .background(Capsule().fill(bg))
    }
}

/// In-app language locale for the Home card date formatters. Mirrors the
/// canonical mapping in `Money` / `LocaleManager` (same `UserDefaults`
/// key) so a user who picks Azerbaijani sees Azerbaijani-formatted dates
/// even on an English-region device. Kept here (rather than in a shared
/// Core file) because this audit pass is scoped to the Home card views.
enum HomeCardLocale {
    static var current: Locale {
        switch UserDefaults.standard.string(forKey: "LinkfitPreferredLanguage") {
        case "en": return Locale(identifier: "en_US")
        case "ru": return Locale(identifier: "ru_RU")
        default:   return Locale(identifier: "az_AZ")
        }
    }
}
