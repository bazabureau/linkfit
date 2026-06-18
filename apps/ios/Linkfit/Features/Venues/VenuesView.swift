import SwiftUI
import MapKit
import UIKit

/// Find a club — clean discovery list. Rebuilt 2026-05-20 (FAZA 54)
/// to match the pattern shared by MatchesView and PlayersView:
///
///   - Native `.navigationTitle("Klublar")` (no duplicate hero title).
///   - Compact list/map segmented mode toggle.
///   - Optional sport chip strip — hidden when only one sport ships
///     (today: padel-only, so it never renders).
///   - Photo-first row cards: use the venue's actual `photo_urls[0]`
///     when present; fall back to the court illustration only when
///     the backend has no photos yet.
///   - Inline star rating row when reviews exist.
///   - Uniform `.ultraThinMaterial` across all surfaces.
struct VenuesView: View {
    @State var viewModel: VenuesViewModel
    var onOpenVenue: ((Venue) -> Void)? = nil

    enum DisplayMode: Hashable { case list, map }
    @State private var mode: DisplayMode = .list

    var body: some View {
        ZStack {
            AppGlassBackground()
            VStack(spacing: 0) {
                modePicker
                if mode == .list, viewModel.sports.count > 1 {
                    sportFilter
                }
                content
            }
        }
        .navigationTitle(Text("venues.title"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.onAppear() }
        .refreshable {
            if mode == .list { await viewModel.load() }
        }
    }

    private var modePicker: some View {
        SegmentedPicker(
            segments: [
                (DisplayMode.list, String(localized: "venues.tab.list" as String.LocalizationValue), Optional("list.bullet")),
                (DisplayMode.map, String(localized: "venues.tab.map" as String.LocalizationValue), Optional("map.fill"))
            ],
            selection: Binding(
                get: { mode },
                set: { newMode in
                    UISelectionFeedbackGenerator().selectionChanged()
                    withAnimation(UIAccessibility.isReduceMotionEnabled ? nil : .spring(response: 0.30, dampingFraction: 0.78)) {
                        mode = newMode
                    }
                }
            )
        )
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 10)
    }

    private var sportFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(title: String(localized: "venues.filter.all"), slug: nil)
                ForEach(viewModel.sports) { sport in
                    chip(title: sport.slug == "padel"
                         ? String(localized: "venues.filter.padel")
                         : String(localized: "venues.filter.football"),
                         slug: sport.slug)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    private func chip(title: String, slug: String?) -> some View {
        let selected = viewModel.selectedSportSlug == slug
        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
            Task { await viewModel.setSport(slug) }
        } label: {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Capsule().fill(selected ? DSColor.accent : DSColor.surfaceElevated))
                .overlay(Capsule().strokeBorder(
                    selected ? DSColor.accent : DSColor.border.opacity(0.35),
                    lineWidth: 1
                ))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(0..<6, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(DSColor.surface)
                            .frame(height: 96)
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .strokeBorder(DSColor.border, lineWidth: 1)
                            )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }
            .scrollIndicators(.hidden)
        case .loaded(let venues):
            if mode == .map {
                VenueMapView(venues: venues)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(String.localizedStringWithFormat(
                            NSLocalizedString("venues.count_format", comment: ""),
                            venues.count
                        ))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DSColor.textTertiary)
                        .padding(.bottom, 4)

                        ForEach(venues) { v in
                            Button {
                                UISelectionFeedbackGenerator().selectionChanged()
                                onOpenVenue?(v)
                            } label: {
                                VenueRowCard(venue: v)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .padding(.bottom, 40)
                }
                .scrollIndicators(.hidden)
            }
        case .empty:
            ScrollView {
                premiumEmptyState
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }
            .scrollIndicators(.hidden)
        case .error(let message):
            ScrollView {
                ErrorStateView(message: message) { Task { await viewModel.load() } }
                    .frame(minHeight: 360)
            }
            .scrollIndicators(.hidden)
        }
    }

    /// Premium empty state — glass medallion + heading + supporting line.
    /// Mirrors `MessagesViews.premiumEmptyState` for a unified language
    /// across the discovery surfaces. Splits filtered vs unfiltered copy:
    /// when the user has narrowed to a sport that has zero venues we
    /// offer a "Clear filters" CTA instead of the generic "check back
    /// later" message.
    @ViewBuilder
    private var premiumEmptyState: some View {
        let filtered = viewModel.selectedSportSlug != nil
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.16))
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.40), lineWidth: 1)
                    .frame(width: 72, height: 72)
                Image(systemName: filtered
                      ? "line.3.horizontal.decrease.circle"
                      : "building.2.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(spacing: 4) {
                Text(filtered
                     ? "venues.empty.filter.title"
                     : "venues.empty.title")
                    .font(.system(size: 17, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                Text(filtered
                     ? "venues.empty.filter.message"
                     : "venues.empty.message")
                    .font(.system(size: 14, weight: .regular, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .padding(.horizontal, 8)
            }
            if filtered {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    Task { await viewModel.setSport(nil) }
                } label: {
                    Text("venues.empty.filter.clear")
                        .font(.system(size: 13, weight: .heavy))
                        .foregroundStyle(DSColor.textOnAccent)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(Capsule().fill(DSColor.accent))
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .dsSurfaceCard(radius: 22)
        .padding(.top, 12)
    }
}

/// Photo-first venue row. Three sections: 80pt thumbnail (real photo
/// when available, illustration fallback otherwise) on the left, then
/// name + address + meta row (distance · rating) on the right, then
/// a chevron. Replaces the older "CourtListLines" illustration card
/// which gave every venue the same SF-Symbol-on-grey thumbnail.
private struct VenueRowCard: View {
    let venue: Venue

    var body: some View {
        HStack(spacing: 12) {
            thumbnail
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(venue.name)
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    if venue.is_partner {
                        Text("venues.partner")
                            .font(.system(size: 10, weight: .heavy))
                            .foregroundStyle(DSColor.accent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(DSColor.accent.opacity(0.16)))
                    }
                }
                Text(venue.address)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSColor.textSecondary)
                    .lineLimit(2)
                metaRow
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .heavy))
                .foregroundStyle(DSColor.textTertiary)
                .accessibilityHidden(true)
        }
        .padding(12)
        .dsSurfaceCard(radius: 18)
        // Composite row — VoiceOver reads venue name, partner badge,
        // address, distance, and rating as one continuous element
        // instead of focusing each sub-view in turn. Hint announces
        // the tap target's role since the row is wrapped in a Button.
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text("a11y.venue_card.hint"))
    }

    /// Real photo (first of `photo_urls`) when present; SF-symbol
    /// illustration otherwise. The placeholder reuses the existing
    /// `CourtListLines` shape so empty-photo venues still feel on-brand
    /// rather than generic.
    @ViewBuilder
    private var thumbnail: some View {
        let url: URL? = {
            if let first = venue.photo_urls?.first { return URL(string: first) }
            if let single = venue.photo_url { return URL(string: single) }
            return nil
        }()
        ZStack {
            if let url {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    placeholderIllustration
                }
            } else {
                placeholderIllustration
            }
        }
        .frame(width: 78, height: 78)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
        )
    }

    private var placeholderIllustration: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(DSColor.surfaceElevated)
            CourtListLines()
                .stroke(DSColor.textTertiary.opacity(0.35), lineWidth: 1)
                .padding(12)
            Image(systemName: "sportscourt")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(DSColor.accent.opacity(0.78))
        }
    }

    private var metaRow: some View {
        HStack(spacing: 10) {
            if let km = venue.distance_km {
                HStack(spacing: 3) {
                    Image(systemName: "location.fill")
                        .font(.system(size: 9, weight: .heavy))
                    Text(String(format: "%.1f km", km))
                        .font(.system(size: 11, weight: .heavy))
                        .monospacedDigit()
                }
                .foregroundStyle(DSColor.textTertiary)
            }
            if let avg = venue.rating_avg, let count = venue.rating_count, count > 0 {
                HStack(spacing: 3) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundStyle(DSColor.warning)
                    Text(String(format: "%.1f", avg))
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                        .monospacedDigit()
                    Text(verbatim: "(\(count))")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(DSColor.textTertiary)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct CourtListLines: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.addRect(rect)
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        path.move(to: CGPoint(x: rect.midX, y: rect.minY + rect.height * 0.25))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.minY + rect.height * 0.75))
        return path
    }
}

@Observable
@MainActor
final class VenueDetailViewModel {
    private(set) var state: ViewState<VenueDetail> = .idle
    let apiClient: APIClient
    let venueId: String
    /// Optional viewer id for the reviews hook (its UI needs to know
    /// whose review to flag as "you wrote this"). Defaults to nil
    /// when no one's signed in.
    var currentUserId: String?

    init(apiClient: APIClient, venueId: String, currentUserId: String? = nil) {
        self.apiClient = apiClient
        self.venueId = venueId
        self.currentUserId = currentUserId
    }

    /// Convenience accessor returning the loaded `VenueDetail` if any.
    /// Used by callers (e.g. the booking sheet) that need the venue
    /// payload without pattern-matching on `state` themselves.
    var loadedVenue: VenueDetail? {
        if case .loaded(let v) = state { return v }
        return nil
    }

    func load() async {
        if case .loaded = state {} else { state = .loading }
        guard UUID(uuidString: venueId) != nil else {
            state = .error(message: String(localized: "api.error.not_found"))
            return
        }
        do {
            state = .loaded(try await apiClient.send(.venue(id: venueId)))
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.errorDescription ?? String(localized: "venues.error.load"))
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }
}

struct VenueDetailView: View {
    @State var viewModel: VenueDetailViewModel
    @State private var showBooking = false

    var body: some View {
        ZStack {
            AppGlassBackground()
            content
        }
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load() }
        .sheet(isPresented: $showBooking) {
            // Pre-seed BookCourtView with this venue (and its first
            // available court) so the user doesn't have to re-pick
            // the venue/court they're already viewing. The booking
            // flow jumps straight to date/time selection.
            BookCourtView(
                presetVenueId: viewModel.loadedVenue?.id,
                presetCourtId: viewModel.loadedVenue?.courts.first?.id
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .presentationBackground(.ultraThinMaterial)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(label: String(localized: "venues.loading"))
        case .loaded(let venue):
            detail(venue)
        case .empty:
            EmptyStateView(
                icon: "building.2",
                title: String(localized: "venues.empty.title"),
                message: String(localized: "venues.empty.message")
            )
        case .error(let message):
            ErrorStateView(message: message) { Task { await viewModel.load() } }
        }
    }

    /// VenueDetail v2 (FAZA 61.4) — global-level layout pattern that
    /// mirrors Apple Maps's Place card / Google's Place page:
    ///   1. Full-bleed hero photo carousel (lifted out of any card)
    ///   2. Identity block (name + partner + address line)
    ///   3. Inline stats strip (rating · courts · distance) — four-up
    ///   4. Action row (book / directions / call) as a sticky CTA group
    ///   5. About (description) — only when present
    ///   6. Courts list — modernized rows
    ///   7. Map
    ///   8. Reviews
    /// The hero deliberately doesn't live inside the identity card —
    /// stacking cards-inside-cards is the design debt we're paying off
    /// from FAZA 50.
    private func detail(_ venue: VenueDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                heroMedia(venue)
                identityBlock(venue)
                statsStrip(venue)
                actionRow(venue)
                if let description = venue.description, !description.isEmpty {
                    aboutSection(description)
                }
                courtsCard(venue)
                mapCard(venue)
                // Reviews come last — social proof tier shouldn't fight
                // the booking action for above-the-fold attention.
                VenueReviewsHook.makeVenueReviewsView(
                    venueId: venue.id,
                    apiClient: viewModel.apiClient,
                    currentUserId: viewModel.currentUserId
                )
                Spacer().frame(height: 80)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
        .scrollIndicators(.hidden)
        .navigationTitle(venue.name)
    }

    /// Identity block sitting under the hero. No card wrapper — the
    /// page already has the hero as its anchor, a second container
    /// here would over-segment the layout.
    private func identityBlock(_ venue: VenueDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(venue.name)
                    .font(.system(size: 26, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                if venue.is_partner {
                    Text("venues.partner")
                        .font(.system(size: 10, weight: .heavy))
                        .foregroundStyle(DSColor.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(DSColor.accent.opacity(0.14)))
                        .overlay(Capsule().strokeBorder(DSColor.accent.opacity(0.45), lineWidth: 1))
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 6) {
                Image(systemName: "mappin.and.ellipse")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(DSColor.accent)
                Text(venue.address)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// Four-column inline stats strip — Apple Health pattern. Renders
    /// rating, courts count, distance, and partner status; cells that
    /// don't apply collapse to a "—" so the dividers stay aligned.
    private func statsStrip(_ venue: VenueDetail) -> some View {
        HStack(alignment: .center, spacing: 0) {
            statCell(
                value: venue.rating_avg.map { String(format: "%.1f", $0) } ?? "—",
                labelKey: "venue.stat.rating",
                icon: "star.fill"
            )
            statStripDivider
            statCell(
                value: "\(venue.courts.count)",
                labelKey: "venue.stat.courts",
                icon: "sportscourt"
            )
            statStripDivider
            statCell(
                value: venue.distance_km.map { String(format: "%.1f", $0) } ?? "—",
                labelKey: "venue.stat.distance_km",
                icon: "location"
            )
            statStripDivider
            statCell(
                value: venue.rating_count.map { "\($0)" } ?? "0",
                labelKey: "venue.stat.reviews",
                icon: "bubble.left.fill"
            )
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 10)
        .dsSurfaceCard(radius: 18)
    }

    private func statCell(value: String, labelKey: LocalizedStringKey, icon: String) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .heavy))
                    .foregroundStyle(DSColor.accent)
                Text(value)
                    .font(.system(size: 17, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Text(labelKey)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(DSColor.textTertiary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity)
    }

    private var statStripDivider: some View {
        Rectangle()
            .fill(DSColor.border.opacity(0.35))
            .frame(width: 1, height: 28)
    }

    /// Description section — no card wrapper, just a header + body
    /// inset. A full card wrapper was over-engineered for
    /// what is essentially a single paragraph.
    private func aboutSection(_ description: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                Text("widget.description")
                    .font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
            } icon: {
                Image(systemName: "text.alignleft")
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(DSColor.accent)
            }
            Text(description)
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(DSColor.textSecondary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .dsSurfaceCard(radius: 18)
    }

    private func hero(_ venue: VenueDetail) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            heroMedia(venue)

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: DSSpacing.xs) {
                    Text(venue.name)
                        .font(.system(size: 28, weight: .bold, design: .default))
                        .foregroundStyle(DSColor.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    if venue.is_partner {
                        Text("venues.partner")
                            .font(DSType.caption)
                            .foregroundStyle(DSColor.accent)
                            .padding(.horizontal, DSSpacing.xs)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(DSColor.accentMuted))
                    }
                }

                Label {
                    Text(venue.address)
                        .font(.system(.subheadline, design: .default))
                        .foregroundStyle(DSColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "mappin.and.ellipse")
                        .foregroundStyle(DSColor.accent)
                }

                // Star rating row — sits below the address so users
                // can size up the venue at a glance before tapping
                // through to the reviews further down.
                if let avg = venue.rating_avg, let count = venue.rating_count, count > 0 {
                    HStack(spacing: 6) {
                        Image(systemName: "star.fill")
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundStyle(DSColor.warning)
                        Text(String(format: "%.1f", avg))
                            .font(.system(.subheadline, design: .default, weight: .heavy))
                            .foregroundStyle(DSColor.textPrimary)
                            .monospacedDigit()
                        Text(String(format: String(localized: "venue.rating_count_format"), count))
                            .font(.system(.footnote, design: .default))
                            .foregroundStyle(DSColor.textSecondary)
                    }
                }
            }
        }
        .padding(DSSpacing.md)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
    }

    /// Photo carousel hero. Renders a `TabView`-based pager when the
    /// venue has photos in `photo_urls`, or falls back to the
    /// illustration the old design shipped. Page indicators sit
    /// inside the image as small dots — the standard mobile pattern.
    @ViewBuilder
    private func heroMedia(_ venue: VenueDetail) -> some View {
        let photos = venue.photo_urls ?? []
        if !photos.isEmpty {
            TabView {
                ForEach(Array(photos.enumerated()), id: \.offset) { _, url in
                    if let u = URL(string: url) {
                        CachedAsyncImage(url: u) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            heroIllustration
                        }
                    } else {
                        heroIllustration
                    }
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .frame(height: 220)
            .clipShape(RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                    .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
            )
        } else {
            heroIllustration
                .frame(height: 180)
                .clipShape(RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous))
        }
    }

    private var heroIllustration: some View {
        ZStack {
            DSColor.surfaceElevated
            CourtDetailLines()
                .stroke(DSColor.textTertiary.opacity(0.28), lineWidth: 1)
                .padding(28)
            Image(systemName: "sportscourt")
                .font(.system(size: 34, weight: .regular))
                .foregroundStyle(DSColor.accent.opacity(0.58))
        }
    }

    private func actionRow(_ venue: VenueDetail) -> some View {
        HStack(spacing: DSSpacing.sm) {
            PrimaryButton(
                title: String(localized: "actions.book_court"),
                icon: "calendar.badge.plus"
            ) {
                showBooking = true
            }

            Button {
                openDirections(venue)
            } label: {
                Image(systemName: "arrow.triangle.turn.up.right.diamond.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
                    .frame(width: 52, height: 52)
                    .background(RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous).fill(DSColor.surface))
                    .overlay(RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("venues.get_directions"))
            .accessibilityHint(Text("a11y.directions"))

            if let phone = venue.phone, let url = phoneURL(phone) {
                Button {
                    UIApplication.shared.open(url)
                } label: {
                    Image(systemName: "phone.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                        .frame(width: 52, height: 52)
                        .background(RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous).fill(DSColor.surface))
                        .overlay(RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
                // Icon-only call button — VoiceOver users would
                // otherwise hear nothing more than "Button" here.
                .accessibilityLabel(Text("a11y.call"))
                .accessibilityHint(Text(phone))
            }
        }
    }

    private func infoCard(title: String, icon: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Label(title, systemImage: icon)
                .font(.system(.headline, design: .default, weight: .semibold))
                .foregroundStyle(DSColor.textPrimary)
            Text(text)
                .font(.system(.subheadline, design: .default))
                .foregroundStyle(DSColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
    }

    private func courtsCard(_ venue: VenueDetail) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text("book.step.court")
                .font(.system(.headline, design: .default, weight: .semibold))
                .foregroundStyle(DSColor.textPrimary)

            if venue.courts.isEmpty {
                Text("book.empty.message")
                    .font(.system(.subheadline, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
            } else {
                // Plain rows + dividers — no inner card backgrounds inside
                // this card (nested cards are banned by the guidelines).
                ForEach(venue.courts) { court in
                    HStack(spacing: DSSpacing.sm) {
                        Image(systemName: court.sport_slug == "padel" ? "figure.tennis" : "sportscourt")
                            .foregroundStyle(DSColor.accent)
                            .frame(width: 28)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(court.name)
                                .font(.system(.subheadline, design: .default, weight: .semibold))
                                .foregroundStyle(DSColor.textPrimary)
                            Text(courtPrice(court))
                                .font(.system(.caption, design: .default))
                                .foregroundStyle(DSColor.textSecondary)
                        }
                        Spacer()
                    }
                    .padding(.vertical, DSSpacing.xs)
                    if court.id != venue.courts.last?.id {
                        Divider()
                    }
                }
            }
        }
        .padding(DSSpacing.md)
        .dsSurfaceCard(radius: DSRadius.lg)
    }

    private func mapCard(_ venue: VenueDetail) -> some View {
        Map(initialPosition: .region(MKCoordinateRegion(
            center: .init(latitude: venue.lat, longitude: venue.lng),
            span: MKCoordinateSpan(latitudeDelta: 0.015, longitudeDelta: 0.015)
        ))) {
            Annotation(venue.name, coordinate: .init(latitude: venue.lat, longitude: venue.lng)) {
                Circle()
                    .fill(DSColor.accent)
                    .frame(width: 18, height: 18)
                    .overlay(Circle().strokeBorder(DSColor.textOnAccent, lineWidth: 2))
            }
        }
        .frame(height: 180)
        .clipShape(RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
    }

    private func courtPrice(_ court: Court) -> String {
        let price = Money.format(minor: court.hourly_price_minor, currency: court.currency)
        return "\(price) \(String(localized: "venues.price.per_hour"))"
    }

    private func openDirections(_ venue: VenueDetail) {
        let destination = "\(venue.lat),\(venue.lng)"
        guard let encodedName = venue.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "https://maps.apple.com/?daddr=\(destination)&q=\(encodedName)")
        else { return }
        UIApplication.shared.open(url)
    }

    private func phoneURL(_ raw: String) -> URL? {
        let cleaned = raw.filter { $0.isNumber || $0 == "+" }
        guard !cleaned.isEmpty else { return nil }
        return URL(string: "tel://\(cleaned)")
    }
}

private struct CourtDetailLines: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.addRect(rect)
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.addEllipse(in: CGRect(x: rect.midX - 24, y: rect.midY - 24, width: 48, height: 48))
        return path
    }
}
