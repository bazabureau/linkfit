import SwiftUI

/// Tournaments list — segmented bucket filter (Upcoming / Live / Past) +
/// featured hero card + dense list rows. Taps push to TournamentDetailView.
///
/// On regular size classes (iPad / large landscape phones) the screen lays
/// itself out as a master-detail split: list on the left, the currently
/// selected tournament's detail on the right. On compact (iPhone portrait)
/// behaviour is unchanged — taps push onto the local `NavigationStack`.
struct TournamentsView: View {
    var viewModel: TournamentsViewModel
    /// Sticky selection used by the iPad split layout. `nil` triggers the
    /// "Select a tournament" empty state in the right pane.
    @State private var selectedTournamentId: String?
    @Environment(AppContainer.self) private var container
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Namespace private var tabAnimationNamespace

    var body: some View {
        AdaptiveSplit {
            ZStack {
                // Pure white canvas background
                DSColor.background.ignoresSafeArea()
                
                // Top-right ambient brand glow
                RadialGradient(
                    colors: [DSColor.accent.opacity(0.08), Color.clear],
                    center: .topTrailing,
                    startRadius: 10,
                    endRadius: 360
                )
                .ignoresSafeArea()
                .allowsHitTesting(false)
                
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        // Custom Redesigned Premium Header Hero
                        PremiumPageHero(
                            icon: "trophy.fill",
                            titleKey: "tournaments.title",
                            subtitleKey: "tournaments.subtitle"
                        )
                        .padding(.top, 8)
                        
                        bucketPicker
                        
                        content
                        
                        Spacer().frame(height: 120)
                    }
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.top, DSSpacing.md)
                }
                .refreshable { await viewModel.load() }
            }
            .navigationDestination(for: TournamentRoute.self) { route in
                switch route {
                case .detail(let id):
                    TournamentDetailView(
                        viewModel: TournamentDetailViewModel(
                            apiClient: container.apiClient,
                            tournamentId: id
                        )
                    )
                }
            }
        } detail: {
            // Only render an inline detail when we're actually in a split
            // layout AND the user has selected a row. Returning `nil`
            // surfaces the container's default empty state.
            if LayoutSize.isWideLayout(horizontalSizeClass), let id = selectedTournamentId {
                NavigationStack {
                    TournamentDetailView(
                        viewModel: TournamentDetailViewModel(
                            apiClient: container.apiClient,
                            tournamentId: id
                        )
                    )
                }
            } else {
                Optional<EmptyView>.none
            }
        }
        .task { await viewModel.load() }
    }

    /// Standardized Segmented Control picker for Tournaments
    private var bucketPicker: some View {
        SegmentedPicker(
            segments: [
                (TournamentBucketTab.upcoming, String(localized: "tournaments.bucket.upcoming" as String.LocalizationValue), Optional("calendar")),
                (TournamentBucketTab.live, String(localized: "tournaments.bucket.live" as String.LocalizationValue), Optional("dot.radiowaves.left.and.right")),
                (TournamentBucketTab.past, String(localized: "tournaments.bucket.past" as String.LocalizationValue), Optional("clock.arrow.circlepath"))
            ],
            selection: Binding(
                get: {
                    switch viewModel.bucket {
                    case .upcoming: return TournamentBucketTab.upcoming
                    case .live:     return TournamentBucketTab.live
                    case .past:     return TournamentBucketTab.past
                    }
                },
                set: { tab in
                    UISelectionFeedbackGenerator().selectionChanged()
                    withAnimation(.spring(response: 0.30, dampingFraction: 0.78)) {
                        viewModel.setBucket(tab.modelBucket)
                    }
                }
            )
        )
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(label: String(localized: "tournaments.loading"))
                .frame(height: 280)
        case .loaded(let items):
            LazyVStack(spacing: DSSpacing.md) {
                if let featured = items.first {
                    if LayoutSize.isWideLayout(horizontalSizeClass) {
                        Button {
                            selectedTournamentId = featured.id
                        } label: {
                            TournamentsListFeaturedCard(tournament: featured)
                        }
                        .buttonStyle(SpringPressStyle())
                    } else {
                        NavigationLink(value: TournamentRoute.detail(featured.id)) {
                            TournamentsListFeaturedCard(tournament: featured)
                        }
                        .buttonStyle(SpringPressStyle())
                    }
                }
                ForEach(items.dropFirst()) { t in
                    if LayoutSize.isWideLayout(horizontalSizeClass) {
                        Button {
                            selectedTournamentId = t.id
                        } label: {
                            TournamentRow(tournament: t)
                        }
                        .buttonStyle(SpringPressStyle())
                    } else {
                        NavigationLink(value: TournamentRoute.detail(t.id)) {
                            TournamentRow(tournament: t)
                        }
                        .buttonStyle(SpringPressStyle())
                    }
                }
            }
        case .empty:
            // Custom-illustrated stunning empty state with premium Azerbaijani copywriting
            TournamentEmptyStateView {
                Task { await viewModel.load() }
            }
            .frame(minHeight: 380)
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
                .frame(height: 320)
        }
    }
}

// MARK: - Custom Illustrated Trophy Empty State View

private struct TournamentEmptyStateView: View {
    let onRefresh: () -> Void
    @State private var isAnimating = false

    var body: some View {
        VStack(spacing: DSSpacing.lg) {
            Spacer(minLength: 16)
            
            // Custom Illustrated SwiftUI Trophy
            ZStack {
                // Background ambient radial glowing rings
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [DSColor.accent.opacity(0.12), Color.clear],
                            center: .center,
                            startRadius: 20,
                            endRadius: 90
                        )
                    )
                    .frame(width: 180, height: 180)
                    .scaleEffect(isAnimating ? 1.06 : 0.94)
                    .animation(.easeInOut(duration: 2.2).repeatForever(autoreverses: true), value: isAnimating)
                
                Circle()
                    .strokeBorder(
                        LinearGradient(
                            colors: [DSColor.accent.opacity(0.24), Color.clear],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
                    .frame(width: 130, height: 130)
                    .rotationEffect(.degrees(isAnimating ? 360 : 0))
                    .animation(.linear(duration: 20).repeatForever(autoreverses: false), value: isAnimating)
                
                // Beautiful metallic backplate glow
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [DSColor.accent.opacity(0.04), DSColor.secondaryMuted.opacity(0.08)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 96, height: 96)
                    .shadow(color: Color.black.opacity(0.02), radius: 6, x: 0, y: 3)
                
                // Outer glow for the trophy icon
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [DSColor.accent, DSColor.accentSoft],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 68, height: 68)
                    .shadow(color: DSColor.accent.opacity(0.3), radius: 10, y: 5)
                
                Image(systemName: "trophy.fill")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(DSColor.textOnAccent)
                    .shadow(color: Color.black.opacity(0.1), radius: 1)
                
                // Subtle sparkle highlight
                Image(systemName: "sparkles")
                    .font(.system(size: 14))
                    .foregroundStyle(DSColor.secondary)
                    .offset(x: 28, y: -24)
                    .scaleEffect(isAnimating ? 1.15 : 0.85)
                    .animation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true), value: isAnimating)
            }
            .onAppear {
                isAnimating = true
            }
            
            VStack(spacing: 8) {
                Text("Aktiv Turnir Yoxdur")
                    .font(.system(.title3, design: .rounded, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                
                Text("Tezliklə yeni həyəcanlı turnirlər və çempionatlar elan olunacaq! İndidən hazırlaş, reytinqini yüksəlt və kubok uğrunda mübarizəyə qoşul.")
                    .font(.system(.subheadline, design: .default, weight: .regular))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .padding(.horizontal, DSSpacing.sm)
            }
            
            Button(action: {
                Haptics.medium()
                onRefresh()
            }) {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .bold))
                    Text("Turnirləri Yenilə")
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                }
                .foregroundStyle(DSColor.textOnAccent)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background(
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [DSColor.accent, DSColor.accentSoft],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                )
                .shadow(color: DSColor.accent.opacity(0.24), radius: 6, y: 3)
            }
            .buttonStyle(.plain)
            .padding(.top, DSSpacing.xs)
            
            Spacer(minLength: 16)
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(DSColor.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .strokeBorder(DSColor.border, lineWidth: 1)
                )
                .shadow(color: Color.black.opacity(0.02), radius: 8, x: 0, y: 4)
        )
    }
}

// MARK: - TournamentBucketTab

private enum TournamentBucketTab: String, CaseIterable, Identifiable {
    case upcoming
    case live
    case past
    
    var id: String { rawValue }
    
    var modelBucket: TournamentBucket {
        switch self {
        case .upcoming: return .upcoming
        case .live:     return .live
        case .past:     return .past
        }
    }
    
    var title: String {
        switch self {
        case .upcoming: return String(localized: "tournaments.bucket.upcoming")
        case .live:     return String(localized: "tournaments.bucket.live")
        case .past:     return String(localized: "tournaments.bucket.past")
        }
    }
    
    var icon: String {
        switch self {
        case .upcoming: return "calendar"
        case .live:     return "dot.radiowaves.left.and.right"
        case .past:     return "clock.arrow.circlepath"
        }
    }
}

// MARK: - Navigation route

/// Route value pushed onto the host NavigationStack. Tournaments shell
/// (Discover/Play) listens for these on its `.navigationDestination`.
enum TournamentRoute: Hashable {
    case detail(String)
}

// MARK: - Featured card

private struct TournamentsListFeaturedCard: View {
    let tournament: Tournament

    var body: some View {
        HStack(spacing: 0) {
            // High-fidelity Royal Blue to Lime brand accent bar on the left edge
            LinearGradient(
                colors: [DSColor.accent, DSColor.secondary],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(width: 5)
            
            VStack(alignment: .leading, spacing: 0) {
                hero
                    .frame(height: 140)
                    .clipShape(UnevenRoundedRectangle(topTrailingRadius: 20))
                
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        TournamentStatusChip(status: tournament.status)
                        SportPill(slug: tournament.sport_slug)
                        Spacer()
                        if tournament.entry_fee_minor > 0 {
                            TournamentMoneyPill(amountMinor: tournament.entry_fee_minor,
                                                currency: tournament.currency,
                                                kind: .fee)
                        } else {
                            TournamentMoneyPill(amountMinor: 0, currency: tournament.currency, kind: .free)
                        }
                    }
                    
                    Text(tournament.name)
                        .font(.system(.title3, design: .rounded, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(2)

                    // Stats pills row
                    HStack(spacing: 8) {
                        // Date range
                        HStack(spacing: 4) {
                            Image(systemName: "calendar")
                                .font(.system(size: 9, weight: .bold))
                            Text(formattedDateRange(tournament: tournament))
                                .font(.system(.caption2, design: .rounded, weight: .bold))
                        }
                        .foregroundStyle(DSColor.textSecondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(DSColor.accentMuted)
                        .overlay(
                            Capsule().strokeBorder(DSColor.border, lineWidth: 0.7)
                        )
                        .clipShape(Capsule())
                        
                        // Squads
                        HStack(spacing: 4) {
                            Image(systemName: "person.3.fill")
                                .font(.system(size: 9, weight: .bold))
                            Text(String(format: String(localized: "tournaments.squads_format"),
                                         tournament.entries_count, tournament.max_squads))
                                .font(.system(.caption2, design: .rounded, weight: .bold))
                        }
                        .foregroundStyle(DSColor.textSecondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(DSColor.accentMuted)
                        .overlay(
                            Capsule().strokeBorder(DSColor.border, lineWidth: 0.7)
                        )
                        .clipShape(Capsule())
                    }
                    
                    if let venue = tournament.venue_name {
                        HStack(spacing: 4) {
                            Image(systemName: "mappin.and.ellipse")
                                .font(.system(size: 10))
                                .foregroundStyle(DSColor.accent)
                            Text(venue)
                                .font(.system(.caption, design: .rounded, weight: .semibold))
                        }
                        .foregroundStyle(DSColor.textTertiary)
                        .padding(.horizontal, 2)
                    }
                }
                .padding(16)
            }
        }
        .background(DSColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.03), radius: 10, x: 0, y: 5)
    }

    private var hero: some View {
        ZStack(alignment: .bottomLeading) {
            // Brand gradient field representation
            LinearGradient(
                colors: [DSColor.accent, DSColor.accentSoft],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            
            Image(systemName: TournamentSportIcon.forSlug(tournament.sport_slug))
                .font(.system(size: 100, weight: .bold))
                .foregroundStyle(.white.opacity(0.1))
                .rotationEffect(.degrees(-8))
                .offset(x: 160, y: -10)
            
            Text("tournaments.featured.kicker")
                .font(.system(size: 10, weight: .black, design: .rounded))
                .foregroundStyle(DSColor.textOnAccent)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(
                    Capsule().fill(
                        LinearGradient(
                            colors: [DSColor.accentSoft, DSColor.accent],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        )
                    )
                )
                .shadow(color: DSColor.accent.opacity(0.24), radius: 4)
                .padding(16)
        }
    }
}

// MARK: - List row

private struct TournamentRow: View {
    let tournament: Tournament

    var body: some View {
        HStack(spacing: 14) {
            // Circle Medallion style icon
            ZStack {
                Circle()
                    .fill(DSColor.accentMuted)
                    .frame(width: 50, height: 50)
                Image(systemName: TournamentSportIcon.forSlug(tournament.sport_slug))
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(DSColor.accent)
                    .shadow(color: DSColor.accent.opacity(0.2), radius: 2)
            }
            .overlay(
                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.15), lineWidth: 1)
            )

            VStack(alignment: .leading, spacing: 6) {
                Text(tournament.name)
                    .font(.system(.subheadline, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(2)
                
                HStack(spacing: 6) {
                    TournamentStatusChip(status: tournament.status)
                    if tournament.entry_fee_minor > 0 {
                        TournamentMoneyPill(amountMinor: tournament.entry_fee_minor,
                                            currency: tournament.currency,
                                            kind: .fee)
                    }
                    
                    HStack(spacing: 3) {
                        Image(systemName: "calendar")
                            .font(.system(size: 9))
                        Text(formattedDateRange(tournament: tournament))
                            .font(.system(.caption2, design: .rounded, weight: .bold))
                    }
                    .foregroundStyle(DSColor.textSecondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(DSColor.accentMuted)
                    .overlay(
                        Capsule().strokeBorder(DSColor.border, lineWidth: 0.7)
                    )
                    .clipShape(Capsule())
                }
            }
            Spacer()
            
            VStack(alignment: .trailing, spacing: 3) {
                Text("\(tournament.entries_count)/\(tournament.max_squads)")
                    .font(.system(.footnote, design: .rounded, weight: .heavy))
                    .foregroundStyle(DSColor.accent) // Highlighted in brand accent
                Text("tournaments.squads_short")
                    .font(.system(.caption2, design: .rounded, weight: .bold))
                    .foregroundStyle(DSColor.textTertiary)
            }
        }
        .padding(12)
        .background(DSColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.02), radius: 6, x: 0, y: 2)
    }
}

// MARK: - Helpers, shared chips

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
                .font(.system(size: 9, weight: .heavy, design: .rounded))
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
        Text(label.uppercased())
            .font(.system(size: 9, weight: .black, design: .rounded))
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
                .font(.system(size: 9, weight: .heavy, design: .rounded))
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
