import SwiftUI

// MARK: - Display helpers

/// Pure formatting for tournament UI. Kept in one place so the hero, the
/// cards, and the detail screen can't drift apart on how a date / fee /
/// status renders.
enum TournamentDisplay {
    static func dateLabel(_ iso: String) -> String {
        guard let date = Date.fromISO(iso) else { return "" }
        let f = DateFormatter()
        f.locale = .current
        f.setLocalizedDateFormatFromTemplate("d MMMM")
        return f.string(from: date)
    }

    /// Localized "in 3 days" style countdown, or nil once the date passed.
    static func countdown(toStart iso: String) -> String? {
        guard let date = Date.fromISO(iso), date > Date() else { return nil }
        let f = RelativeDateTimeFormatter()
        f.locale = .current
        f.unitsStyle = .full
        return f.localizedString(for: date, relativeTo: Date())
    }

    static func fee(minor: Int, currency: String) -> String {
        guard minor > 0 else { return String(localized: "tournaments.fee.free") }
        let amount = minor / 100
        let symbol = currency.uppercased() == "AZN" ? "₼" : currency
        return "\(amount) \(symbol)"
    }

    static func squads(entries: Int, max: Int) -> String {
        String(format: String(localized: "tournaments.squads_format"), entries, max)
    }

    static func statusLabel(_ status: String) -> LocalizedStringKey {
        switch status {
        case "registration_open":   return "tournaments.status.registration_open"
        case "registration_closed": return "tournaments.status.registration_closed"
        case "in_progress":         return "tournaments.status.in_progress"
        case "completed":           return "tournaments.status.completed"
        case "cancelled":           return "tournaments.status.cancelled"
        default:                    return "tournaments.status.announced"
        }
    }

    static func statusColor(_ status: String) -> Color {
        switch status {
        case "registration_open":   return DSColor.success
        case "registration_closed": return DSColor.warning
        case "in_progress":         return DSColor.accent
        case "completed":           return DSColor.textSecondary
        case "cancelled":           return DSColor.danger
        default:                    return DSColor.textTertiary
        }
    }

    static func fillFraction(entries: Int, max: Int) -> Double {
        guard max > 0 else { return 0 }
        return min(1, Double(entries) / Double(max))
    }
}

// MARK: - Featured hero

/// The headline tournament — an immersive royal-blue card with a live
/// filling bar, countdown, and a direct "Qoşul" affordance. This is the
/// hook that makes the tab a destination rather than a list.
struct FeaturedTournamentHero: View {
    let tournament: Tournament

    private var fraction: Double {
        TournamentDisplay.fillFraction(entries: tournament.entries_count, max: tournament.max_squads)
    }
    private var fillingFast: Bool {
        tournament.status == "registration_open" && fraction >= 0.6
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("tournaments.featured", systemImage: "star.fill")
                    .font(DSType.badge)
                    .foregroundStyle(DSColor.secondary)
                Spacer()
                if fillingFast {
                    Label("tournaments.filling_fast", systemImage: "flame.fill")
                        .font(DSType.badge)
                        .foregroundStyle(DSColor.secondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(DSColor.secondary.opacity(0.18)))
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(tournament.name)
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(DSColor.textOnAccent)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(subtitle)
                    .font(DSType.bodyMedium)
                    .foregroundStyle(DSColor.textOnAccent.opacity(0.78))
                    .lineLimit(1)
            }

            VStack(spacing: 6) {
                HStack {
                    Text(TournamentDisplay.squads(entries: tournament.entries_count, max: tournament.max_squads))
                        .font(DSType.caption2)
                        .foregroundStyle(DSColor.textOnAccent.opacity(0.78))
                    Spacer()
                    if let countdown = TournamentDisplay.countdown(toStart: tournament.starts_at) {
                        Label(countdown, systemImage: "clock")
                            .font(DSType.caption2)
                            .foregroundStyle(DSColor.textOnAccent.opacity(0.78))
                    }
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(DSColor.textOnAccent.opacity(0.18))
                        Capsule().fill(DSColor.secondary)
                            .frame(width: max(6, geo.size.width * fraction))
                    }
                }
                .frame(height: 6)
            }

            HStack {
                Text(TournamentDisplay.fee(minor: tournament.entry_fee_minor, currency: tournament.currency))
                    .font(DSType.bodyStrong)
                    .foregroundStyle(DSColor.textOnAccent)
                Spacer()
                Text("tournaments.action.join")
                    .font(DSType.button)
                    .foregroundStyle(DSColor.limeInk)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 9)
                    .background(Capsule().fill(DSColor.secondary))
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous).fill(DSColor.accent)
        )
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        let date = TournamentDisplay.dateLabel(tournament.starts_at)
        if let venue = tournament.venue_name, !venue.isEmpty {
            return "\(venue) · \(date)"
        }
        return date
    }
}

// MARK: - Format rail

/// Three competition formats as entry-points. Americano opens the existing
/// americano flow; Tournir is the current screen (no-op); Liqa is a clearly
/// marked "tezliklə" placeholder — never a fake destination.
struct CompetitionFormatRail: View {
    var onAmericano: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            pill(icon: "arrow.triangle.swap", title: "tournaments.format.americano",
                 fg: DSColor.limeInk, bg: DSColor.secondaryMuted, soon: false) {
                onAmericano()
            }
            pill(icon: "trophy.fill", title: "tournaments.format.tournament",
                 fg: DSColor.textOnAccent, bg: DSColor.accent, soon: false, action: nil)
            pill(icon: "chart.bar.fill", title: "tournaments.format.league",
                 fg: DSColor.textSecondary, bg: DSColor.surfaceElevated, soon: true, action: nil)
        }
    }

    @ViewBuilder
    private func pill(icon: String, title: LocalizedStringKey, fg: Color, bg: Color,
                      soon: Bool, action: (() -> Void)?) -> some View {
        let content = VStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 19, weight: .semibold))
            Text(title).font(DSType.metaCaption)
            if soon {
                Text("tournaments.coming_soon")
                    .font(.system(size: 9, weight: .semibold))
                    .opacity(0.7)
            }
        }
        .foregroundStyle(fg)
        .frame(maxWidth: .infinity)
        .padding(.vertical, soon ? 7 : 11)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(bg))

        if let action {
            Button(action: action) { content }.buttonStyle(SpringPressStyle())
        } else {
            content.opacity(soon ? 0.85 : 1)
        }
    }
}

// MARK: - Competition card

/// A single tournament as a premium card (not a dense row). Shows a filling
/// bar for open/live competitions; for finished ones it shows the final
/// squad count instead (real standings light up when the backend ships
/// them — we never fake a bracket).
struct CompetitionCard: View {
    let tournament: Tournament

    private var isFinished: Bool {
        tournament.status == "completed" || tournament.status == "cancelled"
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(DSColor.accentMuted)
                    Image(systemName: "trophy.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }
                .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 2) {
                    Text(tournament.name)
                        .font(DSType.cardTitle)
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(DSType.metaCaption)
                        .foregroundStyle(DSColor.textSecondary)
                        .lineLimit(1)
                }
                Spacer()
                statusPill
            }

            if isFinished {
                HStack {
                    Text(TournamentDisplay.squads(entries: tournament.entries_count, max: tournament.max_squads))
                        .font(DSType.caption2)
                        .foregroundStyle(DSColor.textSecondary)
                    Spacer()
                    Text(TournamentDisplay.fee(minor: tournament.entry_fee_minor, currency: tournament.currency))
                        .font(DSType.caption2)
                        .foregroundStyle(DSColor.textSecondary)
                }
            } else {
                VStack(spacing: 5) {
                    HStack {
                        Text(TournamentDisplay.squads(entries: tournament.entries_count, max: tournament.max_squads))
                            .font(DSType.caption2)
                            .foregroundStyle(DSColor.textSecondary)
                        Spacer()
                        Text(TournamentDisplay.fee(minor: tournament.entry_fee_minor, currency: tournament.currency))
                            .font(DSType.caption2)
                            .foregroundStyle(DSColor.textSecondary)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(DSColor.surfaceElevated)
                            Capsule().fill(DSColor.accent)
                                .frame(width: max(6, geo.size.width *
                                    TournamentDisplay.fillFraction(entries: tournament.entries_count,
                                                                   max: tournament.max_squads)))
                        }
                    }
                    .frame(height: 6)
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        let date = TournamentDisplay.dateLabel(tournament.starts_at)
        if let venue = tournament.venue_name, !venue.isEmpty {
            return "\(venue) · \(date)"
        }
        return date
    }

    private var statusPill: some View {
        let color = TournamentDisplay.statusColor(tournament.status)
        return Text(TournamentDisplay.statusLabel(tournament.status))
            .font(DSType.badge)
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Capsule().fill(color.opacity(0.14)))
    }
}

// MARK: - Section wrapper

struct CompetitionSection<Content: View>: View {
    let titleKey: LocalizedStringKey
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(titleKey)
                .font(DSType.sectionTitle)
                .foregroundStyle(DSColor.textPrimary)
            content
        }
    }
}
