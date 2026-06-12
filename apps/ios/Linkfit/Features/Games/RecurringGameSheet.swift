import SwiftUI
import CoreLocation
import Observation

/// Sheet-based flow for scheduling a *series* of games — e.g. "every
/// Tuesday 19:00 at Padel Center for 8 weeks". A distinct surface from
/// CreateGameView so the one-off flow stays unchanged; the host opens
/// this from the new "Make recurring" entry point on the Games tab.
struct RecurringGameSheet: View {
    @State var viewModel: RecurringGameViewModel
    var onCreated: (GameSeriesDetail) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()

            // After a successful create, the form is swapped out for a
            // success card so the user gets a clean "12 games scheduled"
            // moment instead of a half-reset form.
            if let created = viewModel.createdSeries {
                successCard(for: created)
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .scale(scale: 0.96)),
                        removal: .opacity))
            } else {
                form
                    .transition(.opacity)
            }
        }
        .task { await viewModel.onAppear() }
        .animation(.spring(response: 0.45, dampingFraction: 0.85),
                   value: viewModel.createdSeries?.id)
    }

    // MARK: - Form

    private var form: some View {
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.lg) {
                    header
                    sportSection
                    scheduleSection
                    durationCapacitySection
                    weeksSection
                    Spacer().frame(height: 120)
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.md)
            }
            .scrollDismissesKeyboard(.interactively)

            submitBar
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            HStack {
                Text("recurring.title")
                    .font(.system(size: 28, weight: .heavy, design: .rounded))
                    .foregroundStyle(DSColor.textPrimary)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(DSColor.textPrimary)
                        .frame(width: 38, height: 38)
                        .background(Circle().fill(DSColor.surfaceElevated))
                }
                .buttonStyle(.plain)
            }
            Text("recurring.subtitle")
                .font(DSType.bodyEmphasis)
                .foregroundStyle(DSColor.textSecondary)
        }
    }

    private var sportSection: some View {
        section(title: String(localized: "recurring.section.sport")) {
            if viewModel.sports.isEmpty {
                Text("recurring.loading")
                    .font(DSType.footnote)
                    .foregroundStyle(DSColor.textSecondary)
            } else {
                HStack(spacing: DSSpacing.sm) {
                    ForEach(viewModel.sports) { sport in
                        sportPill(sport)
                    }
                }
            }
        }
    }

    private func sportPill(_ sport: Sport) -> some View {
        let selected = viewModel.selectedSport?.id == sport.id
        return Button {
            viewModel.selectSport(sport)
            UISelectionFeedbackGenerator().selectionChanged()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: sport.slug == "padel" ? "figure.tennis" : "sportscourt")
                    .foregroundStyle(selected ? DSColor.limeInk : DSColor.textPrimary)
                Text(sport.name)
                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
                    .foregroundStyle(selected ? DSColor.limeInk : DSColor.textPrimary)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.vertical, 10)
            .background(Capsule().fill(selected ? DSColor.lime : DSColor.surface))
            .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: selected ? 0 : 1))
        }
        .buttonStyle(.plain)
    }

    private var scheduleSection: some View {
        section(title: String(localized: "recurring.section.schedule")) {
            VStack(spacing: DSSpacing.sm) {
                dayOfWeekRow
                timeRow
            }
        }
    }

    private var dayOfWeekRow: some View {
        HStack(spacing: 6) {
            ForEach(0..<7, id: \.self) { day in
                let selected = viewModel.dayOfWeek == day
                Button {
                    viewModel.dayOfWeek = day
                    UISelectionFeedbackGenerator().selectionChanged()
                } label: {
                    Text(weekdayShortLabel(day))
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(selected ? DSColor.limeInk : DSColor.textPrimary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(selected ? DSColor.lime : DSColor.surface)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(DSColor.border, lineWidth: selected ? 0 : 1)
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var timeRow: some View {
        HStack {
            Label {
                Text("recurring.time_of_day")
                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
            } icon: {
                Image(systemName: "clock")
                    .foregroundStyle(DSColor.accent)
            }
            Spacer()
            DatePicker("", selection: $viewModel.timeOfDay,
                       displayedComponents: .hourAndMinute)
                .labelsHidden()
                .tint(DSColor.accent)
        }
        .padding(DSSpacing.md)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
    }

    private var durationCapacitySection: some View {
        section(title: String(localized: "recurring.section.duration_capacity")) {
            VStack(spacing: DSSpacing.sm) {
                durationRow
                capacityRow
            }
        }
    }

    private var durationRow: some View {
        HStack {
            Text("recurring.duration")
                .font(.system(.subheadline, design: .rounded))
                .foregroundStyle(DSColor.textSecondary)
            Spacer()
            HStack(spacing: 6) {
                ForEach([60, 75, 90, 120], id: \.self) { mins in
                    let selected = viewModel.durationMinutes == mins
                    Button {
                        viewModel.durationMinutes = mins
                    } label: {
                        Text(String(format: String(localized: "recurring.duration.minutes_format"), mins))
                            .font(.system(.footnote, design: .rounded, weight: .semibold))
                            .foregroundStyle(selected ? DSColor.limeInk : DSColor.textPrimary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Capsule().fill(selected ? DSColor.lime : DSColor.surface))
                            .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: selected ? 0 : 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(DSSpacing.md)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
    }

    private var capacityRow: some View {
        HStack {
            Text("recurring.capacity")
                .font(.system(.subheadline, design: .rounded))
                .foregroundStyle(DSColor.textSecondary)
            Spacer()
            Text(String(format: String(localized: "recurring.capacity.players_format"), viewModel.capacity))
                .font(.system(.title3, design: .rounded, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
            Stepper("", value: $viewModel.capacity,
                    in: (viewModel.selectedSport?.min_players ?? 2)...(viewModel.selectedSport?.max_players ?? 12))
                .labelsHidden()
        }
        .padding(DSSpacing.md)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
    }

    private var weeksSection: some View {
        section(title: String(localized: "recurring.section.weeks")) {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                HStack {
                    Text(String(format: String(localized: "recurring.weeks.count_format"), viewModel.weeks))
                        .font(.system(.title3, design: .rounded, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                    Spacer()
                    Stepper("", value: $viewModel.weeks, in: 1...12)
                        .labelsHidden()
                }
                // Visual week-pill row so the host sees "8 dots" at a glance.
                HStack(spacing: 5) {
                    ForEach(0..<12, id: \.self) { i in
                        let filled = i < viewModel.weeks
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(filled ? DSColor.accent : DSColor.border)
                            .frame(height: 10)
                    }
                }
                Text("recurring.weeks.helper")
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(DSColor.textSecondary)
            }
            .padding(DSSpacing.md)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
        }
    }

    private var submitBar: some View {
        VStack(spacing: 0) {
            if let err = viewModel.formError {
                Text(err)
                    .font(DSType.footnote)
                    .foregroundStyle(DSColor.danger)
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.bottom, DSSpacing.xs)
            }
            PrimaryAuthButton(
                titleKey: "recurring.submit",
                isLoading: viewModel.isSubmitting,
                isEnabled: viewModel.canSubmit
            ) {
                Task { await viewModel.submit() }
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.bottom, DSSpacing.md)
        }
        .background(
            LinearGradient(colors: [DSColor.background.opacity(0), DSColor.background],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 140)
                .allowsHitTesting(false),
            alignment: .bottom
        )
    }

    // MARK: - Success card

    private func successCard(for series: GameSeriesDetail) -> some View {
        VStack(spacing: DSSpacing.lg) {
            Spacer()
            ZStack {
                Circle()
                    .fill(DSColor.lime.opacity(0.18))
                    .frame(width: 130, height: 130)
                Image(systemName: "calendar.badge.checkmark")
                    .font(.system(size: 56, weight: .bold))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(spacing: DSSpacing.xs) {
                Text(String(format: String(localized: "recurring.success.count_format"), series.games.count))
                    .font(.system(size: 32, weight: .heavy, design: .rounded))
                    .foregroundStyle(DSColor.textPrimary)
                Text("recurring.success.subtitle")
                    .font(DSType.bodyEmphasis)
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, DSSpacing.lg)

            VStack(alignment: .leading, spacing: 6) {
                ForEach(series.games.prefix(3)) { g in
                    HStack {
                        Image(systemName: "calendar")
                            .foregroundStyle(DSColor.accent)
                        Text(formatted(starts_at: g.starts_at))
                            .font(.system(.subheadline, design: .rounded, weight: .semibold))
                            .foregroundStyle(DSColor.textPrimary)
                    }
                }
                if series.games.count > 3 {
                    Text(String(format: String(localized: "recurring.success.and_more_format"),
                                series.games.count - 3))
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
            .padding(DSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
            .padding(.horizontal, DSSpacing.md)

            Spacer()

            VStack(spacing: DSSpacing.sm) {
                PrimaryAuthButton(
                    titleKey: "recurring.success.view_games",
                    isLoading: false,
                    isEnabled: true
                ) {
                    onCreated(series)
                    dismiss()
                }
                Button {
                    dismiss()
                } label: {
                    Text("recurring.success.dismiss")
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .foregroundStyle(DSColor.textSecondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.bottom, DSSpacing.lg)
        }
    }

    // MARK: - Helpers

    private func section<C: View>(title: String,
                                  @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text(title.uppercased())
                .font(.system(.caption, design: .rounded, weight: .semibold))
                .foregroundStyle(DSColor.textSecondary)
            content()
        }
    }

    /// Three-letter weekday abbreviation honouring the user's locale.
    /// Postgres EXTRACT(DOW) puts Sunday at 0; Foundation calendar maps
    /// `Calendar.shortWeekdaySymbols[0]` to Sunday too.
    private func weekdayShortLabel(_ day: Int) -> String {
        let cal = Calendar.current
        let symbols = cal.shortWeekdaySymbols
        let safe = max(0, min(symbols.count - 1, day))
        return symbols[safe].uppercased()
    }

    private func formatted(starts_at: String) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = iso.date(from: starts_at) ?? ISO8601DateFormatter().date(from: starts_at)
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: date ?? Date())
    }
}

// MARK: - ViewModel

@Observable
@MainActor
final class RecurringGameViewModel {
    private(set) var sports: [Sport] = []
    var selectedSport: Sport?
    var dayOfWeek: Int = 2 // Tuesday — matches the brief's example.
    /// Picked time of day. Only the hour+minute components are sent; we
    /// keep a full Date in state so the SwiftUI DatePicker is happy.
    var timeOfDay: Date = {
        let cal = Calendar.current
        return cal.date(bySettingHour: 19, minute: 0, second: 0, of: Date()) ?? Date()
    }()
    var durationMinutes: Int = 90
    var capacity: Int = 4
    var weeks: Int = 8
    var coordinate: CLLocationCoordinate2D = .init(latitude: 40.4093, longitude: 49.8671)
    var courtId: String?

    var formError: String?
    var isSubmitting = false
    var createdSeries: GameSeriesDetail?

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func onAppear() async {
        do {
            sports = try await apiClient.send(.sports).items
                .filter { $0.slug != "football_5" && $0.slug != "football" }
            if selectedSport == nil {
                selectedSport = sports.first(where: { $0.slug == "padel" }) ?? sports.first
            }
            if let s = selectedSport {
                capacity = min(max(capacity, s.min_players), s.max_players)
            }
        } catch {
            sports = []
        }
    }

    func selectSport(_ sport: Sport) {
        selectedSport = sport
        capacity = min(max(capacity, sport.min_players), sport.max_players)
    }

    var canSubmit: Bool {
        selectedSport != nil && !isSubmitting && weeks >= 1
    }

    func submit() async {
        guard let sport = selectedSport else { return }
        formError = nil
        isSubmitting = true
        defer { isSubmitting = false }

        let comps = Calendar.current.dateComponents([.hour, .minute], from: timeOfDay)
        let hour = comps.hour ?? 19
        let minute = comps.minute ?? 0
        let timeString = String(format: "%02d:%02d", hour, minute)

        let body = CreateGameSeriesBody(
            sport_id: sport.id,
            court_id: courtId,
            lat: coordinate.latitude,
            lng: coordinate.longitude,
            day_of_week: dayOfWeek,
            time_of_day: timeString,
            duration_minutes: durationMinutes,
            capacity: capacity,
            occurrences: weeks,
            starts_on: nil,
            notes: nil
        )

        do {
            let series = try await apiClient.send(.createGameSeries(body))
            createdSeries = series
        } catch {
            formError = String(localized: "recurring.error.generic")
        }
    }
}
