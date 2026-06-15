import SwiftUI

// MARK: - Display helpers

enum GameDisplay {
    static func timeLabel(_ iso: String) -> String {
        guard let date = Date.fromISO(iso) else { return "" }
        let cal = Calendar.current
        let tf = DateFormatter()
        tf.locale = .current
        tf.timeStyle = .short
        tf.dateStyle = .none
        let time = tf.string(from: date)
        if cal.isDateInToday(date) {
            return String(format: String(localized: "matches.time.today_at_format"), time)
        }
        if cal.isDateInTomorrow(date) {
            return String(format: String(localized: "matches.time.tomorrow_at_format"), time)
        }
        let df = DateFormatter()
        df.locale = .current
        df.setLocalizedDateFormatFromTemplate("d MMM HH:mm")
        return df.string(from: date)
    }

    static func levelLabel(min: Int?, max: Int?) -> String {
        guard let lo = min, let hi = max else { return String(localized: "matches.skill.any") }
        let mid = (lo + hi) / 2
        let band: String
        if mid < 1200 { band = String(localized: "matches.skill.easy") }
        else if mid < 1500 { band = String(localized: "matches.skill.mid") }
        else { band = String(localized: "matches.skill.hard") }
        return "\(band) · \(lo)–\(hi)"
    }

    static func spots(_ game: GameSummary) -> String {
        String(format: String(localized: "games.spots_format"), game.participants_count, game.capacity)
    }

    static func spotsLeft(_ game: GameSummary) -> Int {
        max(0, game.capacity - game.participants_count)
    }

    static func fillFraction(_ game: GameSummary) -> Double {
        guard game.capacity > 0 else { return 0 }
        return min(1, Double(game.participants_count) / Double(game.capacity))
    }

    static func distanceLabel(_ km: Double?) -> String? {
        guard let km else { return nil }
        return String(format: "%.1f km", km)
    }
}

// MARK: - Avatar stack

/// Overlapping avatar row: host first (accent, initial), the other filled
/// seats next, then empty seats. Bounded to four visible circles.
private struct GameAvatarStack: View {
    let game: GameSummary

    var body: some View {
        let visible = min(game.capacity, 4)
        let filled = min(game.participants_count, visible)
        HStack(spacing: -9) {
            ForEach(0..<visible, id: \.self) { index in
                circle(index: index, filled: index < filled)
            }
        }
    }

    @ViewBuilder
    private func circle(index: Int, filled: Bool) -> some View {
        ZStack {
            Circle().fill(filled ? (index == 0 ? DSColor.accent : DSColor.accentMuted)
                                 : DSColor.surfaceElevated)
            if index == 0 {
                Text(game.host_display_name.prefix(1).uppercased())
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSColor.textOnAccent)
            } else if !filled {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DSColor.textTertiary)
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
        }
        .frame(width: 30, height: 30)
        .overlay(Circle().strokeBorder(DSColor.surface, lineWidth: 2))
    }
}

// MARK: - Open game card

/// A joinable open game, presented as a premium card. Tapping anywhere opens
/// the game detail (where the join flow + confirmation live).
struct OpenGameCard: View {
    let game: GameSummary

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 11) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DSColor.accentMuted)
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }
                .frame(width: 46, height: 46)
                VStack(alignment: .leading, spacing: 2) {
                    Text(game.venue_name ?? String(localized: "matches.venue.tbd"))
                        .font(DSType.cardTitle)
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    Text(GameDisplay.timeLabel(game.starts_at))
                        .font(DSType.metaCaption)
                        .foregroundStyle(DSColor.textSecondary)
                        .lineLimit(1)
                }
                Spacer()
                if let distance = GameDisplay.distanceLabel(game.distance_km) {
                    Text(distance)
                        .font(DSType.badge)
                        .foregroundStyle(DSColor.textSecondary)
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .background(Capsule().fill(DSColor.surfaceElevated))
                }
            }

            HStack(spacing: 10) {
                GameAvatarStack(game: game)
                Text(GameDisplay.levelLabel(min: game.skill_min_elo, max: game.skill_max_elo))
                    .font(DSType.badge)
                    .foregroundStyle(DSColor.limeInk)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(Capsule().fill(DSColor.secondaryMuted))
                    .lineLimit(1)
                Spacer()
            }

            VStack(spacing: 5) {
                HStack {
                    Text(GameDisplay.spots(game))
                        .font(DSType.caption2)
                        .foregroundStyle(DSColor.textSecondary)
                    Spacer()
                    Text(String(format: String(localized: "games.spots_left_format"), GameDisplay.spotsLeft(game)))
                        .font(DSType.caption2)
                        .foregroundStyle(DSColor.textSecondary)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(DSColor.surfaceElevated)
                        Capsule().fill(DSColor.accent)
                            .frame(width: max(6, geo.size.width * GameDisplay.fillFraction(game)))
                    }
                }
                .frame(height: 6)
            }

            HStack {
                Spacer()
                Text("matches.row.join")
                    .font(DSType.button)
                    .foregroundStyle(DSColor.limeInk)
                    .padding(.horizontal, 26).padding(.vertical, 9)
                    .background(Capsule().fill(DSColor.secondary))
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - My game row

/// Compact row for a game the viewer is hosting / in.
struct MyGameRow: View {
    let game: GameSummary

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DSColor.accent)
                Image(systemName: "calendar")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(DSColor.textOnAccent)
            }
            .frame(width: 42, height: 42)
            VStack(alignment: .leading, spacing: 2) {
                Text(GameDisplay.timeLabel(game.starts_at))
                    .font(DSType.bodyStrong)
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                Text("\(game.venue_name ?? String(localized: "matches.venue.tbd")) · \(GameDisplay.spots(game))")
                    .font(DSType.metaCaption)
                    .foregroundStyle(DSColor.textSecondary)
                    .lineLimit(1)
            }
            Spacer()
            Text("matches.row.hosting")
                .font(DSType.badge)
                .foregroundStyle(DSColor.accent)
                .padding(.horizontal, 9).padding(.vertical, 4)
                .background(Capsule().fill(DSColor.accentMuted))
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(DSColor.textTertiary)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Date filter chips

struct GameFilterChips: View {
    let selection: MatchesViewModel.DateFilter
    var onSelect: (MatchesViewModel.DateFilter) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                chip(.all, "common.all")
                chip(.today, "matches.day.today")
                chip(.tomorrow, "matches.day.tomorrow")
                chip(.nearby, "games.filter.nearby")
            }
        }
    }

    @ViewBuilder
    private func chip(_ value: MatchesViewModel.DateFilter, _ titleKey: LocalizedStringKey) -> some View {
        let isOn = selection == value
        Button {
            Haptics.selection()
            onSelect(value)
        } label: {
            Text(titleKey)
                .font(DSType.metaCaption)
                .foregroundStyle(isOn ? DSColor.textOnAccent : DSColor.textPrimary)
                .padding(.horizontal, 14).padding(.vertical, 7)
                .glassChip(isOn: isOn)
        }
        .buttonStyle(SpringPressStyle())
    }
}
