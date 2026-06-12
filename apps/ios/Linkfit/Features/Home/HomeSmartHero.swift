import SwiftUI

/// The biggest visual element on home. Context-aware: when the user
/// has a hosted upcoming game in the visible feed it shows match
/// details + a "View" CTA; otherwise it falls back to a generic
/// "host or find a game" composition.
///
/// Why this is two heroes in one:
///   - Static "Bu gün padel?" cards feel generic to returning users.
///   - A "Your next match — 19:00 at Padel Center Baku" card is the
///     single most engaging element on the screen for an active user;
///     they tap to confirm details, see who's joined, share the link.
///   - New users without games never see the personalised hero, so
///     they get the inviting CTA instead — the same component covers
///     both cohorts.
///
/// Visual treatment is identical (mesh + lime tint + heavy type) so
/// the page rhythm stays consistent between empty and populated
/// states; only the inner content swaps.
struct HomeSmartHero: View {
    /// The user's next hosted/joined game, if any.
    let upcomingGame: GameSummary?
    var onTapGame: (GameSummary) -> Void
    var onCreate: () -> Void
    var onFind: () -> Void

    var body: some View {
        if let game = upcomingGame {
            UpcomingMatchHero(game: game) { onTapGame(game) }
        } else {
            EmptyActionHero(onCreate: onCreate, onFind: onFind)
        }
    }
}

// MARK: - Variant: user has an upcoming game

private struct UpcomingMatchHero: View {
    let game: GameSummary
    var onOpen: () -> Void

    var body: some View {
        Button {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            onOpen()
        } label: {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Text("home.smart.kicker.upcoming")
                        .font(.system(size: 13, weight: .heavy, design: .default))
                        .foregroundStyle(DSColor.accent)
                    Spacer()
                    timeBadge
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(timeText)
                        .font(.system(size: 28, weight: .heavy, design: .default))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    if let venue = game.venue_name, !venue.isEmpty {
                        HStack(spacing: 6) {
                            Image(systemName: "mappin.and.ellipse")
                                .font(.system(size: 12, weight: .heavy))
                            Text(venue)
                                .font(.system(size: 14, weight: .semibold))
                                .lineLimit(1)
                        }
                        .foregroundStyle(DSColor.textSecondary)
                    }
                }

                HStack(spacing: 10) {
                    fillBar
                    Text("\(game.participants_count)/\(game.capacity)")
                        .font(.system(size: 12, weight: .heavy, design: .default))
                        .foregroundStyle(DSColor.textSecondary)
                        .monospacedDigit()
                }

                HStack(spacing: 6) {
                    Text("home.smart.cta.open_match")
                        .font(.system(size: 14, weight: .heavy))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 12, weight: .heavy))
                }
                .foregroundStyle(DSColor.textOnAccent)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Capsule().fill(DSColor.accent))
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(cardBackground)
            .overlay(cardStroke)
        }
        .buttonStyle(.plain)
    }

    private var timeText: String {
        guard let date = Date.fromISO(game.starts_at) else { return game.starts_at }
        let cal = Calendar.current
        let f = DateFormatter()
        f.locale = .current
        if cal.isDateInToday(date) {
            f.dateFormat = "HH:mm"
            return String(format: String(localized: "home.smart.today_at_format"), f.string(from: date))
        }
        if cal.isDateInTomorrow(date) {
            f.dateFormat = "HH:mm"
            return String(format: String(localized: "home.smart.tomorrow_at_format"), f.string(from: date))
        }
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: date)
    }

    /// "Bu gün" / "Sabah" / specific-date pill in the top-right.
    private var timeBadge: some View {
        let key: LocalizedStringKey = {
            guard let date = Date.fromISO(game.starts_at) else { return "home.smart.today" }
            let cal = Calendar.current
            if cal.isDateInToday(date) { return "home.smart.today" }
            if cal.isDateInTomorrow(date) { return "home.smart.tomorrow" }
            return "home.smart.soon"
        }()
        return Text(key)
            .font(.system(size: 11, weight: .heavy, design: .default))
            .foregroundStyle(DSColor.accent)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(DSColor.accent.opacity(0.16)))
    }

    private var fillBar: some View {
        let fraction = max(0.05, min(1.0, Double(game.participants_count) / Double(max(1, game.capacity))))
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(DSColor.border.opacity(0.35))
                Capsule().fill(DSColor.accent)
                    .frame(width: geo.size.width * CGFloat(fraction))
            }
        }
        .frame(height: 5)
        .frame(maxWidth: .infinity)
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: 24, style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay(
                LinearGradient(
                    colors: [
                        DSColor.accent.opacity(0.18),
                        DSColor.accent.opacity(0.05),
                        Color.clear
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            )
    }

    private var cardStroke: some View {
        RoundedRectangle(cornerRadius: 24, style: .continuous)
            .strokeBorder(DSColor.accent.opacity(0.28), lineWidth: 1)
    }
}

// MARK: - Variant: no upcoming game — generic CTA

/// Empty-state hero. Major visual rebuild on 2026-05-20: instead of
/// a small medallion + two equal-weight buttons (which looked nearly
/// identical to the previous design), this version is a tall
/// announcement-style card with a centred padel court motif, hero
/// typography, a single primary CTA, and a secondary text link. The
/// pattern follows Headspace's "Today" card and Spotify's editorial
/// hero — both of which earn their height by feeling like an
/// invitation rather than a tile in a menu.
private struct EmptyActionHero: View {
    var onCreate: () -> Void
    var onFind: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            courtMotif
            VStack(spacing: 6) {
                Text("home.empty_hero.title")
                    .font(.system(size: 28, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                Text("home.empty_hero.subtitle")
                    .font(.system(size: 14, weight: .medium, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 8)

            primaryCTA
            secondaryCTA
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 24)
        .frame(maxWidth: .infinity)
        .background(cardBackground)
        .overlay(cardStroke)
    }

    /// Stylised padel-court motif at the top of the hero — gives the
    /// card a brand-specific image rather than a generic SF Symbol.
    /// Three rounded rectangles approximate net + two service boxes.
    private var courtMotif: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(DSColor.accent.opacity(0.55), lineWidth: 2.5)
                .frame(width: 92, height: 62)
            Rectangle()
                .fill(DSColor.accent.opacity(0.55))
                .frame(width: 2, height: 62)
            Circle()
                .fill(DSColor.accent)
                .frame(width: 8, height: 8)
                .shadow(color: DSColor.accent.opacity(0.65), radius: 6)
        }
        .padding(.top, 6)
    }

    private var primaryCTA: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            onFind()
        } label: {
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 14, weight: .heavy))
                Text("home.empty_hero.cta_primary")
                Image(systemName: "arrow.right")
                    .font(.system(size: 12, weight: .heavy))
            }
            .font(.system(size: 15, weight: .heavy, design: .default))
            .foregroundStyle(DSColor.textOnAccent)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Capsule().fill(DSColor.accent))
            .shadow(color: DSColor.accent.opacity(0.32), radius: 14, y: 8)
        }
        .buttonStyle(.plain)
    }

    /// Secondary text-link CTA — "Or host one yourself." Demoted to
    /// a text link rather than an equally-weighted button because
    /// 80% of users come to a sports app to JOIN games, not HOST.
    /// Two equal buttons would imply equal frequency; a primary + a
    /// link more honestly maps to actual behaviour.
    private var secondaryCTA: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onCreate()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "plus.circle")
                    .font(.system(size: 13, weight: .heavy))
                Text("home.empty_hero.cta_secondary")
            }
            .font(.system(size: 13, weight: .heavy, design: .default))
            .foregroundStyle(DSColor.accent)
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: 26, style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay(
                LinearGradient(
                    colors: [
                        DSColor.accent.opacity(0.20),
                        DSColor.accent.opacity(0.06),
                        Color.clear,
                        DSColor.accent.opacity(0.08)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
            )
    }

    private var cardStroke: some View {
        RoundedRectangle(cornerRadius: 26, style: .continuous)
            .strokeBorder(DSColor.accent.opacity(0.30), lineWidth: 1)
    }
}
