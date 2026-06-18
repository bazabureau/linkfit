import SwiftUI
import MapKit

struct CreateGameView: View {
    @State var viewModel: CreateGameViewModel
    var onCreated: (GameDetail) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(AppContainer.self) private var container

    @State private var showVenuePicker = false
    @State private var showAdvanced = false

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    topBar
                    gameSummary
                    whenCard
                    venueCard
                    gameShapeCard
                    hostOptionsCard
                    Spacer().frame(height: 24)
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollIndicators(.hidden)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                submitBar
            }
        }
        .animation(reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.86), value: showAdvanced)
        .task {
            await viewModel.onAppear()
            if let padel = viewModel.sports.first(where: { $0.slug == "padel" }) {
                viewModel.selectSport(padel)
            }
        }
        .sheet(isPresented: $showVenuePicker) {
            VenuePickerSheet(
                venues: viewModel.venues,
                selectedId: viewModel.selectedVenue?.id,
                onSelect: { venue in
                    viewModel.selectVenue(venue)
                    showVenuePicker = false
                },
                onClear: {
                    viewModel.selectVenue(nil)
                    showVenuePicker = false
                }
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            .presentationBackground(.ultraThinMaterial)
        }
    }

    private var topBar: some View {
        HStack(alignment: .center, spacing: 12) {
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                    .frame(width: 42, height: 42)
                    .background(Circle().fill(DSColor.surfaceElevated))
                    .overlay(Circle().strokeBorder(DSColor.border, lineWidth: 1))
            }
            .buttonStyle(SpringPressStyle())
            .accessibilityLabel(Text("common.close"))

            VStack(alignment: .leading, spacing: 2) {
                Text("create_game.title")
                    .font(.system(size: 28, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
                Text("create_game.subtitle")
                    .font(DSType.metaCaption)
                    .foregroundStyle(DSColor.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }

            Spacer(minLength: 8)

            sportChip
        }
    }

    private var sportChip: some View {
        HStack(spacing: 6) {
            Image(systemName: "figure.tennis")
            Text(viewModel.selectedSport?.name ?? "Padel")
                .lineLimit(1)
        }
        .font(.system(size: 12, weight: .heavy))
        .foregroundStyle(DSColor.accent)
        .padding(.horizontal, 11)
        .frame(height: 34)
        .background(Capsule().fill(DSColor.accentMuted))
    }

    private var gameSummary: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(DSColor.accent)
                    Image(systemName: "calendar.badge.plus")
                        .font(.system(size: 25, weight: .bold))
                        .foregroundStyle(DSColor.textOnAccent)
                }
                .frame(width: 62, height: 62)

                VStack(alignment: .leading, spacing: 5) {
                    Text(Self.dayFormatter.string(from: viewModel.startsAt))
                        .font(.system(size: 21, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)

                    Text(summaryLine)
                        .font(DSType.metaCaption)
                        .foregroundStyle(DSColor.textSecondary)
                        .lineLimit(2)
                }

                Spacer(minLength: 0)
            }

            HStack(spacing: 8) {
                summaryPill(icon: "clock", text: "\(viewModel.durationMinutes) min")
                summaryPill(icon: "person.2", text: String(format: String(localized: "create_game.capacity.players_format"), viewModel.capacity))
                summaryPill(icon: viewModel.visibility.icon, text: String(localized: viewModel.visibility.titleKey))
            }
        }
        .padding(16)
        .dsSurfaceCard(radius: 22, shadowOpacity: 0.02)
    }

    private var summaryLine: String {
        let time = Self.timeFormatter.string(from: viewModel.startsAt)
        let venue = viewModel.selectedVenue?.name ?? String(localized: "create_game.venue.placeholder.title")
        return "\(time) · \(venue)"
    }

    private func summaryPill(icon: String, text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .bold))
            Text(text)
                .lineLimit(1)
                .minimumScaleFactor(0.76)
        }
        .font(.system(size: 11, weight: .bold))
        .foregroundStyle(DSColor.textSecondary)
        .padding(.horizontal, 10)
        .frame(height: 31)
        .frame(maxWidth: .infinity)
        .background(Capsule().fill(DSColor.surfaceElevated))
    }

    private var whenCard: some View {
        formCard(title: "create_game.section.when", icon: "clock.badge.checkmark") {
            VStack(spacing: 14) {
                quickStarts

                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("create_game.when.exact")
                            .font(DSType.bodyStrong)
                            .foregroundStyle(DSColor.textPrimary)
                        Text(Self.fullDateFormatter.string(from: viewModel.startsAt))
                            .font(DSType.metaCaption)
                            .foregroundStyle(DSColor.textSecondary)
                            .lineLimit(1)
                    }

                    Spacer(minLength: 8)

                    DatePicker(
                        "",
                        selection: $viewModel.startsAt,
                        in: Date().addingTimeInterval(30 * 60)...,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                    .labelsHidden()
                    .tint(DSColor.accent)
                }
                .padding(13)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surfaceElevated))
            }
        }
    }

    private var quickStarts: some View {
        HStack(spacing: 8) {
            ForEach(viewModel.quickStarts) { item in
                let selected = closeTo(item.date, viewModel.startsAt)
                Button {
                    viewModel.setStartsAt(item.date)
                    UISelectionFeedbackGenerator().selectionChanged()
                } label: {
                    VStack(spacing: 3) {
                        Text(String(localized: item.key))
                            .font(.system(size: 12, weight: .heavy))
                            .lineLimit(1)
                            .minimumScaleFactor(0.76)
                        Text(Self.shortTimeFormatter.string(from: item.date))
                            .font(.system(size: 10, weight: .bold))
                            .opacity(0.72)
                    }
                    .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(selected ? DSColor.accent : DSColor.surfaceElevated)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(selected ? DSColor.accent : DSColor.border, lineWidth: 1)
                    )
                }
                .buttonStyle(SpringPressStyle())
            }
        }
    }

    private var venueCard: some View {
        formCard(title: "create_game.section.venue", icon: "mappin.and.ellipse") {
            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                showVenuePicker = true
            } label: {
                HStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(DSColor.accentMuted)
                        Image(systemName: viewModel.selectedVenue == nil ? "location" : "checkmark")
                            .font(.system(size: 15, weight: .heavy))
                            .foregroundStyle(DSColor.accent)
                    }
                    .frame(width: 42, height: 42)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(viewModel.selectedVenue?.name ?? String(localized: "create_game.venue.placeholder.title"))
                            .font(DSType.bodyStrong)
                            .foregroundStyle(DSColor.textPrimary)
                            .lineLimit(1)
                        Text(viewModel.selectedVenue?.address ?? String(localized: "create_game.venue.placeholder.subtitle"))
                            .font(DSType.metaCaption)
                            .foregroundStyle(DSColor.textSecondary)
                            .lineLimit(2)
                    }

                    Spacer(minLength: 6)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(DSColor.textTertiary)
                }
                .padding(13)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surfaceElevated))
            }
            .buttonStyle(SpringPressStyle())
        }
    }

    private var gameShapeCard: some View {
        formCard(title: "create_game.section.capacity", icon: "person.3.sequence") {
            VStack(alignment: .leading, spacing: 16) {
                durationPicker

                Divider().overlay(DSColor.border)

                HStack(alignment: .center, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(String(format: String(localized: "create_game.capacity.players_format"), viewModel.capacity))
                            .font(.system(size: 20, weight: .heavy))
                            .foregroundStyle(DSColor.textPrimary)
                        if let sport = viewModel.selectedSport {
                            Text(String(format: String(localized: "create_game.capacity.range_format"),
                                        sport.name, sport.min_players, sport.max_players))
                                .font(DSType.metaCaption)
                                .foregroundStyle(DSColor.textSecondary)
                                .lineLimit(2)
                        }
                    }

                    Spacer(minLength: 8)
                    stepperControl
                }

                playerSlots
            }
        }
    }

    private var durationPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("create_game.duration")
                .font(DSType.bodyStrong)
                .foregroundStyle(DSColor.textPrimary)

            HStack(spacing: 7) {
                ForEach([60, 75, 90, 120], id: \.self) { minutes in
                    let selected = viewModel.durationMinutes == minutes
                    Button {
                        viewModel.setDuration(minutes)
                        UISelectionFeedbackGenerator().selectionChanged()
                    } label: {
                        Text(String(format: String(localized: "create_game.duration.minutes_format"), minutes))
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 42)
                            .background(Capsule().fill(selected ? DSColor.accent : DSColor.surfaceElevated))
                            .overlay(Capsule().strokeBorder(selected ? DSColor.accent : DSColor.border, lineWidth: 1))
                    }
                    .buttonStyle(SpringPressStyle())
                }
            }
        }
    }

    private var stepperControl: some View {
        let minPlayers = viewModel.selectedSport?.min_players ?? 2
        let maxPlayers = viewModel.selectedSport?.max_players ?? 12
        let canDecrease = viewModel.capacity > minPlayers
        let canIncrease = viewModel.capacity < maxPlayers

        return HStack(spacing: 0) {
            stepperButton(systemImage: "minus", enabled: canDecrease) {
                viewModel.setCapacity(viewModel.capacity - 1)
            }

            Text("\(viewModel.capacity)")
                .font(.system(size: 16, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
                .frame(width: 38, height: 40)

            stepperButton(systemImage: "plus", enabled: canIncrease) {
                viewModel.setCapacity(viewModel.capacity + 1)
            }
        }
        .background(Capsule().fill(DSColor.surfaceElevated))
        .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: 1))
    }

    private func stepperButton(systemImage: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button {
            guard enabled else { return }
            action()
            UISelectionFeedbackGenerator().selectionChanged()
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .heavy))
                .foregroundStyle(enabled ? DSColor.accent : DSColor.textTertiary)
                .frame(width: 40, height: 40)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(Text(systemImage == "plus" ? "common.increment" : "common.decrement"))
    }

    private var playerSlots: some View {
        let maxPlayers = viewModel.selectedSport?.max_players ?? max(viewModel.capacity, 4)
        return HStack(spacing: 8) {
            ForEach(0..<maxPlayers, id: \.self) { index in
                let filled = index < viewModel.capacity
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(filled ? DSColor.accent : DSColor.surfaceElevated)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .strokeBorder(filled ? DSColor.accent : DSColor.border, lineWidth: 1)
                    )
                    .frame(height: 10)
            }
        }
        .animation(reduceMotion ? nil : .spring(response: 0.25, dampingFraction: 0.82), value: viewModel.capacity)
    }

    private var hostOptionsCard: some View {
        formCard(title: "create_game.section.advanced", icon: "slider.horizontal.3") {
            VStack(spacing: 12) {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    showAdvanced.toggle()
                } label: {
                    HStack {
                        Text(showAdvanced ? "create_game.section.advanced" : "create_game.section.advanced")
                            .font(DSType.bodyStrong)
                            .foregroundStyle(DSColor.textPrimary)
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundStyle(DSColor.textTertiary)
                            .rotationEffect(.degrees(showAdvanced ? 180 : 0))
                    }
                    .frame(height: 36)
                }
                .buttonStyle(.plain)

                if showAdvanced {
                    VStack(spacing: 16) {
                        skillPicker
                        visibilityPicker
                        notesField
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
    }

    private var skillPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("create_game.section.skill")
                .font(DSType.bodyStrong)
                .foregroundStyle(DSColor.textPrimary)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(CreateGameViewModel.SkillBand.allCases) { band in
                    let selected = viewModel.skillBand == band
                    Button {
                        viewModel.setSkillBand(band)
                        UISelectionFeedbackGenerator().selectionChanged()
                    } label: {
                        Text(skillBandLabel(band))
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
                            .lineLimit(2)
                            .minimumScaleFactor(0.78)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .padding(.horizontal, 8)
                            .background(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(selected ? DSColor.accent : DSColor.surfaceElevated)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .strokeBorder(selected ? DSColor.accent : DSColor.border, lineWidth: 1)
                            )
                    }
                    .buttonStyle(SpringPressStyle())
                }
            }
        }
    }

    private var visibilityPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("create_game.section.visibility")
                .font(DSType.bodyStrong)
                .foregroundStyle(DSColor.textPrimary)

            ForEach(CreateGameViewModel.Visibility.allCases, id: \.self) { visibility in
                let selected = viewModel.visibility == visibility
                Button {
                    viewModel.setVisibility(visibility)
                    UISelectionFeedbackGenerator().selectionChanged()
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: visibility.icon)
                            .font(.system(size: 14, weight: .heavy))
                            .foregroundStyle(selected ? DSColor.accent : DSColor.textSecondary)
                            .frame(width: 34, height: 34)
                            .background(Circle().fill(selected ? DSColor.accentMuted : DSColor.surfaceElevated))

                        VStack(alignment: .leading, spacing: 2) {
                            Text(visibilityLabel(visibility))
                                .font(DSType.bodyStrong)
                                .foregroundStyle(DSColor.textPrimary)
                            Text(visibilitySubtitle(visibility))
                                .font(DSType.metaCaption)
                                .foregroundStyle(DSColor.textSecondary)
                                .lineLimit(2)
                        }

                        Spacer()

                        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selected ? DSColor.accent : DSColor.textTertiary)
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surfaceElevated))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(selected ? DSColor.accent : DSColor.border, lineWidth: 1)
                    )
                }
                .buttonStyle(SpringPressStyle())
            }
        }
    }

    private var notesField: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("create_game.section.notes")
                .font(DSType.bodyStrong)
                .foregroundStyle(DSColor.textPrimary)

            ZStack(alignment: .topLeading) {
                if viewModel.notes.isEmpty {
                    Text("create_game.notes.placeholder")
                        .font(DSType.metaCaption)
                        .foregroundStyle(DSColor.textSecondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 13)
                }

                TextEditor(text: $viewModel.notes)
                    .font(DSType.metaCaption)
                    .foregroundStyle(DSColor.textPrimary)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 92)
                    .padding(8)
            }
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surfaceElevated))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
        }
    }

    private var submitBar: some View {
        VStack(spacing: 10) {
            if let error = viewModel.formError {
                HStack(spacing: 7) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text(error)
                        .lineLimit(2)
                }
                .font(DSType.metaCaption)
                .foregroundStyle(DSColor.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, DSSpacing.md)
            }

            PrimaryButton(
                title: String(localized: "create_game.submit"),
                icon: "plus.circle.fill",
                isLoading: viewModel.isSubmitting,
                isEnabled: viewModel.canSubmit
            ) {
                Task {
                    let viewerHome: CLLocationCoordinate2D? = {
                        guard let lat = container.currentUser?.home_lat,
                              let lng = container.currentUser?.home_lng else {
                            return nil
                        }
                        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
                    }()
                    if let created = await viewModel.submit(viewerHome: viewerHome) {
                        onCreated(created)
                    }
                }
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.bottom, 14)
        }
        .padding(.top, 18)
        .background(
            LinearGradient(
                colors: [DSColor.background.opacity(0), DSColor.background, DSColor.background],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)
        )
    }

    private func formCard<Content: View>(title: LocalizedStringKey,
                                         icon: String,
                                         @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label {
                Text(title)
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundStyle(DSColor.textSecondary)
            } icon: {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(DSColor.accent)
            }

            content()
        }
        .padding(15)
        .dsSurfaceCard(radius: 22, shadowOpacity: 0.018)
    }

    private func skillBandLabel(_ band: CreateGameViewModel.SkillBand) -> LocalizedStringKey {
        switch band {
        case .any:          return "create_game.skill.any"
        case .beginner:     return "create_game.skill.beginner"
        case .intermediate: return "create_game.skill.intermediate"
        case .advanced:     return "create_game.skill.advanced"
        }
    }

    private func visibilityLabel(_ visibility: CreateGameViewModel.Visibility) -> LocalizedStringKey {
        switch visibility {
        case .public: return "create_game.visibility.public"
        case .invite: return "create_game.visibility.invite"
        }
    }

    private func visibilitySubtitle(_ visibility: CreateGameViewModel.Visibility) -> LocalizedStringKey {
        switch visibility {
        case .public: return "create_game.visibility.public.sub"
        case .invite: return "create_game.visibility.invite.sub"
        }
    }

    private func closeTo(_ lhs: Date, _ rhs: Date) -> Bool {
        abs(lhs.timeIntervalSince(rhs)) < 60 * 15
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return formatter
    }()

    private static let fullDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("EEE d MMM HH:mm")
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("HH:mm")
        return formatter
    }()

    private static let shortTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("HH:mm")
        return formatter
    }()
}
