import SwiftUI

struct NotificationsView: View {
    @State var viewModel: NotificationsViewModel
    @State private var confirmClearAll = false
    /// Invoked AFTER `markRead` finishes. The host (HomeView's
    /// notifications sheet) is responsible for translating the
    /// notification into a navigation push on its own stack so we
    /// don't couple the inbox to the app-level `HomeRoute` enum.
    var onSelect: ((AppNotification) -> Void)? = nil

    var body: some View {
        ZStack {
            PremiumAuthBackground()
            // The loaded state uses a `List` so we get native
            // `.swipeActions` (iOS-standard swipe-to-delete with full-swipe
            // commit). For non-loaded states, a `ScrollView` keeps the
            // existing layout for idle/empty/error placeholders.
            if case .loaded(let items) = viewModel.state {
                loadedList(items: items)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: DSSpacing.md) {
                        header
                            .padding(.top, DSSpacing.md)
                        content
                        Spacer().frame(height: 120)
                    }
                    .padding(.horizontal, DSSpacing.md)
                }
                .refreshable { await viewModel.load() }
            }
        }
        .toolbar {
            // Destructive "Clear all" sits in the nav-bar toolbar so it
            // doesn't compete with the inline "Mark all read" affordance
            // in the header (which is reserved for the lighter action).
            if case .loaded(let items) = viewModel.state, !items.isEmpty {
                ToolbarItem(placement: .topBarLeading) {
                    Button(role: .destructive) {
                        Haptics.selection()
                        confirmClearAll = true
                    } label: {
                        Text("notifications.action.clear_all")
                            .font(.system(.subheadline, design: .rounded, weight: .semibold))
                            .foregroundStyle(DSColor.danger)
                    }
                    .accessibilityLabel(Text("notifications.action.clear_all"))
                }
            }
        }
        .confirmationDialog(
            Text("notifications.confirm.clear_all.title"),
            isPresented: $confirmClearAll,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await viewModel.deleteAll() }
            } label: {
                Text("notifications.action.clear_all")
            }
            Button(role: .cancel) {} label: { Text("common.cancel") }
        } message: {
            Text("notifications.confirm.clear_all.message")
        }
        .task { await viewModel.load() }
    }

    private var header: some View {
        HStack(alignment: .center) {
            Text(viewModel.unreadCount > 0
                 ? String(format: String(localized: "notifications.unread_format"), viewModel.unreadCount)
                 : String(localized: "notifications.all_caught_up"))
                .font(.system(.footnote, design: .rounded, weight: .bold))
                .foregroundStyle(DSColor.textSecondary)
            Spacer()
            if viewModel.unreadCount > 0 {
                Button {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    Haptics.selection()
                    Task { await viewModel.markAllRead() }
                } label: {
                    Text("notifications.mark_all_read")
                        .font(.system(.footnote, design: .rounded, weight: .heavy))
                        .foregroundStyle(DSColor.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("notifications.mark_all_read"))
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(label: String(localized: "notifications.loading"))
                .frame(height: 220)
        case .loaded:
            // Loaded state is rendered in `loadedList` directly off `body`
            // so it can use a `List` for native swipe-to-delete. This
            // branch is unreachable in practice.
            EmptyView()
        case .empty:
            EmptyStateView(
                icon: "bell.slash",
                title: String(localized: "notifications.empty.title"),
                message: String(localized: "notifications.empty.message")
            )
            .frame(height: 320)
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
                .frame(height: 320)
        }
    }

    /// Renders the loaded list using a SwiftUI `List` so each row gets
    /// native `.swipeActions` (full-swipe-to-delete). Sections mirror the
    /// Today / Yesterday / This week / Earlier buckets from the
    /// ScrollView-based layout.
    private func loadedList(items: [AppNotification]) -> some View {
        List {
            // The header lives in the first section so it scrolls with
            // the content the way the original ScrollView layout did.
            Section {
                header
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: DSSpacing.md, leading: DSSpacing.md, bottom: DSSpacing.sm, trailing: DSSpacing.md))
            }
            ForEach(viewModel.sections, id: \.0) { sectionTitle, rows in
                Section {
                    ForEach(rows) { n in
                        Button {
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            Haptics.selection()
                            Task {
                                await viewModel.markRead(n)
                                // Route AFTER the optimistic read-flip
                                // so the dot disappears in the same
                                // frame as the destination push.
                                onSelect?(n)
                            }
                        } label: {
                            NotificationRow(notification: n)
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 4, leading: DSSpacing.md, bottom: 4, trailing: DSSpacing.md))
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                Haptics.warning()
                                Task { await viewModel.delete(n) }
                            } label: {
                                Label {
                                    Text("notifications.action.delete")
                                } icon: {
                                    Image(systemName: "trash")
                                }
                            }
                        }
                    }
                } header: {
                    Text(sectionTitle)
                        .font(.system(.footnote, design: .rounded, weight: .heavy))
                        .foregroundStyle(DSColor.textSecondary)
                        .textCase(nil)
                        .padding(.horizontal, DSSpacing.xxs)
                        .padding(.top, 8)
                        .accessibilityAddTraits(.isHeader)
                }
            }
            // Trailing spacer so the last row clears the floating tab bar.
            Section {
                Color.clear
                    .frame(height: 120)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets())
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color.clear)
        .refreshable { await viewModel.load() }
    }
}

struct NotificationRow: View {
    let notification: AppNotification

    /// Shared formatters — hoisted off `body` so re-renders don't allocate
    /// a fresh `ISO8601DateFormatter` + `RelativeDateTimeFormatter` per
    /// row per redraw. Both types are documented as safe to share across
    /// reads once their configuration is set.
    private static let isoFormatter = ISO8601DateFormatter()
    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()

    var body: some View {
        let isUnread = notification.read_at == nil
        
        HStack(alignment: .top, spacing: DSSpacing.sm) {
            // Elegant glowing category icon medallion
            ZStack {
                Circle()
                    .fill(iconColor.opacity(0.08))
                    .frame(width: 44, height: 44)
                Circle()
                    .strokeBorder(iconColor.opacity(0.18), lineWidth: 1.5)
                    .frame(width: 44, height: 44)
                Image(systemName: iconName)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(iconColor)
            }
            .accessibilityHidden(true)
            
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(notification.title)
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(DSColor.textPrimary)
                    Spacer()
                    
                    // Custom unread pulsing halo indicator
                    if isUnread {
                        PulsingDot()
                            .accessibilityLabel(Text("notifications.unread_voice"))
                    }
                }
                
                Text(notification.body)
                    .font(.system(.footnote, design: .default))
                    .foregroundStyle(isUnread ? DSColor.textSecondary : DSColor.textTertiary)
                    .lineLimit(3)
                
                Text(timeAgo(notification.created_at))
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(DSColor.textTertiary)
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(isUnread ? DSColor.surfaceElevated : DSColor.surface.opacity(0.6))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(
                    isUnread ? DSColor.accent.opacity(0.35) : DSColor.border.opacity(0.4),
                    lineWidth: 1
                )
        )
        .shadow(color: isUnread ? DSColor.accent.opacity(0.05) : Color.black.opacity(0.02), radius: 6, x: 0, y: 3)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var iconName: String {
        switch notification.type {
        case .game_joined: return "person.fill.checkmark"
        case .game_cancelled: return "xmark.octagon"
        case .game_reminder: return "alarm"
        case .no_show_marked: return "exclamationmark.triangle"
        case .rating_received: return "star.fill"
        case .tournament_invite: return "trophy.fill"
        case .message_received: return "bubble.left.fill"
        case .follow: return "person.fill.badge.plus"
        case .game_invite: return "envelope.badge.fill"
        case .system: return "info.circle"
        }
    }

    private var iconColor: Color {
        switch notification.type {
        case .game_joined, .rating_received, .tournament_invite, .message_received, .follow, .game_invite:
            return DSColor.accent
        case .game_reminder: return DSColor.info
        case .game_cancelled, .no_show_marked: return DSColor.danger
        case .system: return DSColor.textSecondary
        }
    }

    private func timeAgo(_ iso: String) -> String {
        guard let date = Self.isoFormatter.date(from: iso) else { return "" }
        return Self.relativeFormatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Pulsing Dot

struct PulsingDot: View {
    @State private var pulse: Bool = false
    
    var body: some View {
        ZStack {
            Circle()
                .fill(DSColor.accent)
                .frame(width: 8, height: 8)
            Circle()
                .strokeBorder(DSColor.accent, lineWidth: 1.5)
                .frame(width: 16, height: 16)
                .scaleEffect(pulse ? 1.6 : 0.8)
                .opacity(pulse ? 0.0 : 0.8)
                .animation(
                    .easeOut(duration: 1.4)
                    .repeatForever(autoreverses: false),
                    value: pulse
                )
        }
        .onAppear {
            pulse = true
        }
    }
}
