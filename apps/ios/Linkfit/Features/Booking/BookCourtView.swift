import SwiftUI

/// Three-step Book Court flow:
///   1. Pick a venue (from real /api/v1/venues data)
///   2. Pick a court (loaded for that venue)
///   3. Pick a date + time slot and confirm
///
/// Tap Confirm and we POST to `/api/v1/bookings` with a stable
/// `idempotency_key` so retries don't double-book. On success the user
/// lands on the success card with an inline "See my bookings" CTA that
/// pushes `MyBookingsView`.
struct BookCourtView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppContainer.self) private var container
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Optional preset venue. When non-nil we skip the venue picker
    /// step and start on the court (or slot) step instead. Stored
    /// in `let` because presets are immutable for the lifetime of
    /// the view — only the picker-based flow needs them mutable.
    private let presetVenueId: String?
    /// Optional preset court within `presetVenueId`. Requires
    /// `presetVenueId` to be set as well; when present we skip both
    /// the venue and court pickers and land on slot selection.
    private let presetCourtId: String?

    @State private var step: Step
    @State private var venuesState: ViewState<[Venue]> = .idle
    @State private var venue: Venue?
    @State private var detail: VenueDetail?
    @State private var court: Court?
    /// The day the user has selected from the horizontal 7-day pill row.
    /// We keep day + time separately and recompose `startsAt` whenever
    /// either changes — this is cleaner than juggling a single Date and
    /// makes the "today shows current half-hour as past, tomorrow opens
    /// at 09:00" rules trivial to express.
    @State private var selectedDate: Date = Calendar.current.startOfDay(for: Date())
    /// Selected slot in minutes-from-midnight (e.g. 19:30 → 19 * 60 + 30 = 1170).
    /// Nil means the user hasn't picked a time yet — Confirm stays disabled.
    @State private var selectedSlotMinute: Int?
    /// Default 90min — padel's most common booking length per ops.
    @State private var durationMinutes: Int = 90
    /// Booked-slot bitmap for `selectedDate`, keyed by minute-of-day.
    /// Populated from `GET /courts/{id}/availability` — slots the server
    /// marks booked render greyed-out and non-tappable.
    @State private var bookedSlotMinutes: Set<Int> = []
    @State private var isConfirming = false
    @State private var confirmed = false
    @State private var error: String?
    /// True when the last booking attempt failed with a slot conflict
    /// (HTTP 409 / `slot_conflict`). Drives the error copy and hides the
    /// retry button — the user has to pick another time instead.
    @State private var errorIsConflict = false
    @State private var confirmedBooking: Booking?
    @State private var showMyBookings = false
    /// Stable per-attempt idempotency key. Generated lazily on first Confirm
    /// tap and reused for any retry inside the same Confirm session.
    @State private var idempotencyKey: String = UUID().uuidString

    // Success pulsing halo scale state
    @State private var pulseScale: CGFloat = 1.0

    /// Designated initializer.
    ///
    /// - Parameters:
    ///   - presetVenueId: When provided, the venue picker is skipped
    ///     and the flow opens on the court step. The venue is hydrated
    ///     from `/api/v1/venues/{id}` on appear.
    ///   - presetCourtId: When provided alongside `presetVenueId`, the
    ///     court picker is skipped too and the flow opens directly on
    ///     the date/time selection. Ignored if `presetVenueId` is nil.
    ///
    /// Defaults preserve the original picker-first behaviour, so any
    /// existing call site (e.g. HomeView's general "Book" CTA) keeps
    /// the 3-step venue → court → slot flow unchanged.
    init(presetVenueId: String? = nil, presetCourtId: String? = nil) {
        self.presetVenueId = presetVenueId
        // A presetCourtId without a presetVenueId is meaningless —
        // we can't load the court without knowing its venue, so we
        // drop it rather than open the picker in a half-broken state.
        self.presetCourtId = presetVenueId == nil ? nil : presetCourtId
        let initialStep: Step
        if presetVenueId != nil, presetCourtId != nil {
            initialStep = .slot
        } else if presetVenueId != nil {
            initialStep = .court
        } else {
            initialStep = .venue
        }
        _step = State(initialValue: initialStep)
    }

    enum Step: Int, CaseIterable, Hashable {
        case venue, court, slot
        var titleKey: LocalizedStringKey {
            switch self {
            case .venue: return "book.step.venue"
            case .court: return "book.step.court"
            case .slot:  return "book.step.slot"
            }
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()

                if confirmed {
                    successCard
                } else {
                    VStack(spacing: 0) {
                        stepper
                        
                        Divider()
                            .overlay(DSColor.border)
                            .padding(.top, 4)
                        
                        content
                    }
                }
            }
            .navigationTitle(navTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: backOrClose) {
                        Image(systemName: step == .venue || confirmed ? "xmark" : "chevron.left")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .tint(DSColor.textPrimary)
                    // The icon flips between "xmark" (closes the sheet) and "chevron.left" (steps back)
                    .accessibilityLabel(Text(step == .venue || confirmed ? "common.close" : "a11y.back"))
                }
            }
            .navigationDestination(isPresented: $showMyBookings) {
                MyBookingsView(viewModel: MyBookingsViewModel(apiClient: container.apiClient))
            }
            .task { await bootstrap() }
        }
    }

    /// Entry point for first-appearance loading. Splits two modes:
    ///   - Preset flow (we already know the venue id): load the detail
    ///     directly and pre-select the venue + court so the user lands
    ///     on the court or slot step with zero taps.
    ///   - Picker flow (no preset): load the venue list so the user can pick one.
    private func bootstrap() async {
        if let presetVenueId {
            await loadPresetVenue(id: presetVenueId, courtId: presetCourtId)
        } else {
            await loadVenues()
        }
    }

    /// Hydrate the view from a preset venue id. Pulls the detail
    /// once and seeds `venue` / `detail` / `court` so the step the
    /// initializer already advanced us to has everything it needs.
    private func loadPresetVenue(id: String, courtId: String?) async {
        do {
            let d = try await container.apiClient.send(.venue(id: id))
            detail = d
            // Synthesize a Venue summary from the detail so the
            // header + summary card render the same way as in the
            // picker flow (which sets `venue` from the listing).
            venue = Venue(
                id: d.id,
                name: d.name,
                address: d.address,
                lat: d.lat,
                lng: d.lng,
                is_partner: d.is_partner,
                phone: d.phone,
                description: d.description,
                distance_km: d.distance_km,
                photo_url: d.photo_url,
                photo_urls: d.photo_urls,
                rating_avg: d.rating_avg,
                rating_count: d.rating_count
            )
            // Match the preset to the venue's actual court list. If
            // we can't find it (stale id, server pruned the court),
            // fall back to picker-style behaviour rather than POSTing
            // a court that doesn't exist.
            if let cid = courtId, let match = d.courts.first(where: { $0.id == cid }) {
                court = match
            } else if courtId == nil, d.courts.count == 1 {
                court = d.courts.first
            } else if courtId != nil {
                // Preset court id didn't resolve — drop back to the
                // court step so the user can pick manually.
                court = nil
                withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.8)) {
                    step = .court
                }
            }
        } catch let e as APIError {
            error = e.errorDescription
        } catch is CancellationError {
            return
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Retry the venue-detail load behind the court step. Clears the
    /// stale error then re-hydrates from whichever source seeded the
    /// step: a preset venue id, or the venue the user tapped in the
    /// picker. Without a known venue id there is nothing to reload, so
    /// we just drop the error and let the (empty) state re-render.
    private func retryCourtLoad() async {
        error = nil
        if let presetVenueId {
            await loadPresetVenue(id: presetVenueId, courtId: presetCourtId)
        } else if let v = venue {
            await loadVenueDetail(for: v)
        }
    }

    private var navTitle: LocalizedStringKey {
        confirmed ? "book.confirmed.title" : step.titleKey
    }

    // MARK: - Step bar

    private var stepper: some View {
        HStack(spacing: 8) {
            ForEach(Step.allCases, id: \.self) { s in
                let active = s.rawValue <= step.rawValue
                let isCurrent = s == step
                Capsule()
                    .fill(isCurrent ? DSColor.accent : (active ? DSColor.accent.opacity(0.4) : DSColor.border))
                    .frame(height: 4)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.8), value: step)
        .accessibilityElement(children: .ignore)
        .accessibilityValue(Text("\(step.rawValue + 1) / \(Step.allCases.count)"))
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case .venue: venueStep
        case .court: courtStep
        case .slot:  slotStep
        }
    }

    // MARK: - 1) Venue

    private var venueStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("book.venue.subtitle")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
                    .padding(.horizontal, 4)
                
                switch venuesState {
                case .idle, .loading:
                    LoadingView().frame(height: 200)
                case .loaded(let list):
                    VStack(spacing: 12) {
                        ForEach(list) { v in
                            Button { select(venue: v) } label: {
                                venueRow(v, selected: v.id == venue?.id)
                            }
                            .buttonStyle(SpringPressStyle())
                        }
                    }
                case .empty:
                    EmptyStateView(
                        icon: "building.2",
                        title: String(localized: "book.empty.title"),
                        message: String(localized: "book.empty.message")
                    )
                    .frame(height: 240)
                case .error(let m):
                    ErrorStateView(message: m) { Task { await loadVenues() } }
                        .frame(height: 240)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
        }
    }

    private func venueCoverURL(_ v: Venue) -> URL? {
        if let first = v.photo_urls?.first, let u = URL(string: first) { return u }
        if let s = v.photo_url, let u = URL(string: s) { return u }
        return nil
    }

    private var venueThumbFallback: some View {
        Image(systemName: "building.2.fill")
            .font(.system(size: 22, weight: .bold))
            .foregroundStyle(DSColor.accent)
    }

    private func venueRow(_ v: Venue, selected: Bool) -> some View {
        HStack(spacing: 14) {
            // Photo-first thumbnail — real venue cover, icon fallback.
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(DSColor.surfaceElevated)
                if let url = venueCoverURL(v) {
                    CachedAsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        venueThumbFallback
                    }
                } else {
                    venueThumbFallback
                }
            }
            .frame(width: 60, height: 60)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
            .accessibilityHidden(true)
            
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(v.name)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    
                    if v.is_partner {
                        Image(systemName: "sparkles")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(DSColor.accent)
                    }
                }
                
                Text(v.address)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
                    .lineLimit(1)
                
                // Only show a star rating when the venue actually has
                // one — never fabricate a 4.8 (12) for unrated venues.
                if let avg = v.rating_avg, let count = v.rating_count, count > 0 {
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(DSColor.warning)
                        Text(String(format: "%.1f", avg))
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(DSColor.textSecondary)
                        Text("(\(count))")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(DSColor.textTertiary)
                    }
                }
            }
            
            Spacer()
            
            VStack(alignment: .trailing, spacing: 8) {
                if let km = v.distance_km {
                    Text(String(format: "%.1f km", km))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(DSColor.textSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(DSColor.surfaceElevated))
                        .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: 1))
                }
                
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(DSColor.textTertiary)
                    .accessibilityHidden(true)
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(selected ? DSColor.accent : DSColor.border, lineWidth: selected ? 1.5 : 1)
        )
        // Combine into one accessible element so VoiceOver reads cleanly
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityHint(Text("a11y.venue_card.hint"))
    }

    // MARK: - 2) Court

    private var courtStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let v = venue {
                    venueHeader(v)
                }
                
                if let courts = detail?.courts, !courts.isEmpty {
                    VStack(spacing: 12) {
                        ForEach(courts) { c in
                            Button { select(court: c) } label: {
                                courtRow(c, selected: c.id == court?.id)
                            }
                            .buttonStyle(SpringPressStyle())
                        }
                    }
                } else if detail == nil {
                    // Surface a real failure instead of spinning forever:
                    // if the detail load errored we show a retry, otherwise
                    // we're still genuinely loading.
                    if let error {
                        ErrorStateView(message: error) {
                            Task { await retryCourtLoad() }
                        }
                        .frame(height: 240)
                    } else {
                        LoadingView().frame(height: 200)
                    }
                } else {
                    EmptyStateView(
                        icon: "sportscourt",
                        title: String(localized: "book.empty.courts.title"),
                        message: String(localized: "book.empty.courts.message")
                    )
                    .frame(height: 240)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
        }
    }

    private func venueHeader(_ v: Venue) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(v.name)
                .font(.system(size: 22, weight: .heavy, design: .default))
                .foregroundStyle(DSColor.textPrimary)
            
            HStack(spacing: 4) {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(DSColor.textSecondary)
                Text(v.address)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
            }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 4)
    }

    private func courtRow(_ c: Court, selected: Bool) -> some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(DSColor.surfaceElevated)
                    .frame(width: 52, height: 52)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(DSColor.border, lineWidth: 1)
                    )
                Image(systemName: "sportscourt.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(DSColor.accent)
            }
            .accessibilityHidden(true)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(c.name)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                
                HStack(spacing: 6) {
                    let sportName = c.sport_slug == "padel" ? String(localized: "sport.padel") : c.sport_slug.capitalized
                    Text(sportName)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(DSColor.textSecondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(DSColor.surfaceElevated))
                }
            }
            
            Spacer()
            
            VStack(alignment: .trailing, spacing: 4) {
                Text(priceLabel(c))
                    .font(.system(size: 18, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                Text("book.per_hour")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(DSColor.textTertiary)
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(selected ? DSColor.accent : DSColor.border, lineWidth: selected ? 1.5 : 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityHint(Text("a11y.court_tile.hint"))
    }

    // MARK: - 3) Slot + confirm

    private static let slotStartHour = 9
    private static let slotEndHour = 22  // exclusive — last slot is 21:30
    private static let slotStepMinutes = 30

    private static let slotMinutesOfDay: [Int] = {
        var out: [Int] = []
        let start = BookCourtView.slotStartHour * 60
        let end = BookCourtView.slotEndHour * 60
        var t = start
        while t < end {
            out.append(t)
            t += BookCourtView.slotStepMinutes
        }
        return out
    }()

    private var pickableDays: [Date] {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        return (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: today) }
    }

    private var startsAt: Date? {
        guard let mins = selectedSlotMinute else { return nil }
        let cal = Calendar.current
        var comps = cal.dateComponents([.year, .month, .day], from: selectedDate)
        comps.hour = mins / 60
        comps.minute = mins % 60
        return cal.date(from: comps)
    }

    private func filterPastSlotsIfNeeded(_ slots: [Int]) -> [Int] {
        if Calendar.current.isDateInToday(selectedDate) {
            let now = Date()
            let cal = Calendar.current
            let comps = cal.dateComponents([.hour, .minute], from: now)
            let nowMins = (comps.hour ?? 0) * 60 + (comps.minute ?? 0)
            return slots.filter { $0 > nowMins }
        }
        return slots
    }

    private var morningSlots: [Int] {
        let base = Self.slotMinutesOfDay.filter { $0 < 12 * 60 }
        return filterPastSlotsIfNeeded(base)
    }

    private var afternoonSlots: [Int] {
        let base = Self.slotMinutesOfDay.filter { $0 >= 12 * 60 && $0 < 17 * 60 }
        return filterPastSlotsIfNeeded(base)
    }

    private var eveningSlots: [Int] {
        let base = Self.slotMinutesOfDay.filter { $0 >= 17 * 60 }
        return filterPastSlotsIfNeeded(base)
    }

    private var slotStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let v = venue, let c = court {
                    summaryCard(v, c)
                }

                // Date selection
                VStack(alignment: .leading, spacing: 12) {
                    sectionLabel("book.section.when")
                    dayPickerRow
                }

                // Bucket selection
                VStack(alignment: .leading, spacing: 20) {
                    slotGridHeader

                    if morningSlots.isEmpty && afternoonSlots.isEmpty && eveningSlots.isEmpty {
                        // No bookable slots remain for the chosen day (e.g.
                        // late in the evening on "today"). Show an inline
                        // empty state instead of a blank gap under the header.
                        emptySlotsState
                    } else {
                        if !morningSlots.isEmpty {
                            bucketedSlotSection(
                                title: String(localized: "book.bucket.morning"),
                                icon: "sun.max.fill",
                                minutes: morningSlots
                            )
                        }

                        if !afternoonSlots.isEmpty {
                            bucketedSlotSection(
                                title: String(localized: "book.bucket.afternoon"),
                                icon: "sun.horizon.fill",
                                minutes: afternoonSlots
                            )
                        }

                        if !eveningSlots.isEmpty {
                            bucketedSlotSection(
                                title: String(localized: "book.bucket.evening"),
                                icon: "moon.stars.fill",
                                minutes: eveningSlots
                            )
                        }
                    }
                }

                // Duration selection
                VStack(alignment: .leading, spacing: 12) {
                    sectionLabel("book.section.duration")
                    HStack(spacing: 8) {
                        ForEach([60, 90, 120], id: \.self) { mins in
                            durationChip(mins)
                        }
                    }
                }

                if let error {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.circle.fill")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(DSColor.danger)
                            Text(error)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(DSColor.danger)
                        }
                        // A conflict can't be retried as-is — the user has to
                        // pick another time, so the retry CTA only renders for
                        // transient/server failures where re-sending can work.
                        if !errorIsConflict {
                            Button {
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                confirm()
                            } label: {
                                Text("common.retry")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(DSColor.danger)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(Capsule().fill(DSColor.danger.opacity(0.12)))
                            }
                            .buttonStyle(.plain)
                            .disabled(isConfirming)
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 14).fill(DSColor.danger.opacity(0.08)))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(DSColor.danger.opacity(0.16), lineWidth: 1))
                }

                totalSection

                Spacer().frame(height: 12)

                confirmButton
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
        }
        .task(id: selectedDate) { await loadAvailability() }
    }

    // MARK: Day pills

    private var dayPickerRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(pickableDays, id: \.self) { day in
                    dayPill(day)
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func dayPill(_ day: Date) -> some View {
        let cal = Calendar.current
        let selected = cal.isDate(day, inSameDayAs: selectedDate)
        let isToday = cal.isDateInToday(day)

        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
            selectedDate = day
            selectedSlotMinute = nil
            resetAttemptState()
        } label: {
            VStack(spacing: 6) {
                Text(weekdayShort(day))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(selected ? DSColor.textOnAccent.opacity(0.8) : DSColor.textSecondary)
                Text(dayOfMonth(day))
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
                
                if isToday {
                    Circle()
                        .fill(selected ? DSColor.textOnAccent : DSColor.accent)
                        .frame(width: 4, height: 4)
                } else {
                    Spacer().frame(height: 4)
                }
            }
            .frame(width: 58, height: 78)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(selected ? DSColor.accent : DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(selected ? DSColor.accent : DSColor.border, lineWidth: 1)
            )
            .shadow(color: DSColor.inkSurface.opacity(selected ? 0.08 : 0), radius: 6, x: 0, y: 3)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(accessibleDay(day)))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: Slot grid

    private var slotGridHeader: some View {
        HStack {
            sectionLabel("book.slot.title")
            Spacer()
            HStack(spacing: 8) {
                slotLegendDot(color: DSColor.surfaceElevated, borderColor: DSColor.border)
                Text("book.slot.empty")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(DSColor.textSecondary)
                slotLegendDot(color: DSColor.accent, borderColor: DSColor.accent)
                Text("book.slot.selected")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(DSColor.textSecondary)
                slotLegendDot(color: DSColor.surfaceElevated.opacity(0.4), borderColor: DSColor.border.opacity(0.3))
                Text("book.slot.booked")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(DSColor.textSecondary)
            }
        }
    }

    /// Inline "no times left for this day" state, shown when every bucket
    /// is empty. Kept lightweight (icon + copy, no card) so it doesn't nest
    /// a card inside the slot section per FAZA 45 layout rules.
    private var emptySlotsState: some View {
        VStack(spacing: 10) {
            Image(systemName: "clock.badge.xmark")
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(DSColor.textTertiary)
            Text("book.slot.none.title")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(DSColor.textPrimary)
            Text("book.slot.none.message")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
    }

    private func slotLegendDot(color: Color, borderColor: Color) -> some View {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(color)
            .frame(width: 12, height: 12)
            .overlay(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .strokeBorder(borderColor, lineWidth: 1)
            )
    }

    private func bucketedSlotSection(title: String, icon: String, minutes: [Int]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(DSColor.accent)
                Text(title)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
            }
            .padding(.horizontal, 4)
            
            let columns = [GridItem](
                repeating: GridItem(.flexible(), spacing: 8),
                count: 3
            )
            
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(minutes, id: \.self) { mins in
                    slotCard(forMinute: mins)
                }
            }
        }
    }

    private func slotCard(forMinute mins: Int) -> some View {
        let state = slotState(for: mins)
        let disabled = state != .available && state != .selected
        let isSelected = state == .selected
        
        return Button {
            guard state == .available || state == .selected else { return }
            UISelectionFeedbackGenerator().selectionChanged()
            if selectedSlotMinute == mins {
                selectedSlotMinute = nil
            } else {
                selectedSlotMinute = mins
            }
            resetAttemptState()
        } label: {
            VStack(spacing: 4) {
                Text(formatHHmm(mins))
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(slotForeground(state))
                
                if state == .booked {
                    Text("book.slot.booked")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(DSColor.textTertiary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(slotBackground(state))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(slotBorder(state), lineWidth: isSelected ? 1.5 : 1)
            )
            .opacity(state == .past ? 0.35 : 1)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(Text(accessibleSlot(mins, state: state)))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    // MARK: Slot state machine

    private enum SlotState { case available, selected, booked, past }

    private func slotState(for mins: Int) -> SlotState {
        if selectedSlotMinute == mins { return .selected }
        if bookedSlotMinutes.contains(mins) { return .booked }
        if Calendar.current.isDateInToday(selectedDate) {
            let now = Date()
            let cal = Calendar.current
            let comps = cal.dateComponents([.hour, .minute], from: now)
            let nowMins = (comps.hour ?? 0) * 60 + (comps.minute ?? 0)
            if mins <= nowMins { return .past }
        }
        // A start time that can't fit the chosen duration before closing
        // (slotEndHour) isn't bookable — disable it like a past slot so a
        // 21:30 + 120min booking can't run past 22:00.
        if mins + durationMinutes > Self.slotEndHour * 60 { return .past }
        return .available
    }

    private func slotBackground(_ state: SlotState) -> Color {
        switch state {
        case .available: return DSColor.surface
        case .selected: return DSColor.accent
        case .booked: return DSColor.surfaceElevated.opacity(0.4)
        case .past: return Color.clear
        }
    }

    private func slotForeground(_ state: SlotState) -> Color {
        switch state {
        case .available: return DSColor.textPrimary
        case .selected: return DSColor.textOnAccent
        case .booked, .past: return DSColor.textTertiary
        }
    }

    private func slotBorder(_ state: SlotState) -> Color {
        switch state {
        case .available: return DSColor.border
        case .selected: return DSColor.accent
        case .booked: return DSColor.border.opacity(0.3)
        case .past: return DSColor.border.opacity(0.2)
        }
    }

    // MARK: Availability

    private func loadAvailability() async {
        guard let c = court else {
            bookedSlotMinutes = []
            return
        }
        // Pin the formatter to a fixed locale + calendar so the query date
        // is always a clean Gregorian "yyyy-MM-dd". Without en_US_POSIX a
        // user on a non-Gregorian calendar (or a 12-hour locale quirk) can
        // produce a date string the API can't parse.
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.calendar = Calendar(identifier: .gregorian)
        fmt.dateFormat = "yyyy-MM-dd"
        let dateStr = fmt.string(from: selectedDate)
        
        do {
            let res = try await container.apiClient.send(.courtAvailability(courtId: c.id, date: dateStr))
            let booked = res.slots
                .filter(\.isBooked)
                .map(\.minutes_from_midnight)
            bookedSlotMinutes = Set(booked)
            // The user's selection may have been taken while they were
            // looking at the grid — drop it rather than let them confirm
            // a slot we already know is gone.
            if let mins = selectedSlotMinute, bookedSlotMinutes.contains(mins) {
                selectedSlotMinute = nil
            }
        } catch is CancellationError {
            return
        } catch {
            // Availability is advisory — the server still rejects real
            // conflicts at POST time with 409, so on failure we render the
            // grid optimistically instead of blocking the flow.
            bookedSlotMinutes = []
        }
    }

    // MARK: Slot formatting helpers

    private func formatHHmm(_ minutesOfDay: Int) -> String {
        String(format: "%02d:%02d", minutesOfDay / 60, minutesOfDay % 60)
    }

    private func weekdayShort(_ day: Date) -> String {
        let fmt = DateFormatter()
        fmt.locale = Locale.current
        fmt.dateFormat = "EEE"
        return fmt.string(from: day)
    }

    private func dayOfMonth(_ day: Date) -> String {
        let fmt = DateFormatter()
        fmt.locale = Locale.current
        fmt.dateFormat = "d"
        return fmt.string(from: day)
    }

    private func accessibleDay(_ day: Date) -> String {
        let fmt = DateFormatter()
        fmt.locale = Locale.current
        fmt.dateStyle = .full
        return fmt.string(from: day)
    }

    private func accessibleSlot(_ mins: Int, state: SlotState) -> String {
        let hhmm = formatHHmm(mins)
        switch state {
        case .available: return "\(hhmm) — \(String(localized: "book.slot.empty"))"
        case .selected: return "\(hhmm) — \(String(localized: "book.slot.selected"))"
        case .booked: return "\(hhmm) — \(String(localized: "book.slot.booked"))"
        case .past: return hhmm
        }
    }

    private func summaryCard(_ v: Venue, _ c: Court) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.08))
                    .frame(width: 44, height: 44)
                Image(systemName: "sportscourt.fill")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(DSColor.accent)
            }
            
            VStack(alignment: .leading, spacing: 4) {
                Text(v.name)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                
                HStack(spacing: 4) {
                    Image(systemName: "building.2")
                        .font(.system(size: 11))
                        .foregroundStyle(DSColor.textSecondary)
                    Text(c.name)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
            
            Spacer()
            
            VStack(alignment: .trailing, spacing: 4) {
                Text(priceLabel(c))
                    .font(.system(size: 16, weight: .heavy))
                    .foregroundStyle(DSColor.accent)
                Text("book.per_hour")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(DSColor.textTertiary)
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.surface)
                .shadow(color: DSColor.inkSurface.opacity(0.015), radius: 8, x: 0, y: 4)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
    }

    /// Total for the chosen duration plus the pay-at-venue notice.
    /// There is no online payment in Azerbaijan yet — the user pays at the
    /// club — so the flow must say that plainly before Confirm.
    private var totalSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("book.total")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(DSColor.textSecondary)
                Spacer()
                Text(totalPriceLabel)
                    .font(.system(size: 18, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
            }

            Divider().overlay(DSColor.border)

            HStack(spacing: 8) {
                Image(systemName: "banknote")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DSColor.info)
                VStack(alignment: .leading, spacing: 2) {
                    Text("book.pay_at_venue")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(DSColor.textPrimary)
                    Text("book.pay_at_venue.note")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
    }

    /// Total for the selected duration, derived from the court's hourly
    /// rate exactly the way the backend prices the booking.
    private var totalPriceLabel: String {
        guard let c = court else { return "" }
        return formatPrice(c.hourly_price_minor * durationMinutes / 60, c.currency)
    }

    /// A change to date / slot / duration makes the previous attempt's
    /// error stale AND changes the payload — so the idempotency key must
    /// be re-minted (the old key is bound to the old payload server-side).
    private func resetAttemptState() {
        error = nil
        errorIsConflict = false
        idempotencyKey = UUID().uuidString
    }

    private func sectionLabel(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(DSColor.textSecondary)
            .padding(.horizontal, 4)
    }

    private func durationChip(_ mins: Int) -> some View {
        let selected = durationMinutes == mins
        let a11yKey: LocalizedStringKey = {
            switch mins {
            case 60: return "book.duration.60"
            case 90: return "book.duration.90"
            case 120: return "book.duration.120"
            default: return "book.duration.min_abbrev"
            }
        }()
        
        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
            durationMinutes = mins
            // Drop an already-picked slot that this longer duration would
            // push past closing time, so the user re-picks a valid start.
            if let s = selectedSlotMinute, s + durationMinutes > Self.slotEndHour * 60 {
                selectedSlotMinute = nil
            }
            resetAttemptState()
        } label: {
            VStack(spacing: 4) {
                Text("\(mins)")
                    .font(.system(size: 18, weight: .bold))
                Text("book.duration.min_abbrev")
                    .font(.system(size: 11, weight: .bold))
            }
            .frame(maxWidth: .infinity, minHeight: 60)
            .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(selected ? DSColor.accent : DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(selected ? DSColor.accent : DSColor.border, lineWidth: 1)
            )
            .shadow(color: DSColor.inkSurface.opacity(selected ? 0.08 : 0), radius: 6, x: 0, y: 3)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(a11yKey))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityHint(Text("a11y.duration.hint"))
    }

    private var confirmButton: some View {
        let ready = startsAt != nil
        return Button {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            confirm()
        } label: {
            HStack {
                if isConfirming {
                    ProgressView().tint(DSColor.textOnAccent)
                } else {
                    Text(confirmTitle)
                        .font(.system(size: 16, weight: .bold))
                }
            }
            .foregroundStyle(DSColor.textOnAccent)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(ready ? DSColor.accent : DSColor.accent.opacity(0.4))
            )
        }
        .buttonStyle(SpringPressStyle())
        .disabled(isConfirming || !ready)
    }

    private var confirmTitle: String {
        guard let c = court else { return String(localized: "book.confirm") }
        let total = c.hourly_price_minor * durationMinutes / 60
        return String(format: String(localized: "book.confirm.total_format"),
                      formatPrice(total, c.currency))
    }

    // MARK: - Success

    private var successCard: some View {
        VStack(spacing: 24) {
            Spacer()
            
            // Checkmark with infinite pulsing halo behind it
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.12))
                    .frame(width: 96, height: 96)
                    .scaleEffect(pulseScale)
                    .animation(
                        reduceMotion ? .none : .easeInOut(duration: 1.5).repeatForever(autoreverses: true),
                        value: pulseScale
                    )
                
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 54, weight: .bold))
                    .foregroundStyle(DSColor.accent)
            }
            .onAppear {
                if !reduceMotion {
                    pulseScale = 1.15
                }
            }
            
            VStack(spacing: 8) {
                Text("book.confirmed.title")
                    .font(.system(size: 24, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                Text("book.confirmed.subtitle")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)

            // Glossy QR Confirmation Code Frame
            if let booking = confirmedBooking {
                VStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .fill(DSColor.surface)
                            .frame(width: 236, height: 236)
                            .overlay(
                                RoundedRectangle(cornerRadius: 24, style: .continuous)
                                    .strokeBorder(DSColor.border, lineWidth: 1)
                            )
                        
                        BookingQRCodeView(content: "linkfit://booking/\(booking.id)", size: 196)
                            .cornerRadius(16)
                    }
                    
                    Text("book.qr.hint")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DSColor.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 16)
            }

            if let v = venue, let c = court {
                summaryCard(v, c)
                    .padding(.horizontal, 16)
            }

            // Honest payment line: there is no online payment — the user
            // settles the booking total at the club's front desk.
            if let booking = confirmedBooking {
                HStack(spacing: 8) {
                    Image(systemName: "banknote")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DSColor.info)
                    Text("book.pay_at_venue")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(DSColor.textPrimary)
                    Spacer()
                    Text(formatPrice(booking.total_minor, booking.currency))
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                }
                .padding(14)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(DSColor.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(DSColor.border, lineWidth: 1)
                )
                .padding(.horizontal, 16)
            }

            Spacer()

            // Dynamic checkout buttons
            VStack(spacing: 10) {
                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    showMyBookings = true
                } label: {
                    Text("book.see_my_bookings")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(DSColor.textOnAccent)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.accent))
                }
                .buttonStyle(SpringPressStyle())

                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    dismiss()
                } label: {
                    Text("common.done")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(DSColor.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(SpringPressStyle())
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - State transitions

    private func backOrClose() {
        if confirmed { dismiss(); return }
        switch step {
        case .venue: dismiss()
        case .court:
            if presetVenueId != nil { dismiss(); return }
            withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.8)) {
                step = .venue
                court = nil
            }
        case .slot:
            if presetCourtId != nil {
                if presetVenueId != nil { dismiss(); return }
                withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.8)) {
                    step = .venue
                    court = nil
                }
                return
            }
            withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.8)) {
                step = .court
            }
        }
    }

    private func select(venue v: Venue) {
        venue = v
        // Advance to the court step immediately and load its detail there.
        // The court step renders LoadingView while detail == nil, and an
        // ErrorStateView (with retry) if the load fails — so we no longer
        // strand the user on the venue step when the detail call errors.
        detail = nil
        court = nil
        error = nil
        withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.8)) {
            step = .court
        }
        Task { await loadVenueDetail(for: v) }
    }

    /// Load a venue's detail and seed `detail` / `court`. On failure we
    /// set `error`, which the court step reads to render its retry state.
    private func loadVenueDetail(for v: Venue) async {
        do {
            let d = try await container.apiClient.send(.venue(id: v.id))
            detail = d
            court = d.courts.count == 1 ? d.courts.first : nil
        } catch is CancellationError {
            return
        } catch let e as APIError {
            error = e.errorDescription
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func select(court c: Court) {
        court = c
        withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.8)) {
            step = .slot
        }
    }

    private func confirm() {
        guard !isConfirming, let c = court else { return }
        guard let when = startsAt else {
            error = String(localized: "book.error.no_slot")
            return
        }
        guard when > Date() else {
            error = String(localized: "book.error.past_time")
            return
        }
        error = nil
        errorIsConflict = false
        isConfirming = true
        let body = CreateBookingBody(
            court_id: c.id,
            starts_at: when.toISO(),
            duration_minutes: durationMinutes,
            idempotency_key: idempotencyKey
        )
        Task {
            defer { isConfirming = false }
            do {
                let booking = try await container.apiClient.send(.createBooking(body))
                confirmedBooking = booking
                confirmed = true
                // The key has been consumed by a successful create — mint a
                // fresh one so a hypothetical second booking in the same
                // session isn't swallowed by server-side idempotency.
                idempotencyKey = UUID().uuidString
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } catch is CancellationError {
                return
            } catch let e as APIError where Self.isSlotConflict(e) {
                // The slot was booked by someone else between grid load and
                // Confirm. Tell the user, drop the stale selection, and
                // refresh the grid so the now-taken slot renders as booked.
                error = String(localized: "book.error.slot_conflict")
                errorIsConflict = true
                selectedSlotMinute = nil
                // The conflicted payload is dead — the next attempt is a new
                // logical booking, so it needs a new idempotency key.
                idempotencyKey = UUID().uuidString
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                await loadAvailability()
            } catch let e as APIError {
                error = e.localizedMessage
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            } catch {
                self.error = String(localized: "book.error.generic")
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            }
        }
    }

    /// Whether `error` is the backend's "someone already booked this slot"
    /// rejection: HTTP 409, surfaced either as a generic CONFLICT envelope
    /// or with the dedicated `slot_conflict` code.
    private static func isSlotConflict(_ error: APIError) -> Bool {
        switch error {
        case .conflict:
            return true
        case .server(let status, let code, _):
            return status == 409 || code?.lowercased() == "slot_conflict"
        default:
            return false
        }
    }

    private func loadVenues() async {
        guard case .loaded = venuesState else {
            venuesState = .loading
            do {
                let res = try await container.apiClient.send(.venues(sport: "padel"))
                venuesState = res.items.isEmpty ? .empty : .loaded(res.items)
            } catch let e as APIError {
                venuesState = .error(message: e.errorDescription ?? "")
            } catch {
                venuesState = .error(message: error.localizedDescription)
            }
            return
        }
    }

    // MARK: - Format helpers

    private func priceLabel(_ c: Court) -> String {
        formatPrice(c.hourly_price_minor, c.currency)
    }

    private func formatPrice(_ minor: Int, _ currency: String) -> String {
        // Route every price in this view through the single Money formatter
        // so manat renders as ₼ with lossless qəpik and a locale-correct
        // decimal separator (was the divergent BookingPriceFormatter).
        Money.format(minor: minor, currency: currency)
    }
}
