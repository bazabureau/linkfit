import SwiftUI

/// Wide featured tournament card (trophy icon left, info center, registered
/// count + chevron right). Matches the reference's LinkFit Summer Cup row.
struct TournamentFeaturedCard: View {
    let tournament: Tournament
    let onTap: () -> Void

    /// Shared formatter — `dateRange` allocated two ISO8601 formatters
    /// plus one DateFormatter per body pass before. The locale is refreshed
    /// per render and a localized "month day" template is resolved against
    /// it, so an in-app language switch is reflected immediately (and month
    /// names follow the chosen language, not the device region).
    private static let monthDayFormatter = DateFormatter()

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: DSSpacing.md) {
                trophyTile
                infoBlock
                Spacer(minLength: 0)
                registeredCount
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSColor.textTertiary)
            }
            .padding(DSSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous)
                    .fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
        }
        .buttonStyle(SpringPressStyle())
    }

    private var trophyTile: some View {
        ZStack {
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(DSColor.accentMuted)
                .frame(width: 64, height: 64)
            Image(systemName: "trophy.fill")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(DSColor.accent)
        }
    }

    private var infoBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(tournament.name)
                    .font(.system(.subheadline, design: .default, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                statusBadge
            }
            HStack(spacing: 4) {
                Image(systemName: "calendar")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DSColor.textSecondary)
                Text(dateRange)
                    .font(.system(.caption, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .lineLimit(1)
            }
            if let v = tournament.venue_name {
                HStack(spacing: 4) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(DSColor.textSecondary)
                    Text(v)
                        .font(.system(.caption, design: .default))
                        .foregroundStyle(DSColor.textSecondary)
                        .lineLimit(1)
                }
            }
        }
    }

    private var statusBadge: some View {
        Text(statusLabel)
            .font(DSType.badge)
            .foregroundStyle(DSColor.accent)
            .padding(.horizontal, DSSpacing.xxs)
            .padding(.vertical, 2)
            .background(Capsule().strokeBorder(DSColor.accent, lineWidth: 1))
    }

    private var registeredCount: some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text("\(tournament.entries_count) / \(tournament.max_squads)")
                .font(.system(.subheadline, design: .default, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
            Text("home.tournament.registered")
                .font(.system(.caption2, design: .default))
                .foregroundStyle(DSColor.textSecondary)
        }
    }

    private var statusLabel: String {
        switch tournament.status {
        case "registration_open":   return String(localized: "tournament.status.open")
        case "registration_closed": return String(localized: "tournament.status.closed")
        case "in_progress":         return String(localized: "tournament.status.live")
        case "completed":           return String(localized: "tournament.status.done")
        case "cancelled":           return String(localized: "tournament.status.cancelled")
        default:                    return String(localized: "tournament.status.upcoming")
        }
    }

    private var dateRange: String {
        let locale = HomeCardLocale.current
        Self.monthDayFormatter.locale = locale
        // Resolve a locale-correct "month day" template instead of a fixed
        // "MMM d" pattern so each language orders/abbreviates the parts itself.
        Self.monthDayFormatter.setLocalizedDateFormatFromTemplate("MMMd")
        let s = Date.fromISO(tournament.starts_at).map(Self.monthDayFormatter.string(from:)) ?? ""
        let e = Date.fromISO(tournament.ends_at).map(Self.monthDayFormatter.string(from:)) ?? ""
        return s == e ? s : "\(s) – \(e)"
    }
}
