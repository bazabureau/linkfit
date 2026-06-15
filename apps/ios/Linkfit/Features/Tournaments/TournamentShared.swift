import SwiftUI

// MARK: - Helpers, shared chips
//
// Shared between the Tournaments list (rebuilt) and TournamentDetailView.
// Relocated here from the old TournamentsView when the list was rebuilt so
// the detail screen keeps compiling unchanged.

/// Sport-icon mapping used across the list and detail screens.
enum TournamentSportIcon {
    static func forSlug(_ slug: String) -> String {
        switch slug {
        case "padel":      return "tennisball.fill"
        case "tennis":     return "tennis.racket"
        case "football_5", "football": return "sportscourt"
        case "basketball": return "basketball.fill"
        default:           return "trophy.fill"
        }
    }
}

struct TournamentStatusChip: View {
    let status: String

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 5, height: 5)
                .shadow(color: color, radius: 2)
            Text(label)
                .font(.system(size: 9, weight: .heavy, design: .default))
                .foregroundStyle(color)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(color.opacity(0.08)))
        .overlay(
            Capsule().strokeBorder(color.opacity(0.18), lineWidth: 0.7)
        )
    }

    private var label: String {
        switch status {
        case "registration_open":   return String(localized: "tournaments.status.registration_open")
        case "registration_closed": return String(localized: "tournaments.status.registration_closed")
        case "in_progress":         return String(localized: "tournaments.status.in_progress")
        case "completed":           return String(localized: "tournaments.status.completed")
        case "cancelled":           return String(localized: "tournaments.status.cancelled")
        default:                    return String(localized: "tournaments.status.announced")
        }
    }

    private var color: Color {
        switch status {
        case "registration_open":   return DSColor.success
        case "registration_closed": return DSColor.warning
        case "in_progress":         return DSColor.info
        case "completed":           return DSColor.textSecondary
        case "cancelled":           return DSColor.danger
        default:                    return DSColor.textSecondary
        }
    }
}

struct SportPill: View {
    let slug: String

    var body: some View {
        Text(label)
            .font(.system(size: 9, weight: .heavy, design: .default))
            .foregroundStyle(DSColor.accent)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(DSColor.accent.opacity(0.08)))
            .overlay(
                Capsule().strokeBorder(DSColor.accent.opacity(0.2), lineWidth: 0.7)
            )
    }

    private var label: String {
        switch slug {
        case "padel":      return String(localized: "sport.padel")
        case "football_5": return String(localized: "sport.football_5")
        case "tennis":     return String(localized: "sport.tennis")
        case "basketball": return String(localized: "sport.basketball")
        default:           return slug.replacingOccurrences(of: "_", with: " ")
        }
    }
}

struct TournamentMoneyPill: View {
    enum Kind { case fee, prize, free }
    let amountMinor: Int
    let currency: String
    let kind: Kind

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: iconName)
                .font(.system(size: 8, weight: .bold))
            Text(text)
                .font(.system(size: 9, weight: .heavy, design: .default))
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(background))
        .overlay(
            Capsule().strokeBorder(foreground.opacity(0.18), lineWidth: 0.7)
        )
    }

    private var iconName: String {
        switch kind {
        case .fee:   return "creditcard.fill"
        case .prize: return "rosette"
        case .free:  return "gift.fill"
        }
    }

    private var foreground: Color {
        switch kind {
        case .fee:   return DSColor.warning
        case .prize: return DSColor.accent
        case .free:  return DSColor.success
        }
    }

    private var background: Color {
        switch kind {
        case .fee:   return DSColor.warning.opacity(0.08)
        case .prize: return DSColor.accent.opacity(0.08)
        case .free:  return DSColor.success.opacity(0.08)
        }
    }

    private var text: String {
        switch kind {
        case .free: return String(localized: "tournaments.fee.free")
        case .fee, .prize:
            return TournamentFormatting.formatMinor(amountMinor, currency: currency)
        }
    }
}

// MARK: - Formatting

enum TournamentFormatting {
    /// Format a minor-units integer (e.g. 5000 = 50.00 AZN). Drops cents if
    /// the value is a clean whole number — typical for entry fees.
    static func formatMinor(_ minor: Int, currency: String) -> String {
        let whole = Double(minor) / 100.0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = minor % 100 == 0 ? 0 : 2
        formatter.minimumFractionDigits = minor % 100 == 0 ? 0 : 2
        let amount = formatter.string(from: NSNumber(value: whole)) ?? "\(whole)"
        return "\(amount) \(currency)"
    }

    static func date(from iso: String) -> Date? {
        let primary = ISO8601DateFormatter()
        primary.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = primary.date(from: iso) { return d }
        let fallback = ISO8601DateFormatter()
        return fallback.date(from: iso)
    }

    static func mediumDate(_ iso: String) -> String {
        guard let d = date(from: iso) else { return iso }
        let f = DateFormatter()
        f.dateStyle = .medium
        return f.string(from: d)
    }

    static func dateAndTime(_ iso: String) -> String {
        guard let d = date(from: iso) else { return iso }
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: d)
    }
}

func formattedDateRange(tournament: Tournament) -> String {
    let start = TournamentFormatting.mediumDate(tournament.starts_at)
    let end = TournamentFormatting.mediumDate(tournament.ends_at)
    if start == end { return start }
    return "\(start) – \(end)"
}
