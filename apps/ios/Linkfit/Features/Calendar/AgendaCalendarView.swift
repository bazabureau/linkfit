import SwiftUI

/// In-app monthly calendar.
///
/// Renders a 7-column × 5-or-6-row month grid with a lime dot under any day
/// that has games / bookings / tournaments, and a lime ring around today.
/// Tapping a day pops a `DayDetailSheet` listing that day's items.
///
/// The view is intentionally a pure SwiftUI calendar — no third-party deps.
/// It owns its own month navigation (header arrows + horizontal swipe + a
/// "Today" jump button). Display strings (month name, weekday short labels)
/// derive from the locale supplied by `LanguageManager`.
struct AgendaCalendarView: View {
    @State var viewModel: AgendaCalendarViewModel
    @Environment(LanguageManager.self) private var lang

    /// Detail-sheet driver — non-nil while presented.
    @State private var selectedDay: SelectedDay?
    /// Drag offset for the horizontal swipe-to-change-month gesture. Reset to
    /// 0 once the gesture ends and we've committed to a step.
    @State private var dragOffset: CGFloat = 0

    /// Cached 42-cell month grid. Recomputed only when `monthAnchor` changes
    /// (or the display locale shifts), not on every body render — the
    /// `Calendar` math behind it is the same for the life of a month view.
    @State private var monthCells: [Date] = []
    /// Cached per-day items bucket keyed by the cell's display `Date`. Built
    /// alongside `monthCells` so the grid can look up "has item?" in O(1)
    /// without calling into the view model for each of the 42 cells on
    /// every redraw.
    @State private var itemsByDay: [Date: [AgendaItem]] = [:]

    /// Per-kind tap callbacks. Defaulted to no-ops so the view can be hosted
    /// in any shell — the parent wires real navigation if it wants it.
    var onTapGame: (AgendaItem) -> Void = { _ in }
    var onTapBooking: (AgendaItem) -> Void = { _ in }
    var onTapTournament: (AgendaItem) -> Void = { _ in }

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                weekdayHeader
                content
            }
        }
        .navigationTitle("calendar.title")
        .navigationBarTitleDisplayMode(.large)
        .task {
            // Build the 42-cell grid up-front so the first paint already has
            // the chrome — `monthCells` doesn't depend on the agenda payload.
            // The dots fill in once `.onChange(of: viewModel.state)` reacts
            // to the load completing below.
            recomputeMonthCells()
            await viewModel.load()
            // Cover the cold-start case where state was already `.loaded`
            // (cached snapshot) before the `.onChange` observer attached.
            recomputeItemsByDay()
        }
        .refreshable { await viewModel.load() }
        .onChange(of: viewModel.monthAnchor) { _, _ in
            recomputeMonthCells()
            recomputeItemsByDay()
        }
        .onChange(of: viewModel.state) { _, _ in
            // Snapshot changed (loaded/empty/error transition) — re-bucket the
            // items for the cells we already have. monthCells doesn't depend
            // on the agenda payload, so don't recompute it here.
            recomputeItemsByDay()
        }
        .sheet(item: $selectedDay) { sel in
            DayDetailSheet(
                day: sel.date,
                items: viewModel.items(on: sel.date),
                locale: lang.current.locale,
                onTapGame: onTapGame,
                onTapBooking: onTapBooking,
                onTapTournament: onTapTournament
            )
            .environment(lang)
        }
    }

    // MARK: - Header (month label + arrows + today)

    private var header: some View {
        HStack(spacing: DSSpacing.sm) {
            Button { Task { await viewModel.step(-1) } } label: {
                stepperIcon("chevron.left")
            }
            .accessibilityLabel(Text("calendar.previous_month"))

            Text(monthTitle)
                .font(.system(.title2, design: .rounded, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
                .frame(maxWidth: .infinity)

            Button { Task { await viewModel.step(1) } } label: {
                stepperIcon("chevron.right")
            }
            .accessibilityLabel(Text("calendar.next_month"))

            Button { Task { await viewModel.jumpToToday() } } label: {
                Text("calendar.today")
                    .font(.system(.footnote, design: .rounded, weight: .heavy))
                    .foregroundStyle(DSColor.textOnAccent)
                    .padding(.horizontal, DSSpacing.sm)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(DSColor.accent))
            }
            .accessibilityLabel(Text("calendar.today"))
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
    }

    private func stepperIcon(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: 14, weight: .heavy))
            .foregroundStyle(DSColor.textPrimary)
            .frame(width: 36, height: 36)
            .background(Circle().fill(DSColor.surfaceElevated))
            .overlay(Circle().strokeBorder(DSColor.border, lineWidth: 1))
    }

    // MARK: - Weekday labels (Mon Tue Wed…)

    private var weekdayHeader: some View {
        let symbols = orderedWeekdaySymbols()
        return HStack(spacing: 0) {
            ForEach(Array(symbols.enumerated()), id: \.offset) { _, s in
                // FAZA 45 §13.1: no uppercase + no tracking. Weight + size carry hierarchy.
                Text(s)
                    .font(.system(.caption2, design: .rounded, weight: .heavy))
                    .foregroundStyle(DSColor.textSecondary)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.bottom, DSSpacing.xs)
    }

    // MARK: - Grid content

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            grid(loading: true)
        case .empty:
            // Should be rare — `.empty` only used if you wire the VM to it
            premiumEmptyCard
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.lg)
        case .error(let msg):
            ErrorStateView(message: msg) { Task { await viewModel.load() } }
                .padding(.horizontal, DSSpacing.lg)
        case .loaded(let snap):
            VStack(spacing: DSSpacing.sm) {
                grid(loading: false)
                if snap.isEmpty {
                    emptyHint
                }
            }
        }
    }

    /// The month grid. Rendered for every state so the chrome (weekday header,
    /// 5-6 rows) is stable between loads — only the dots fade in/out.
    ///
    /// Reads from `monthCells` / `itemsByDay` state instead of recomputing on
    /// each body pass; those are refreshed via `.onChange(of: monthAnchor)`
    /// and `.onChange(of: viewModel.state)` upstream.
    private func grid(loading: Bool) -> some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: DSSpacing.xxs), count: 7)
        return LazyVGrid(columns: columns, spacing: DSSpacing.xxs) {
            ForEach(monthCells, id: \.self) { day in
                DayCell(
                    day: day,
                    isInMonth: isInDisplayedMonth(day),
                    isToday: isToday(day),
                    hasItem: !loading && !(itemsByDay[day]?.isEmpty ?? true),
                    locale: lang.current.locale
                )
                .contentShape(Rectangle())
                .onTapGesture {
                    guard isInDisplayedMonth(day) else { return }
                    selectedDay = SelectedDay(date: day)
                }
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .offset(x: dragOffset)
        .gesture(swipeGesture)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: dragOffset)
    }

    private var emptyHint: some View {
        premiumEmptyCard
            .padding(.horizontal, DSSpacing.md)
            .padding(.top, DSSpacing.sm)
    }

    /// Premium-glass empty card matching the design-system pattern used
    /// across Messages / Insights / Streaks — calendar medallion +
    /// heading + supporting line. Renders both for the rare `.empty`
    /// state and the inline "loaded-but-empty" hint below the grid so
    /// users see one consistent motif.
    private var premiumEmptyCard: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.16))
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.4), lineWidth: 1)
                    .frame(width: 72, height: 72)
                Image(systemName: "calendar.badge.plus")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(spacing: 4) {
                Text("calendar.empty.title")
                    .font(.system(size: 17, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                Text("calendar.empty.message")
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .padding(.horizontal, 8)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
        )
    }

    // MARK: - Swipe between months

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 20)
            .onChanged { value in
                // Soft-clamp so the grid feels rubbery, not unbounded.
                dragOffset = value.translation.width / 2
            }
            .onEnded { value in
                let threshold: CGFloat = 60
                if value.translation.width < -threshold {
                    dragOffset = 0
                    Task { await viewModel.step(1) }
                } else if value.translation.width > threshold {
                    dragOffset = 0
                    Task { await viewModel.step(-1) }
                } else {
                    dragOffset = 0
                }
            }
    }

    // MARK: - Calendar math

    /// Locale-aware calendar used for *display* — picks Mon/Sun start of week
    /// and weekday symbols based on the chosen language. We deliberately keep
    /// VM logic on UTC so the bucketing matches the API payload.
    private var displayCal: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.locale = lang.current.locale
        return c
    }

    private var monthTitle: String {
        let f = DateFormatter()
        f.locale = lang.current.locale
        f.setLocalizedDateFormatFromTemplate("MMMMy")
        return f.string(from: viewModel.monthAnchor)
    }

    /// Short weekday symbols, ordered starting at the locale's first weekday.
    private func orderedWeekdaySymbols() -> [String] {
        let cal = displayCal
        let symbols = cal.veryShortWeekdaySymbols
        let first = cal.firstWeekday // 1 = Sun, 2 = Mon…
        let n = symbols.count
        return (0..<n).map { symbols[(first - 1 + $0) % n] }
    }

    /// Build the full grid of cells (typically 35 or 42 dates) covering the
    /// displayed month plus the leading/trailing days needed to fill the
    /// grid. Cells outside the displayed month render dimmed and are not
    /// tappable.
    ///
    /// Pure — call sites should go through `recomputeMonthCells()` so the
    /// result lands in `@State` and skips work on subsequent body passes.
    private func computeMonthCells() -> [Date] {
        let cal = displayCal
        let anchor = viewModel.monthAnchor
        guard let monthRange = cal.range(of: .day, in: .month, for: anchor),
              let firstOfMonth = cal.date(from: cal.dateComponents([.year, .month], from: anchor))
        else { return [] }

        let firstWeekday = cal.component(.weekday, from: firstOfMonth)
        let leading = (firstWeekday - cal.firstWeekday + 7) % 7
        let totalDays = leading + monthRange.count
        let rows = (totalDays + 6) / 7
        let cellCount = rows * 7

        guard let start = cal.date(byAdding: .day, value: -leading, to: firstOfMonth) else { return [] }
        return (0..<cellCount).compactMap { offset in
            cal.date(byAdding: .day, value: offset, to: start)
        }
    }

    /// Refresh the cached `monthCells` from the current `monthAnchor` /
    /// locale. Cheap to call but should only run on actual month changes —
    /// driven by `.onChange(of: viewModel.monthAnchor)` in `body`.
    private func recomputeMonthCells() {
        monthCells = computeMonthCells()
    }

    /// Refresh the per-day items bucket for the currently-cached
    /// `monthCells`. Driven by `.onChange(of: viewModel.state)` so dots
    /// appear once the snapshot arrives.
    private func recomputeItemsByDay() {
        var map: [Date: [AgendaItem]] = [:]
        map.reserveCapacity(monthCells.count)
        for day in monthCells {
            let items = viewModel.items(on: day)
            if !items.isEmpty {
                map[day] = items
            }
        }
        itemsByDay = map
    }

    private func isInDisplayedMonth(_ day: Date) -> Bool {
        let cal = displayCal
        return cal.isDate(day, equalTo: viewModel.monthAnchor, toGranularity: .month)
    }

    private func isToday(_ day: Date) -> Bool {
        displayCal.isDateInToday(day)
    }
}

/// Per-day cell. Lime dot when there's any item; lime ring around today.
private struct DayCell: View {
    let day: Date
    let isInMonth: Bool
    let isToday: Bool
    let hasItem: Bool
    let locale: Locale

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                if isToday {
                    Circle()
                        .strokeBorder(DSColor.accent, lineWidth: 2)
                        .frame(width: 32, height: 32)
                }
                Text(dayNumber)
                    .font(.system(.callout, design: .rounded, weight: isToday ? .heavy : .semibold))
                    .foregroundStyle(numberColor)
                    .frame(width: 32, height: 32)
            }
            Circle()
                .fill(hasItem && isInMonth ? DSColor.accent : Color.clear)
                .frame(width: 6, height: 6)
        }
        .frame(height: 56)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(isInMonth ? DSColor.surface.opacity(0.4) : Color.clear)
        )
        .opacity(isInMonth ? 1.0 : 0.35)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilityLabel))
    }

    private var numberColor: Color {
        if !isInMonth { return DSColor.textTertiary }
        return isToday ? DSColor.accent : DSColor.textPrimary
    }

    private var dayNumber: String {
        var cal = Calendar(identifier: .gregorian)
        cal.locale = locale
        return "\(cal.component(.day, from: day))"
    }

    private var accessibilityLabel: String {
        let df = DateFormatter()
        df.locale = locale
        df.dateStyle = .full
        df.timeStyle = .none
        var label = df.string(from: day)
        if hasItem && isInMonth {
            label += ", " + String(localized: "calendar.cell.has_items")
        }
        return label
    }
}

/// Wraps a tappable date so SwiftUI's `.sheet(item:)` can drive presentation.
struct SelectedDay: Identifiable, Equatable {
    let date: Date
    var id: TimeInterval { date.timeIntervalSinceReferenceDate }
}
