import SwiftUI

/// Wide featured tournament card (trophy icon left, info center, registered
/// count + chevron right). Matches the reference's LinkFit Summer Cup row.
struct TournamentFeaturedCard: View {
    let tournament: Tournament
    let onTap: () -> Void

    /// Shared formatters — `dateRange` allocated two ISO8601 formatters
    /// plus one DateFormatter per body pass before. The "MMM d" format
    /// pattern stays constant for the lifetime of the app.
    private static let isoFormatter = ISO8601DateFormatter()
    private static let monthDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMM d"
        return f
    }()

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
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var trophyTile: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
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
            .font(.system(size: 9, weight: .bold, design: .default))
            .foregroundStyle(DSColor.accent)
            .padding(.horizontal, 6)
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
        let s = Self.isoFormatter.date(from: tournament.starts_at).map(Self.monthDayFormatter.string(from:)) ?? ""
        let e = Self.isoFormatter.date(from: tournament.ends_at).map(Self.monthDayFormatter.string(from:)) ?? ""
        return s == e ? s : "\(s) – \(e)"
    }
}
