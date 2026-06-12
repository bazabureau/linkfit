import SwiftUI

/// Per-type push toggles + global quiet-hours window.
///
/// Replaces the previous "tap to open iOS Settings.app" stub that took
/// the user out of the app. The OS-level push switch (granted /
/// denied) is still a separate concern handled by the system — this
/// screen scopes the *application* preference: which categories of
/// notification the server is even allowed to send.
///
/// UI pattern is a native `Form` with grouped sections so the screen
/// feels like Apple's own Settings.app rather than a bespoke surface.
/// Every toggle / picker fires an optimistic mutation on the
/// viewmodel; per-section save is implicit (no Save button).
struct NotificationPreferencesView: View {
    @State var viewModel: NotificationPreferencesViewModel

    var body: some View {
        Form {
            switch viewModel.state {
            case .idle, .loading:
                Section {
                    HStack {
                        Spacer()
                        ProgressView()
                            .tint(DSColor.accent)
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                }
            case .loaded(let response):
                typesSection(response.preferences)
                quietHoursSection(response)
            case .empty:
                // Backend always returns 8 rows; an `.empty` state here
                // would be a bug. Fall back to the error UI so the
                // screen doesn't render a misleading "no data" message.
                Section {
                    ErrorStateView(message: String(localized: "notifprefs.error.load")) {
                        Task { await viewModel.load() }
                    }
                    .listRowBackground(Color.clear)
                }
            case .error(let message):
                Section {
                    ErrorStateView(message: message) {
                        Task { await viewModel.load() }
                    }
                    .listRowBackground(Color.clear)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(DSColor.background.ignoresSafeArea())
        .navigationTitle(Text("notifprefs.title"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load() }
    }

    // MARK: - Types section

    private func typesSection(_ prefs: [NotificationPreference]) -> some View {
        Section {
            ForEach(prefs) { pref in
                Toggle(isOn: Binding(
                    get: { pref.push_enabled },
                    set: { newValue in
                        Haptics.selection()
                        Task { await viewModel.setPushEnabled(newValue, for: pref.type) }
                    }
                )) {
                    HStack(spacing: 12) {
                        iconBadge(systemName: iconName(for: pref.type),
                                  tint: DSColor.accent)
                        localizedLabel(for: pref.type)
                            .font(.system(.body, weight: .medium))
                            .foregroundStyle(DSColor.textPrimary)
                    }
                }
                .tint(DSColor.accent)
            }
        } header: {
            sectionHeader("notifprefs.section.types")
        }
        .listRowBackground(DSColor.surface)
    }

    // MARK: - Quiet hours section

    private func quietHoursSection(_ response: NotificationPreferencesResponse) -> some View {
        Section {
            // Master switch — turning OFF clears both bounds server-side.
            Toggle(isOn: Binding(
                get: { viewModel.quietHoursEnabled },
                set: { newValue in
                    Haptics.selection()
                    Task { await viewModel.setQuietHoursEnabled(newValue) }
                }
            )) {
                HStack(spacing: 12) {
                    iconBadge(systemName: "moon.fill", tint: DSColor.accent)
                    Text("notifprefs.toggle.enable_quiet")
                        .font(.system(.body, weight: .medium))
                        .foregroundStyle(DSColor.textPrimary)
                }
            }
            .tint(DSColor.accent)

            // Start/end pickers — only rendered when the feature is on
            // so the row count visibly collapses on disable.
            if viewModel.quietHoursEnabled {
                quietHourRow(
                    labelKey: "notifprefs.quiet.start",
                    hour: response.quiet_hours_start ?? viewModel.quietHoursStart
                ) { newHour in
                    Task { await viewModel.setQuietHoursStart(newHour) }
                }
                quietHourRow(
                    labelKey: "notifprefs.quiet.end",
                    hour: response.quiet_hours_end ?? viewModel.quietHoursEnd
                ) { newHour in
                    Task { await viewModel.setQuietHoursEnd(newHour) }
                }
            }
        } header: {
            sectionHeader("notifprefs.section.quiet_hours")
        }
        .listRowBackground(DSColor.surface)
    }

    /// One row: text label on the leading edge, a compact hour-of-day
    /// DatePicker on the trailing edge. The picker exposes minutes too
    /// (`.hourAndMinute` is the only sensible component option for a
    /// time-only style), but we round-trip only the hour to match the
    /// backend's integer-hour schema — minutes drag through but commit
    /// to the same hour boundary.
    private func quietHourRow(
        labelKey: LocalizedStringKey,
        hour: Int,
        onChange: @escaping (Int) -> Void
    ) -> some View {
        // Build a synthetic Date with the desired hour so the
        // DatePicker has something to display. Calendar.current handles
        // the timezone — but the *value* we read back is converted to
        // its hour-of-day component using the same calendar, so the
        // round-trip is consistent.
        let calendar = Calendar.current
        let now = Date()
        let date = calendar.date(
            bySettingHour: hour, minute: 0, second: 0, of: now
        ) ?? now

        return HStack {
            Text(labelKey)
                .font(.system(.body, weight: .medium))
                .foregroundStyle(DSColor.textPrimary)
            Spacer()
            DatePicker(
                "",
                selection: Binding(
                    get: { date },
                    set: { newDate in
                        let newHour = calendar.component(.hour, from: newDate)
                        // Only fire when the hour actually changes —
                        // dragging through minutes would otherwise spam
                        // PUTs while staying on the same hour.
                        if newHour != hour {
                            onChange(newHour)
                        }
                    }
                ),
                displayedComponents: .hourAndMinute
            )
            .labelsHidden()
            .tint(DSColor.accent)
        }
    }

    // MARK: - Helpers

    /// Map server-side notification type → SF Symbol. Unknown types
    /// fall back to a neutral bell so a future backend addition still
    /// renders meaningfully.
    private func iconName(for type: String) -> String {
        switch type {
        case "game_joined":      return "person.fill.badge.plus"
        case "game_cancelled":   return "calendar.badge.exclamationmark"
        case "game_reminder":    return "alarm.fill"
        case "no_show_marked":   return "person.fill.xmark"
        case "rating_received":  return "star.fill"
        case "tournament_invite": return "trophy.fill"
        case "message_received": return "bubble.left.fill"
        case "follow":           return "person.badge.plus"
        case "game_invite":      return "envelope.fill"
        case "system":           return "gearshape.fill"
        default:                 return "bell.fill"
        }
    }

    /// Resolve a server type string to its localized label. We map a
    /// known set of types to dedicated keys; unknown future types
    /// render the raw `type` string so the row is never blank.
    private func localizedLabel(for type: String) -> Text {
        switch type {
        case "game_invite":      return Text("notifprefs.type.game_invite")
        case "game_joined":      return Text("notifprefs.type.game_joined")
        case "game_cancelled":   return Text("notifprefs.type.game_cancelled")
        case "game_reminder":    return Text("notifprefs.type.game_reminder")
        case "no_show_marked":   return Text("notifprefs.type.no_show_marked")
        case "rating_received":  return Text("notifprefs.type.rating_received")
        case "tournament_invite": return Text("notifprefs.type.tournament_invite")
        case "message_received": return Text("notifprefs.type.message_received")
        case "follow":           return Text("notifprefs.type.follow")
        case "system":           return Text("notifprefs.type.system")
        default:                 return Text(verbatim: type)
        }
    }

    /// 28×28 tinted-rounded-square icon badge. Same primitive used by
    /// the parent `SettingsView` row rendering — copied locally so this
    /// feature stays self-contained.
    private func iconBadge(systemName: String, tint: Color) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(tint.opacity(0.16))
                .frame(width: 28, height: 28)
            Image(systemName: systemName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
        }
    }

    private func sectionHeader(_ key: LocalizedStringKey) -> some View {
        // FAZA 45 §13.1: no uppercase + no tracking. Weight carries hierarchy.
        Text(key)
            .font(DSType.badge)
            .foregroundStyle(DSColor.textSecondary)
    }
}
