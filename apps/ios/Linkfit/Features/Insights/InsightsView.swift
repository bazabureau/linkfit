import SwiftUI
import Charts
import Accessibility

/// Player insights — ELO over time, win-rate trend, games-per-week, top
/// opponents, and reliability trend. All charts use SwiftUI Charts so we
/// stay native; lime brand stroke on the dark canvas keeps the visual
/// language consistent with the rest of the app.
///
/// The screen pulls from `GET /api/v1/me/insights?sport=<slug>&days=<n>`.
/// The header lets the user swap between sports + windows; everything
/// below re-renders against the new payload.
struct InsightsView: View {
    @State var viewModel: InsightsViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            content
                .refreshable { await viewModel.reload() }
        }
        .task { await viewModel.load() }
        .navigationTitle(Text("insights.title"))
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(DSColor.background, for: .navigationBar)
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            VStack {
                headerControls
                LoadingView()
                Spacer()
            }
        case .empty:
            ScrollView {
                VStack(spacing: DSSpacing.lg) {
                    headerControls
                    premiumEmptyCard
                    Spacer().frame(height: DSSpacing.xl)
                }
                .padding(.horizontal, DSSpacing.md)
            }
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.reload() } }
        case .loaded(let resp):
            ScrollView {
                VStack(spacing: DSSpacing.lg) {
                    headerControls
                    if viewModel.hasEnoughGames(resp) {
                        summaryKPI(resp)
                        eloCard(resp)
                        winRateCard(resp)
                        gamesPerWeekCard(resp)
                        opponentsCard(resp)
                        reliabilityCard(resp)
                    } else {
                        notEnoughGamesCard(resp)
                    }
                    Spacer().frame(height: DSSpacing.xl)
                }
                .padding(.horizontal, DSSpacing.md)
            }
        }
    }

    // MARK: - Header controls

    /// Top pickers — sport on the left, time window on the right. Both
    /// fire a reload when the user picks a new value. The sport picker is
    /// hidden when the user has only one sport (no need to choose).
    private var headerControls: some View {
        VStack(spacing: DSSpacing.sm) {
            if viewModel.availableSports.count > 1 {
                Picker(selection: $viewModel.selectedSport) {
                    ForEach(viewModel.availableSports) { s in
                        Text(sportLabel(s.sport_slug)).tag(s.sport_slug)
                    }
                } label: { Text("insights.picker.sport") }
                .pickerStyle(.segmented)
                .onChange(of: viewModel.selectedSport) { _, _ in
                    Task { await viewModel.reload() }
                }
            }
            Picker(selection: $viewModel.window) {
                ForEach(InsightsWindow.allCases) { w in
                    Text(windowLabel(w)).tag(w)
                }
            } label: { Text("insights.picker.window") }
            .pickerStyle(.segmented)
            .onChange(of: viewModel.window) { _, _ in
                Task { await viewModel.reload() }
            }
        }
        .padding(.top, DSSpacing.sm)
    }

    // MARK: - Summary KPI

    private func summaryKPI(_ resp: InsightsResponse) -> some View {
        HStack(spacing: DSSpacing.sm) {
            kpi(titleKey: "insights.kpi.games",       value: "\(resp.total_games)",
                icon: "calendar.badge.checkmark")
            kpi(titleKey: "insights.kpi.elo",         value: "\(resp.current_elo)",
                icon: "bolt.fill")
            kpi(titleKey: "insights.kpi.reliability", value: "\(resp.current_reliability)%",
                icon: "shield.lefthalf.filled")
        }
    }

    private func kpi(titleKey: LocalizedStringKey, value: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
                Text(titleKey)
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textSecondary)
            }
            Text(value)
                .font(.system(size: 20, weight: .heavy, design: .default))
                .foregroundStyle(DSColor.textPrimary)
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface),
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1),
        )
    }

    // MARK: - ELO chart

    /// Lime line + soft area gradient. We sample by index so missing
    /// dates don't widen the X axis disproportionately.
    private func eloCard(_ resp: InsightsResponse) -> some View {
        let points: [DatedInt] = resp.elo_series.enumerated().compactMap { idx, p in
            guard let d = parseDate(p.date) else { return nil }
            return DatedInt(id: "\(idx)-\(p.date)", date: d, value: p.elo)
        }
        return chartCard(titleKey: "insights.chart.elo.title",
                         subtitleKey: "insights.chart.elo.subtitle") {
            Chart(points) { p in
                AreaMark(
                    x: .value("date", p.date),
                    y: .value("elo", p.value),
                )
                .foregroundStyle(
                    LinearGradient(
                        colors: [DSColor.accent.opacity(0.35), DSColor.accent.opacity(0.0)],
                        startPoint: .top, endPoint: .bottom,
                    ),
                )
                .interpolationMethod(.monotone)

                LineMark(
                    x: .value("date", p.date),
                    y: .value("elo", p.value),
                )
                .foregroundStyle(DSColor.accent)
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
            }
            .chartXAxis { axisDateMarks() }
            .chartYAxis { axisValueMarks() }
            .frame(height: 200)
            .accessibilityLabel(Text("insights.chart.elo.title"))
            .accessibilityChartDescriptor(
                EloChartDescriptor(points: points),
            )
        }
    }

    // MARK: - Win-rate chart

    private func winRateCard(_ resp: InsightsResponse) -> some View {
        let points: [DatedDouble] = resp.win_rate_series.enumerated().compactMap { idx, p in
            guard let d = parseDate(p.date) else { return nil }
            return DatedDouble(id: "\(idx)-\(p.date)", date: d, value: p.win_rate)
        }
        return chartCard(titleKey: "insights.chart.winrate.title",
                         subtitleKey: "insights.chart.winrate.subtitle") {
            Chart {
                // 50% reference line — anything above this is "winning".
                RuleMark(y: .value("threshold", 50))
                    .foregroundStyle(DSColor.textTertiary.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))

                ForEach(points) { p in
                    LineMark(
                        x: .value("date", p.date),
                        y: .value("win_rate", p.value),
                    )
                    .foregroundStyle(DSColor.accent)
                    .interpolationMethod(.monotone)
                    .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))

                    PointMark(
                        x: .value("date", p.date),
                        y: .value("win_rate", p.value),
                    )
                    .foregroundStyle(DSColor.accent)
                    .symbolSize(36)
                }
            }
            .chartYScale(domain: 0...100)
            .chartXAxis { axisDateMarks() }
            .chartYAxis { axisValueMarks() }
            .frame(height: 200)
            .accessibilityLabel(Text("insights.chart.winrate.title"))
            .accessibilityChartDescriptor(
                WinRateChartDescriptor(points: points),
            )
        }
    }

    // MARK: - Games per week

    private func gamesPerWeekCard(_ resp: InsightsResponse) -> some View {
        let points: [DatedInt] = resp.games_per_week.enumerated().compactMap { idx, p in
            guard let d = parseDate(p.week_start) else { return nil }
            return DatedInt(id: "\(idx)-\(p.week_start)", date: d, value: p.games)
        }
        return chartCard(titleKey: "insights.chart.gpw.title",
                         subtitleKey: "insights.chart.gpw.subtitle") {
            Chart(points) { p in
                BarMark(
                    x: .value("week", p.date, unit: .weekOfYear),
                    y: .value("games", p.value),
                )
                .foregroundStyle(DSColor.accent)
                .cornerRadius(4)
            }
            .chartXAxis { axisDateMarks() }
            .chartYAxis { axisValueMarks() }
            .frame(height: 180)
            .accessibilityLabel(Text("insights.chart.gpw.title"))
            .accessibilityChartDescriptor(
                GamesPerWeekChartDescriptor(points: points),
            )
        }
    }

    // MARK: - Top opponents

    private func opponentsCard(_ resp: InsightsResponse) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text("insights.chart.opponents.title")
                .font(DSType.sectionTitle)
                .foregroundStyle(DSColor.textPrimary)
            if resp.opponents.isEmpty {
                Text("insights.chart.opponents.empty")
                    .font(.system(.subheadline, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .padding(.vertical, DSSpacing.sm)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(resp.opponents.enumerated()), id: \.element.id) { idx, opp in
                        opponentRow(opp)
                        if idx < resp.opponents.count - 1 {
                            Divider().overlay(DSColor.border)
                        }
                    }
                }
            }
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface),
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1),
        )
    }

    private func opponentRow(_ opp: InsightsOpponent) -> some View {
        HStack(spacing: DSSpacing.sm) {
            ZStack {
                Circle().fill(DSColor.accent.opacity(0.16)).frame(width: 38, height: 38)
                Text(initials(opp.display_name))
                    .font(.system(size: 13, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: opp.display_name)
                    .font(.system(.subheadline, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                Text(String(format: String(localized: "insights.opponents.games_format"),
                            opp.games_count, opp.wins, opp.losses))
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textSecondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(Int(opp.win_rate.rounded()))%")
                    .font(DSType.cardTitle)
                    .foregroundStyle(opp.win_rate >= 50 ? DSColor.success : DSColor.warning)
                Text("insights.opponents.win_rate_label")
                    .font(.system(.caption2, design: .default))
                    .foregroundStyle(DSColor.textTertiary)
            }
        }
        .padding(.vertical, DSSpacing.sm)
    }

    // MARK: - Reliability chart

    private func reliabilityCard(_ resp: InsightsResponse) -> some View {
        let points: [DatedInt] = resp.reliability_series.enumerated().compactMap { idx, p in
            guard let d = parseDate(p.date) else { return nil }
            return DatedInt(id: "\(idx)-\(p.date)", date: d, value: p.reliability)
        }
        return chartCard(titleKey: "insights.chart.reliability.title",
                         subtitleKey: "insights.chart.reliability.subtitle") {
            Chart(points) { p in
                LineMark(
                    x: .value("date", p.date),
                    y: .value("reliability", p.value),
                )
                .foregroundStyle(DSColor.success)
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
            }
            .chartYScale(domain: 0...100)
            .chartXAxis { axisDateMarks() }
            .chartYAxis { axisValueMarks() }
            .frame(height: 160)
            .accessibilityLabel(Text("insights.chart.reliability.title"))
            .accessibilityChartDescriptor(
                ReliabilityChartDescriptor(points: points),
            )
        }
    }

    // MARK: - Empty state

    /// Premium-glass empty card used when the user has zero recorded games
    /// for the selected sport / window. Mirrors the design system pattern
    /// in `MessagesViews` (medallion + heading + supporting line) and adds
    /// a CTA that pops back to the home tab.
    private var premiumEmptyCard: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.16))
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.4), lineWidth: 1)
                    .frame(width: 72, height: 72)
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(spacing: 4) {
                Text("insights.empty.title")
                    .font(.system(size: 17, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                Text("insights.empty.message")
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .padding(.horizontal, 8)
            }
            Button {
                Haptics.soft()
                dismiss()
            } label: {
                Text("insights.empty.cta")
                    .font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(DSColor.textOnAccent)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(DSColor.accent))
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.ultraThinMaterial),
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1),
        )
    }

    private func notEnoughGamesCard(_ resp: InsightsResponse) -> some View {
        VStack(spacing: DSSpacing.sm) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(DSColor.accent)
            Text("insights.threshold.title")
                .font(DSType.sectionTitle)
                .foregroundStyle(DSColor.textPrimary)
            Text(String(format: String(localized: "insights.threshold.message_format"),
                        InsightsViewModel.minGamesForCharts - resp.total_games))
                .font(.system(.subheadline, design: .default))
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(DSSpacing.lg)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface),
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1),
        )
    }

    // MARK: - Chart card chrome + axis styling

    @ViewBuilder
    private func chartCard<ChartContent: View>(
        titleKey: LocalizedStringKey,
        subtitleKey: LocalizedStringKey,
        @ViewBuilder content: () -> ChartContent,
    ) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(titleKey)
                    .font(DSType.sectionTitle)
                    .foregroundStyle(DSColor.textPrimary)
                Text(subtitleKey)
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textSecondary)
            }
            content()
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface),
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1),
        )
    }

    /// Subtle X-axis labels — short month-day stamps, no gridlines that
    /// would otherwise overwhelm the dark canvas.
    @AxisContentBuilder
    private func axisDateMarks() -> some AxisContent {
        AxisMarks(values: .automatic(desiredCount: 4)) { _ in
            AxisValueLabel(format: .dateTime.month(.abbreviated).day(),
                           anchor: .top)
                .foregroundStyle(DSColor.textTertiary)
            AxisGridLine().foregroundStyle(DSColor.border.opacity(0.4))
        }
    }

    @AxisContentBuilder
    private func axisValueMarks() -> some AxisContent {
        AxisMarks(values: .automatic(desiredCount: 3)) { _ in
            AxisValueLabel().foregroundStyle(DSColor.textTertiary)
            AxisGridLine().foregroundStyle(DSColor.border.opacity(0.4))
        }
    }

    // MARK: - Helpers

    private func sportLabel(_ slug: String) -> String {
        switch slug {
        case "padel":      return String(localized: "profile.sport.padel")
        case "football_5": return String(localized: "profile.sport.football_5")
        default:           return slug.capitalized
        }
    }

    private func windowLabel(_ w: InsightsWindow) -> String {
        switch w {
        case .days30:  return String(localized: "insights.window.30d")
        case .days90:  return String(localized: "insights.window.90d")
        case .days365: return String(localized: "insights.window.1y")
        case .all:     return String(localized: "insights.window.all")
        }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        let joined = parts.joined()
        return joined.isEmpty ? "?" : joined
    }

    private func parseDate(_ s: String) -> Date? {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.timeZone = TimeZone(identifier: "UTC")
        fmt.dateFormat = "yyyy-MM-dd"
        return fmt.date(from: s)
    }
}

// Charts can't infer Identifiable from an inline struct; tiny wrapper types
// give us stable IDs that survive list diffing.

private struct DatedInt: Identifiable, Equatable {
    let id: String
    let date: Date
    let value: Int
}

private struct DatedDouble: Identifiable, Equatable {
    let id: String
    let date: Date
    let value: Double
}

// MARK: - VoiceOver audio graph descriptors

/// Audio-graph metadata for VoiceOver. Each chart on the screen ships its
/// own descriptor so blind users can scrub across the series with a pitch
/// sweep — higher pitch = higher value. The labels are localized so the
/// "Date" / "ELO" axis announcements honor the user's language.
private struct EloChartDescriptor: AXChartDescriptorRepresentable {
    let points: [DatedInt]

    func makeChartDescriptor() -> AXChartDescriptor {
        let xs = points.map { $0.date.timeIntervalSinceReferenceDate }
        let ys = points.map { Double($0.value) }
        let xAxis = AXNumericDataAxisDescriptor(
            title: String(localized: "insights.a11y.axis.date"),
            range: (xs.min() ?? 0)...(xs.max() ?? 1),
            gridlinePositions: [],
        ) { Date(timeIntervalSinceReferenceDate: $0).formatted(date: .abbreviated, time: .omitted) }
        let yAxis = AXNumericDataAxisDescriptor(
            title: String(localized: "insights.a11y.axis.elo"),
            range: (ys.min() ?? 0)...((ys.max() ?? 0) + 1),
            gridlinePositions: [],
        ) { String(Int($0.rounded())) }
        let series = AXDataSeriesDescriptor(
            name: String(localized: "insights.chart.elo.title"),
            isContinuous: true,
            dataPoints: points.map {
                AXDataPoint(x: $0.date.timeIntervalSinceReferenceDate, y: Double($0.value))
            },
        )
        return AXChartDescriptor(
            title: String(localized: "insights.chart.elo.title"),
            summary: nil,
            xAxis: xAxis,
            yAxis: yAxis,
            additionalAxes: [],
            series: [series],
        )
    }

    func updateChartDescriptor(_ descriptor: AXChartDescriptor) {
        descriptor.series = [
            AXDataSeriesDescriptor(
                name: String(localized: "insights.chart.elo.title"),
                isContinuous: true,
                dataPoints: points.map {
                    AXDataPoint(x: $0.date.timeIntervalSinceReferenceDate, y: Double($0.value))
                },
            ),
        ]
    }
}

private struct WinRateChartDescriptor: AXChartDescriptorRepresentable {
    let points: [DatedDouble]

    func makeChartDescriptor() -> AXChartDescriptor {
        let xs = points.map { $0.date.timeIntervalSinceReferenceDate }
        let xAxis = AXNumericDataAxisDescriptor(
            title: String(localized: "insights.a11y.axis.date"),
            range: (xs.min() ?? 0)...(xs.max() ?? 1),
            gridlinePositions: [],
        ) { Date(timeIntervalSinceReferenceDate: $0).formatted(date: .abbreviated, time: .omitted) }
        let yAxis = AXNumericDataAxisDescriptor(
            title: String(localized: "insights.a11y.axis.winrate"),
            range: 0...100,
            gridlinePositions: [],
        ) { "\(Int($0.rounded()))%" }
        let series = AXDataSeriesDescriptor(
            name: String(localized: "insights.chart.winrate.title"),
            isContinuous: true,
            dataPoints: points.map {
                AXDataPoint(x: $0.date.timeIntervalSinceReferenceDate, y: $0.value)
            },
        )
        return AXChartDescriptor(
            title: String(localized: "insights.chart.winrate.title"),
            summary: nil,
            xAxis: xAxis,
            yAxis: yAxis,
            additionalAxes: [],
            series: [series],
        )
    }

    func updateChartDescriptor(_ descriptor: AXChartDescriptor) {
        descriptor.series = [
            AXDataSeriesDescriptor(
                name: String(localized: "insights.chart.winrate.title"),
                isContinuous: true,
                dataPoints: points.map {
                    AXDataPoint(x: $0.date.timeIntervalSinceReferenceDate, y: $0.value)
                },
            ),
        ]
    }
}

private struct GamesPerWeekChartDescriptor: AXChartDescriptorRepresentable {
    let points: [DatedInt]

    func makeChartDescriptor() -> AXChartDescriptor {
        let xs = points.map { $0.date.timeIntervalSinceReferenceDate }
        let ys = points.map { Double($0.value) }
        let xAxis = AXNumericDataAxisDescriptor(
            title: String(localized: "insights.a11y.axis.week"),
            range: (xs.min() ?? 0)...(xs.max() ?? 1),
            gridlinePositions: [],
        ) { Date(timeIntervalSinceReferenceDate: $0).formatted(date: .abbreviated, time: .omitted) }
        let yAxis = AXNumericDataAxisDescriptor(
            title: String(localized: "insights.a11y.axis.games"),
            range: 0...((ys.max() ?? 0) + 1),
            gridlinePositions: [],
        ) { String(Int($0.rounded())) }
        let series = AXDataSeriesDescriptor(
            name: String(localized: "insights.chart.gpw.title"),
            isContinuous: false,
            dataPoints: points.map {
                AXDataPoint(x: $0.date.timeIntervalSinceReferenceDate, y: Double($0.value))
            },
        )
        return AXChartDescriptor(
            title: String(localized: "insights.chart.gpw.title"),
            summary: nil,
            xAxis: xAxis,
            yAxis: yAxis,
            additionalAxes: [],
            series: [series],
        )
    }

    func updateChartDescriptor(_ descriptor: AXChartDescriptor) {
        descriptor.series = [
            AXDataSeriesDescriptor(
                name: String(localized: "insights.chart.gpw.title"),
                isContinuous: false,
                dataPoints: points.map {
                    AXDataPoint(x: $0.date.timeIntervalSinceReferenceDate, y: Double($0.value))
                },
            ),
        ]
    }
}

private struct ReliabilityChartDescriptor: AXChartDescriptorRepresentable {
    let points: [DatedInt]

    func makeChartDescriptor() -> AXChartDescriptor {
        let xs = points.map { $0.date.timeIntervalSinceReferenceDate }
        let xAxis = AXNumericDataAxisDescriptor(
            title: String(localized: "insights.a11y.axis.date"),
            range: (xs.min() ?? 0)...(xs.max() ?? 1),
            gridlinePositions: [],
        ) { Date(timeIntervalSinceReferenceDate: $0).formatted(date: .abbreviated, time: .omitted) }
        let yAxis = AXNumericDataAxisDescriptor(
            title: String(localized: "insights.a11y.axis.reliability"),
            range: 0...100,
            gridlinePositions: [],
        ) { "\(Int($0.rounded()))%" }
        let series = AXDataSeriesDescriptor(
            name: String(localized: "insights.chart.reliability.title"),
            isContinuous: true,
            dataPoints: points.map {
                AXDataPoint(x: $0.date.timeIntervalSinceReferenceDate, y: Double($0.value))
            },
        )
        return AXChartDescriptor(
            title: String(localized: "insights.chart.reliability.title"),
            summary: nil,
            xAxis: xAxis,
            yAxis: yAxis,
            additionalAxes: [],
            series: [series],
        )
    }

    func updateChartDescriptor(_ descriptor: AXChartDescriptor) {
        descriptor.series = [
            AXDataSeriesDescriptor(
                name: String(localized: "insights.chart.reliability.title"),
                isContinuous: true,
                dataPoints: points.map {
                    AXDataPoint(x: $0.date.timeIntervalSinceReferenceDate, y: Double($0.value))
                },
            ),
        ]
    }
}
