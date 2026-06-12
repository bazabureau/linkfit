import SwiftUI

/// Wave-11 host-only reschedule sheet. Presented from the trailing
/// overflow "..." menu on `GameDetailView` — distinct from the host's
/// inline "Ləğv et" button which is wired to the older cancel flow.
///
/// UX shape:
///  - `DatePicker` prefilled with the current `starts_at`. The
///    selection floor is `now + 30 min` to mirror the Create-Game
///    sheet's constraint and avoid round-trips that the backend will
///    reject as "starts_at must be in the future".
///  - A duration chip row, prefilled with the current duration so a
///    host can tweak it in the same modal if they're, say, rescheduling
///    a 90-min match to a slot that only has 60 min free.
///  - Primary submit button at the bottom anchors the destructive-but-
///    not-dangerous primary action; cancel/close is in the nav bar.
///
/// On submit:
///  - Calls `GameDetailViewModel.reschedule(startsAt:durationMinutes:)`.
///  - On success → toast `games.reschedule.success` + dismiss.
///  - On failure → the viewmodel already populated `actionError`, the
///    parent `GameDetailView` surfaces that via its existing `.alert(...)`
///    so we don't double-show. We also dismiss so the user isn't
///    stranded in a sheet with no error visible.
struct RescheduleGameSheet: View {
    /// Owning detail viewmodel — drives the actual API call and is the
    /// source of truth for the refreshed `GameDetail` afterwards.
    let viewModel: GameDetailViewModel

    /// Current game state at the moment the sheet was presented. We
    /// prefill `startsAt` + `durationMinutes` from this so the host
    /// doesn't have to re-discover the existing schedule from scratch.
    let game: GameDetail

    @Environment(\.dismiss) private var dismiss

    /// New `starts_at` candidate. Initialised in the body's `task`
    /// block (we can't read `game.starts_at` at property-init time
    /// because the parser is a static helper, not a constant
    /// expression). Falls back to `now + 1h` if the existing ISO
    /// string is unparseable — defensive only, the parser is the same
    /// one the rest of the screen uses successfully.
    @State private var startsAt: Date = Date().addingTimeInterval(3600)
    @State private var durationMinutes: Int

    /// True while the network request is in flight. Drives the
    /// submit button's spinner + disables the form so the user can't
    /// double-fire.
    @State private var submitting: Bool = false
    /// Inline error string surfaced INSIDE the sheet on failure. Wave-11
    /// shipped a flow where the sheet dismissed on failure and the
    /// parent screen showed the alert — but the dismiss/alert race
    /// often resulted in the user perceiving the action as silently
    /// failing ("Yenidən planlaşdır işləmir"). Keeping the error
    /// adjacent to the form lets the user fix-and-retry without
    /// re-opening the sheet.
    @State private var localError: String?

    init(viewModel: GameDetailViewModel, game: GameDetail) {
        self.viewModel = viewModel
        self.game = game
        // Initial state for `durationMinutes` is the game's current
        // duration. `startsAt` is intentionally re-seeded in `.task`
        // below because `Date.fromISO` isn't `const`-callable.
        self._durationMinutes = State(initialValue: game.duration_minutes)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                PremiumAuthBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: DSSpacing.lg) {
                        whenSection
                        durationSection
                        if let err = localError {
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.system(size: 13, weight: .heavy))
                                    .foregroundStyle(DSColor.danger)
                                Text(err)
                                    .font(DSType.footnote)
                                    .foregroundStyle(DSColor.danger)
                                    .multilineTextAlignment(.leading)
                                Spacer(minLength: 0)
                            }
                            .padding(DSSpacing.sm)
                            .background(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(DSColor.danger.opacity(0.10))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .strokeBorder(DSColor.danger.opacity(0.30), lineWidth: 1)
                            )
                            .transition(.opacity)
                        }
                        Spacer(minLength: DSSpacing.md)
                        submitButton
                    }
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.top, DSSpacing.md)
                    .padding(.bottom, DSSpacing.xl)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .navigationTitle(Text("games.reschedule.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .fontWeight(.semibold)
                            .foregroundStyle(DSColor.textPrimary)
                    }
                    .accessibilityLabel(Text("common.close"))
                }
            }
            .task {
                // Seed `startsAt` from the parsed game time exactly
                // once on first presentation. If the parse fails we
                // leave the +1h default — the picker will still
                // operate, the host just has to pick a fresh time.
                if let parsed = Date.fromISO(game.starts_at) {
                    startsAt = max(parsed, Date().addingTimeInterval(30 * 60))
                }
            }
        }
    }

    // MARK: - Sections

    private var whenSection: some View {
        sectionShell(title: String(localized: "create_game.section.when")) {
            HStack {
                Label {
                    Text(formattedStart)
                        .font(.system(.subheadline, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary)
                } icon: {
                    Image(systemName: "calendar")
                        .foregroundStyle(DSColor.accent)
                }
                Spacer()
                DatePicker(
                    "",
                    selection: $startsAt,
                    in: Date().addingTimeInterval(30 * 60)...,
                    displayedComponents: [.date, .hourAndMinute]
                )
                .labelsHidden()
                .tint(DSColor.accent)
            }
            .padding(DSSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(DSColor.surfaceElevated)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
        }
    }

    private var durationSection: some View {
        sectionShell(title: String(localized: "create_game.duration")) {
            HStack {
                Spacer()
                HStack(spacing: 6) {
                    ForEach([60, 75, 90, 120], id: \.self) { mins in
                        let selected = durationMinutes == mins
                        Button {
                            durationMinutes = mins
                            UISelectionFeedbackGenerator().selectionChanged()
                        } label: {
                            Text(String(format: String(localized: "create_game.duration.minutes_format"), mins))
                                .font(.system(.footnote, design: .default, weight: .semibold))
                                .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(Capsule().fill(selected ? DSColor.accent : DSColor.surfaceElevated))
                                .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: selected ? 0 : 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var submitButton: some View {
        PrimaryButton(
            title: String(localized: "games.reschedule.submit"),
            icon: "calendar.badge.clock",
            isLoading: submitting,
            isEnabled: !submitting && isDirty
        ) {
            Task { await submit() }
        }
    }

    // MARK: - Helpers

    /// True when at least one of `startsAt` or `durationMinutes` has
    /// diverged from the original game state. Disables the submit
    /// button on no-op edits so the host can't accidentally fan push
    /// notifications out to every participant announcing "the game
    /// has moved" when nothing actually changed.
    private var isDirty: Bool {
        if durationMinutes != game.duration_minutes { return true }
        guard let original = Date.fromISO(game.starts_at) else { return true }
        // Round to the same second the picker uses to avoid a
        // millisecond drift after the `task`-block round-trip.
        return abs(startsAt.timeIntervalSince(original)) >= 60
    }

    private var formattedStart: String {
        let f = DateFormatter()
        f.doesRelativeDateFormatting = true
        f.dateStyle = .full
        f.timeStyle = .short
        return f.string(from: startsAt)
    }

    private func submit() async {
        guard !submitting else { return }
        submitting = true
        localError = nil
        defer { submitting = false }
        // Only thread the duration through when it actually changed —
        // a no-op duration patch is wasted bandwidth and trips
        // confused-API-log readers later. The viewmodel passes nil
        // through to the endpoint which then omits the key entirely.
        let outgoingDuration: Int? = durationMinutes == game.duration_minutes
            ? nil : durationMinutes
        let ok = await viewModel.reschedule(
            startsAt: startsAt,
            durationMinutes: outgoingDuration
        )
        if ok {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            ToastCenter.shared.success(String(localized: "games.reschedule.success"))
            // Clear any transient action error the viewmodel may have
            // set from an earlier attempt so the parent's alert doesn't
            // fire after we dismiss.
            viewModel.clearActionError()
            dismiss()
        } else {
            // Surface the error INLINE inside the sheet so the user can
            // adjust + retry without bouncing back through the menu.
            // Wave-11 had this dismissing on failure too, which made the
            // whole flow feel like "nothing happened" — the parent's
            // alert raced the sheet dismiss and the user often missed
            // it entirely. Pull the message off the viewmodel and clear
            // it there so the parent's alert doesn't double-fire.
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            withAnimation(.easeOut(duration: 0.2)) {
                localError = viewModel.actionError
                    ?? String(localized: "game.error.reschedule")
            }
            viewModel.clearActionError()
        }
    }

    @ViewBuilder
    private func sectionShell<Content: View>(
        title: String, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text(title)
                .font(DSType.bodyEmphasis)
                .foregroundStyle(DSColor.textSecondary)
            content()
        }
    }
}
