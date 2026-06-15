import SwiftUI
import MapKit

/// Create Game screen — elegant, high-restraint startup-grade form.
/// Rebuilt from scratch to implement absolute best practices:
///   - Eliminates uppercase violations (uses sentence case everywhere per strict guidelines).
///   - Employs the standard spacing scale and generous 24pt section gaps.
///   - Groups secondary options (Skill, Visibility, Notes) inside a gorgeous,
///     collapsible "Əlavə seçimlər" (Advanced Settings) accordion to keep the primary
///     interface spacious and comfortable.
///   - Uses flat, consistent material card treatments with zero nesting.
struct CreateGameView: View {
    @State var viewModel: CreateGameViewModel
    var onCreated: (GameDetail) -> Void
    @Environment(\.dismiss) private var dismiss
    
    @Environment(AppContainer.self) private var container
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    
    @State private var showVenuePicker = false
    @State private var showAdvanced = false

    var body: some View {
        ZStack(alignment: .bottom) {
            // Clean canvas + soft brand glow — matches the rebuilt tabs,
            // drops the animated auth mesh (the "AI-wash" FAZA 45 warns about).
            DSColor.background.ignoresSafeArea()
            RadialGradient(
                colors: [DSColor.accent.opacity(0.06), .clear],
                center: .topTrailing, startRadius: 10, endRadius: 360
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)

            ScrollView {
                VStack(spacing: 24) {
                    topBar
                    heroHeader
                    
                    // Main Form Sections
                    whenSection
                    venueSection
                    capacitySection
                    
                    // Advanced Settings Accordion
                    advancedSettingsAccordion
                    
                    if showAdvanced {
                        VStack(spacing: 24) {
                            skillSection
                            visibilitySection
                            notesSection
                        }
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                    
                    Spacer().frame(height: 120)
                }
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollIndicators(.hidden)

            submitBar
        }
        .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85), value: showAdvanced)
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

    // MARK: - Navigation & Header

    private var topBar: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(.ultraThinMaterial))
                    .overlay(Circle().strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("common.close"))
            Spacer()
        }
        .padding(.horizontal, 16)
    }

    private var heroHeader: some View {
        PremiumPageHero(
            icon: "sportscourt.fill",
            titleKey: "create_game.title",
            subtitleKey: "create_game.subtitle",
            alignment: .center
        )
        .padding(.horizontal, 16)
    }

    // MARK: - 1) When Section (Time & Duration)

    private var whenSection: some View {
        sectionShell(title: String(localized: "create_game.section.when")) {
            VStack(spacing: 12) {
                quickChipRow
                
                // Date picker row
                HStack {
                    Label {
                        Text(formattedStart)
                            .font(.system(size: 14, weight: .bold, design: .default))
                            .foregroundStyle(DSColor.textPrimary)
                    } icon: {
                        Image(systemName: "calendar")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(DSColor.accent)
                    }
                    Spacer()
                    DatePicker(
                        "",
                        selection: $viewModel.startsAt,
                        in: Date().addingTimeInterval(30 * 60)...,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                    .labelsHidden()
                    .tint(DSColor.accent)
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.6)))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(DSColor.border.opacity(0.35), lineWidth: 1))
                
                durationChipRow
            }
        }
    }

    private var quickChipRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(viewModel.quickStarts) { item in
                    let selected = closeTo(item.date, viewModel.startsAt)
                    Button {
                        withAnimation(reduceMotion ? nil : .spring(response: 0.4)) {
                            viewModel.startsAt = item.date
                        }
                    } label: {
                        Text(String(localized: item.key))
                            .font(.system(size: 12, weight: .bold, design: .default))
                            .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(Capsule().fill(selected ? DSColor.accent : DSColor.surfaceElevated.opacity(0.6)))
                            .overlay(Capsule().strokeBorder(selected ? DSColor.accent : DSColor.border.opacity(0.35), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 2)
        }
    }

    private var durationChipRow: some View {
        HStack(spacing: 12) {
            Text("create_game.duration")
                .font(.system(size: 13, weight: .semibold, design: .default))
                .foregroundStyle(DSColor.textSecondary)
            Spacer()
            HStack(spacing: 6) {
                ForEach([60, 75, 90, 120], id: \.self) { mins in
                    let selected = viewModel.durationMinutes == mins
                    Button {
                        viewModel.durationMinutes = mins
                        UISelectionFeedbackGenerator().selectionChanged()
                    } label: {
                        Text(String(format: String(localized: "create_game.duration.minutes_format"), mins))
                            .font(.system(size: 11, weight: .bold, design: .default))
                            .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Capsule().fill(selected ? DSColor.accent : DSColor.surfaceElevated.opacity(0.6)))
                            .overlay(Capsule().strokeBorder(selected ? DSColor.accent : DSColor.border.opacity(0.35), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - 2) Venue Section (Location)

    private var venueSection: some View {
        sectionShell(title: String(localized: "create_game.section.venue")) {
            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                showVenuePicker = true
            } label: {
                HStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(DSColor.accent.opacity(0.18))
                            .frame(width: 38, height: 38)
                        Image(systemName: viewModel.selectedVenue == nil ? "mappin.slash" : "mappin.and.ellipse")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(DSColor.accent)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        if let venue = viewModel.selectedVenue {
                            Text(venue.name)
                                .font(.system(size: 14, weight: .heavy))
                                .foregroundStyle(DSColor.textPrimary)
                                .lineLimit(1)
                            Text(venue.address)
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(DSColor.textSecondary)
                                .lineLimit(1)
                        } else {
                            Text("create_game.venue.placeholder.title")
                                .font(.system(size: 14, weight: .heavy))
                                .foregroundStyle(DSColor.textPrimary)
                            Text("create_game.venue.placeholder.subtitle")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(DSColor.textSecondary)
                                .lineLimit(2)
                        }
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(DSColor.textTertiary)
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.ultraThinMaterial))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(DSColor.border.opacity(0.35), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - 3) Capacity Section (Players Count)

    private var capacitySection: some View {
        sectionShell(title: String(localized: "create_game.section.capacity")) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(String(format: String(localized: "create_game.capacity.players_format"), viewModel.capacity))
                        .font(.system(size: 16, weight: .heavy, design: .default))
                        .foregroundStyle(DSColor.textPrimary)
                    Spacer()
                    premiumStepper
                }
                slotRow
                if let sport = viewModel.selectedSport {
                    Text(String(format: String(localized: "create_game.capacity.range_format"), sport.name, sport.min_players, sport.max_players))
                        .font(.system(size: 11, weight: .semibold, design: .default))
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.ultraThinMaterial))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(DSColor.border.opacity(0.35), lineWidth: 1))
        }
    }

    private var premiumStepper: some View {
        let minP = viewModel.selectedSport?.min_players ?? 2
        let maxP = viewModel.selectedSport?.max_players ?? 12
        let canDec = viewModel.capacity > minP
        let canInc = viewModel.capacity < maxP

        return HStack(spacing: 0) {
            stepperButton(systemImage: "minus", enabled: canDec) {
                guard canDec else { return }
                viewModel.capacity -= 1
                UISelectionFeedbackGenerator().selectionChanged()
            }
            Rectangle()
                .fill(DSColor.border.opacity(0.4))
                .frame(width: 1, height: 22)
            stepperButton(systemImage: "plus", enabled: canInc) {
                guard canInc else { return }
                viewModel.capacity += 1
                UISelectionFeedbackGenerator().selectionChanged()
            }
        }
        .background(Capsule().fill(DSColor.surfaceElevated.opacity(0.6)))
        .overlay(Capsule().strokeBorder(DSColor.border.opacity(0.5), lineWidth: 1))
    }

    private func stepperButton(systemImage: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .heavy))
                .foregroundStyle(enabled ? DSColor.accent : DSColor.textTertiary)
                .frame(width: 42, height: 36)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(Text(systemImage == "plus" ? "common.increment" : "common.decrement"))
    }

    private var slotRow: some View {
        let max = viewModel.selectedSport?.max_players ?? viewModel.capacity
        return HStack(spacing: 6) {
            ForEach(0..<max, id: \.self) { i in
                let filled = i < viewModel.capacity
                Circle()
                    .fill(filled ? DSColor.accent : DSColor.border)
                    .frame(width: 16, height: 16)
                    .overlay(Circle().strokeBorder(filled ? DSColor.accent : DSColor.border.opacity(0.5), lineWidth: 1))
                    .scaleEffect(filled ? 1.0 : 0.85)
                    .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.7), value: viewModel.capacity)
            }
            Spacer()
        }
    }

    // MARK: - Advanced Settings Accordion Accordion Button

    private var advancedSettingsAccordion: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            withAnimation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85)) {
                showAdvanced.toggle()
            }
        } label: {
            HStack {
                Text("create_game.section.advanced")
                    .font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(DSColor.textSecondary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(DSColor.textTertiary)
                    .rotationEffect(.degrees(showAdvanced ? 90 : 0))
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.4)))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(DSColor.border.opacity(0.25), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
    }

    // MARK: - 4) Skill Level Section

    private var skillSection: some View {
        sectionShell(title: String(localized: "create_game.section.skill")) {
            HStack(spacing: 6) {
                ForEach(CreateGameViewModel.SkillBand.allCases) { band in
                    let selected = viewModel.skillBand == band
                    Button {
                        viewModel.skillBand = band
                        UISelectionFeedbackGenerator().selectionChanged()
                    } label: {
                        Text(skillBandLabel(band))
                            .font(.system(size: 11, weight: .bold, design: .default))
                            .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity)
                            .background(selected ? DSColor.accent : DSColor.surfaceElevated.opacity(0.6))
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(selected ? DSColor.accent : DSColor.border.opacity(0.35), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - 5) Visibility Section

    private var visibilitySection: some View {
        sectionShell(title: String(localized: "create_game.section.visibility")) {
            VStack(spacing: 8) {
                ForEach(CreateGameViewModel.Visibility.allCases) { vis in
                    let selected = viewModel.visibility == vis
                    Button {
                        withAnimation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.8)) {
                            viewModel.visibility = vis
                        }
                        UISelectionFeedbackGenerator().selectionChanged()
                    } label: {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle()
                                    .fill(selected ? DSColor.accent.opacity(0.18) : DSColor.surfaceElevated.opacity(0.6))
                                    .frame(width: 36, height: 36)
                                Image(systemName: vis.icon)
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(selected ? DSColor.accent : DSColor.textSecondary)
                            }
                            
                            VStack(alignment: .leading, spacing: 2) {
                                Text(visibilityLabel(vis))
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(DSColor.textPrimary)
                                Text(visibilitySubtitle(vis))
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(DSColor.textSecondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            if selected {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(DSColor.accent)
                            }
                        }
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.ultraThinMaterial))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(selected ? DSColor.accent : DSColor.border.opacity(0.35), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - 6) Notes Section

    private var notesSection: some View {
        sectionShell(title: String(localized: "create_game.section.notes")) {
            ZStack(alignment: .topLeading) {
                if viewModel.notes.isEmpty {
                    Text("create_game.notes.placeholder")
                        .font(.system(size: 13))
                        .foregroundStyle(DSColor.textSecondary)
                        .padding(.horizontal, 6)
                        .padding(.top, 8)
                }
                TextEditor(text: $viewModel.notes)
                    .font(.system(size: 13))
                    .foregroundStyle(DSColor.textPrimary)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 80)
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.4)))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(DSColor.border.opacity(0.35), lineWidth: 1))
        }
    }

    // MARK: - Submit Bar & CTAs

    private var submitBar: some View {
        VStack(spacing: 0) {
            if let err = viewModel.formError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 12, weight: .bold))
                    Text(err)
                        .font(.system(size: 11, weight: .medium))
                }
                .foregroundStyle(DSColor.danger)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
            PrimaryButton(
                title: String(localized: "create_game.submit"),
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
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .background(
            LinearGradient(colors: [DSColor.background.opacity(0), DSColor.background],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 140)
                .allowsHitTesting(false),
            alignment: .bottom
        )
    }

    // MARK: - Shell Helpers

    private func sectionShell<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(DSColor.textSecondary)
            content()
        }
        .padding(.horizontal, 16)
    }

    private func skillBandLabel(_ band: CreateGameViewModel.SkillBand) -> LocalizedStringKey {
        switch band {
        case .any:          return "create_game.skill.any"
        case .beginner:     return "create_game.skill.beginner"
        case .intermediate: return "create_game.skill.intermediate"
        case .advanced:     return "create_game.skill.advanced"
        }
    }

    private func visibilityLabel(_ vis: CreateGameViewModel.Visibility) -> LocalizedStringKey {
        switch vis {
        case .public: return "create_game.visibility.public"
        case .invite: return "create_game.visibility.invite"
        }
    }
    
    private func visibilitySubtitle(_ vis: CreateGameViewModel.Visibility) -> LocalizedStringKey {
        switch vis {
        case .public: return "create_game.visibility.public.sub"
        case .invite: return "create_game.visibility.invite.sub"
        }
    }

    private var formattedStart: String {
        let f = DateFormatter()
        f.doesRelativeDateFormatting = true
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: viewModel.startsAt)
    }

    private func closeTo(_ a: Date, _ b: Date) -> Bool {
        abs(a.timeIntervalSince(b)) < 60 * 15
    }
}
