import SwiftUI

/// Bottom sheet shown when the user taps a day cell on the calendar grid.
/// Lists every item for that day with tap-to-open callbacks per kind.
struct DayDetailSheet: View {
    let day: Date
    let items: [AgendaItem]
    /// Locale to format the date header. Pulled from the surrounding view
    /// (which reads it from the `LanguageManager`) so the sheet honours the
    /// in-app language even when the device locale is different.
    let locale: Locale
    let onTapGame: (AgendaItem) -> Void
    let onTapBooking: (AgendaItem) -> Void
    let onTapTournament: (AgendaItem) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                content
            }
            .navigationTitle(headerText)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(DSColor.textSecondary)
                    }
                    .accessibilityLabel(Text("calendar.day_sheet.close"))
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(DSColor.background)
    }

    @ViewBuilder
    private var content: some View {
        if items.isEmpty {
            EmptyStateView(
                icon: "calendar",
                title: String(localized: "calendar.day_sheet.empty.title"),
                message: String(localized: "calendar.day_sheet.empty.message")
            )
        } else {
            ScrollView {
                VStack(spacing: DSSpacing.sm) {
                    ForEach(items) { item in
                        Button {
                            switch item.kind {
                            case .game:       onTapGame(item)
                            case .booking:    onTapBooking(item)
                            case .tournament: onTapTournament(item)
                            }
                        } label: {
                            AgendaRow(item: item, locale: locale)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.vertical, DSSpacing.md)
            }
        }
    }

    private var headerText: String {
        let df = DateFormatter()
        df.locale = locale
        df.setLocalizedDateFormatFromTemplate("EEEEdMMMM")
        return df.string(from: day)
    }
}

/// Compact row used inside the day sheet — icon, title, venue, start time.
private struct AgendaRow: View {
    let item: AgendaItem
    let locale: Locale

    var body: some View {
        HStack(spacing: DSSpacing.md) {
            ZStack {
                Circle()
                    .fill(DSColor.accentMuted)
                    .frame(width: 44, height: 44)
                Image(systemName: iconName)
                    .foregroundStyle(DSColor.accent)
                    .font(.system(size: 18, weight: .semibold))
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: DSSpacing.xs) {
                    // FAZA 45 §13.1: badge is sentence case, no uppercase.
                    Text(kindLabel)
                        .font(.system(.caption2, design: .rounded, weight: .heavy))
                        .foregroundStyle(DSColor.accent)
                        .padding(.horizontal, DSSpacing.xs)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(DSColor.accentMuted))
                    Text(timeLabel)
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(DSColor.textSecondary)
                }
                Text(item.title)
                    .font(.system(.subheadline, design: .rounded, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                if let venue = item.venue_name, !venue.isEmpty {
                    Text(venue)
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(DSColor.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .foregroundStyle(DSColor.textTertiary)
                .font(.system(size: 13, weight: .semibold))
        }
        .padding(DSSpacing.sm)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surface))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
    }

    private var iconName: String {
        switch item.kind {
        case .game:       return "sportscourt.fill"
        case .booking:    return "calendar.badge.checkmark"
        case .tournament: return "trophy.fill"
        }
    }

    private var kindLabel: LocalizedStringKey {
        switch item.kind {
        case .game:       return "calendar.kind.game"
        case .booking:    return "calendar.kind.booking"
        case .tournament: return "calendar.kind.tournament"
        }
    }

    private var timeLabel: String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = f.date(from: item.starts_at) ?? {
            let g = ISO8601DateFormatter()
            g.formatOptions = [.withInternetDateTime]
            return g.date(from: item.starts_at)
        }() ?? Date()
        let df = DateFormatter()
        df.locale = locale
        df.timeStyle = .short
        df.dateStyle = .none
        return df.string(from: date)
    }
}
