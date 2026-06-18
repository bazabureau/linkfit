import SwiftUI

/// Row factory for the four result-row variants. Keeping all four in one file
/// makes it cheap to keep the visual treatment consistent (same avatar/icon
/// circle, same metadata layout, same surface tokens) — the differences are
/// limited to the icon, primary line and the secondary metadata.
enum SearchResultRow {
    // MARK: - Player

    struct Player: View {
        let result: SearchPlayerResult
        let onTap: () -> Void

        var body: some View {
            SearchRowShell(
                icon: "person.fill",
                primary: result.display_name,
                secondary: metaLine,
                onTap: onTap,
                accessibilityLabel: result.display_name
            )
        }

        private var metaLine: String? {
            var parts: [String] = []
            if let sport = result.primary_sport { parts.append(sportLabel(sport)) }
            // Word-based skill bucket instead of raw "ELO 1450" — keeps
            // search results in the same jargon-free vocabulary used on
            // every other player surface.
            if result.primary_elo != nil {
                parts.append(SkillLevel.from(elo: result.primary_elo).localizedName)
            }
            return parts.isEmpty ? nil : parts.joined(separator: " · ")
        }
    }

    // MARK: - Game

    struct Game: View {
        let result: SearchGameResult
        let onTap: () -> Void

        var body: some View {
            SearchRowShell(
                icon: "sportscourt.fill",
                primary: title,
                secondary: metaLine,
                onTap: onTap,
                accessibilityLabel: title
            )
        }

        /// Prefer the host display name as the primary line — it's how
        /// players actually remember games ("Salam's match"). When notes
        /// exist they appear in the metadata row.
        private var title: String {
            "\(result.host_display_name) · \(sportLabel(result.sport_slug))"
        }

        private var metaLine: String? {
            var parts: [String] = []
            parts.append(SearchDateFormat.relative(result.starts_at))
            if let venue = result.venue_name { parts.append(venue) }
            if let notes = result.notes, !notes.isEmpty {
                parts.append(notes.prefix(60).description)
            }
            return parts.joined(separator: " · ")
        }
    }

    // MARK: - Tournament

    struct Tournament: View {
        let result: SearchTournamentResult
        let onTap: () -> Void

        var body: some View {
            SearchRowShell(
                icon: "trophy.fill",
                primary: result.name,
                secondary: metaLine,
                onTap: onTap,
                accessibilityLabel: result.name
            )
        }

        private var metaLine: String {
            var parts: [String] = [
                sportLabel(result.sport_slug),
                SearchDateFormat.mediumDate(result.starts_at),
            ]
            if let venue = result.venue_name { parts.append(venue) }
            return parts.joined(separator: " · ")
        }
    }

    // MARK: - Venue

    struct Venue: View {
        let result: SearchVenueResult
        let onTap: () -> Void

        var body: some View {
            SearchRowShell(
                icon: "building.2.fill",
                primary: result.name,
                secondary: result.address,
                trailingBadgeKey: result.is_partner ? "search.partner_badge" : nil,
                onTap: onTap,
                accessibilityLabel: result.name
            )
        }
    }
}

// MARK: - Shared shell

/// Visual chrome for every result row — keeps spacing, surface, border and
/// the chevron affordance identical across all four entity types so the list
/// reads as one coherent table.
private struct SearchRowShell: View {
    let icon: String
    let primary: String
    let secondary: String?
    var trailingBadgeKey: LocalizedStringKey? = nil
    let onTap: () -> Void
    let accessibilityLabel: String

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: DSSpacing.sm) {
                iconBubble
                VStack(alignment: .leading, spacing: 4) {
                    Text(primary)
                        .font(.system(.subheadline, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    if let secondary, !secondary.isEmpty {
                        Text(secondary)
                            .font(.system(.caption, design: .default))
                            .foregroundStyle(DSColor.textSecondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: DSSpacing.xs)
                if let trailingBadgeKey {
                    Text(trailingBadgeKey)
                        .font(.system(size: 10, weight: .bold, design: .default))
                        .foregroundStyle(DSColor.textOnAccent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(
                            Capsule().fill(DSColor.accent)
                        )
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSColor.textTertiary)
            }
            .padding(DSSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [DSColor.textPrimary.opacity(0.12), DSColor.textPrimary.opacity(0.03)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            )
            .shadow(color: DSColor.inkSurface.opacity(0.06), radius: 4, x: 0, y: 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(SpringPressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilityLabel))
    }

    private var iconBubble: some View {
        ZStack {
            Circle()
                .fill(DSColor.accentMuted)
                .frame(width: 44, height: 44)
            Image(systemName: icon)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(DSColor.accent)
        }
        .overlay(
            Circle()
                .strokeBorder(DSColor.accent.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - Helpers

/// Sport-slug → human label. Mirrors the convention used elsewhere
/// (PlayerRow, GameRow). Keeping this private to the Search feature means
/// new sports won't accidentally fall back to slug text in two places.
fileprivate func sportLabel(_ slug: String) -> String {
    switch slug {
    case "padel":      return String(localized: "sport.padel")
    case "football_5": return String(localized: "sport.football_short")
    default:           return slug.capitalized
    }
}

/// Centralised date formatting helpers — keeps the row file's body terse and
/// guarantees every row in the Search screen renders timestamps identically.
enum SearchDateFormat {
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

    /// "Today 18:30", "Tomorrow 09:00", or a relative-ish "Sat 21 May".
    static func relative(_ iso: String) -> String {
        guard let d = date(from: iso) else { return iso }
        let cal = Calendar.current
        let now = Date()
        let timeFmt = DateFormatter()
        timeFmt.dateStyle = .none
        timeFmt.timeStyle = .short
        if cal.isDateInToday(d) {
            return "\(String(localized: "search.date.today")) \(timeFmt.string(from: d))"
        }
        if cal.isDateInTomorrow(d) {
            return "\(String(localized: "search.date.tomorrow")) \(timeFmt.string(from: d))"
        }
        let interval = d.timeIntervalSince(now)
        if interval > 0, interval < 7 * 24 * 3600 {
            let wf = DateFormatter()
            wf.dateFormat = "EEE d MMM"
            return wf.string(from: d)
        }
        return mediumDate(iso)
    }
}
