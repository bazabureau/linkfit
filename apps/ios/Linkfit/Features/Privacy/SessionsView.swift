import SwiftUI

/// "Logged-in devices" screen. Lists every active refresh-token for the
/// signed-in user; supports per-row revoke (via `.swipeActions`) and a
/// toolbar "Sign out everywhere else" action that nukes every session
/// except the current device.
///
/// The current device's row is rendered with a lime accent pill so the
/// user can tell at a glance which entry is the phone in their hand,
/// and its swipe-to-revoke action is disabled so they can't lock
/// themselves out by accident.
struct SessionsView: View {
    @State var viewModel: SessionsViewModel
    @State private var confirmRevokeAll = false

    var body: some View {
        ZStack {
            PremiumAuthBackground()
            content
        }
        .navigationTitle(Text("sessions.title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Only surface "Sign out everywhere else" once we have at
            // least one non-current session to revoke. The toolbar item
            // disappears entirely otherwise to avoid a dead-end button.
            if hasRevocableSessions {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .destructive) {
                        Haptics.selection()
                        confirmRevokeAll = true
                    } label: {
                        Text("sessions.action.revoke_all")
                            .font(.system(.subheadline, design: .rounded, weight: .semibold))
                            .foregroundStyle(DSColor.danger)
                    }
                    .disabled(viewModel.isRevokingAll)
                    .accessibilityLabel(Text("sessions.action.revoke_all"))
                }
            }
        }
        .confirmationDialog(
            Text("sessions.confirm.revoke_all.title"),
            isPresented: $confirmRevokeAll,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await viewModel.revokeAllOthers() }
            } label: {
                Text("sessions.action.revoke_all")
            }
            Button(role: .cancel) {} label: { Text("common.cancel") }
        } message: {
            Text("sessions.confirm.revoke_all.message")
        }
        .task { await viewModel.load() }
    }

    private var hasRevocableSessions: Bool {
        if case .loaded(let items) = viewModel.state {
            return items.contains { !$0.is_current }
        }
        return false
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(label: String(localized: "sessions.loading"))
        case .loaded(let items):
            loadedList(items: items)
        case .empty:
            EmptyStateView(
                icon: "iphone.slash",
                title: String(localized: "sessions.empty.title"),
                message: String(localized: "sessions.empty.message")
            )
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
        }
    }

    private func loadedList(items: [SessionInfo]) -> some View {
        List {
            ForEach(items) { session in
                SessionRow(session: session)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: DSSpacing.xxs, leading: DSSpacing.md, bottom: DSSpacing.xxs, trailing: DSSpacing.md))
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            Haptics.warning()
                            Task { await viewModel.revoke(session) }
                        } label: {
                            Label {
                                Text("sessions.action.revoke")
                            } icon: {
                                Image(systemName: "rectangle.portrait.and.arrow.right")
                            }
                        }
                        .disabled(session.is_current)
                    }
            }
            // Trailing spacer keeps the last row off the floating tab bar.
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

// MARK: - Row

private struct SessionRow: View {
    let session: SessionInfo

    /// Shared formatters — `lastActive` runs every body pass per row.
    private static let isoFormatter = ISO8601DateFormatter()
    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()

    var body: some View {
        HStack(alignment: .top, spacing: DSSpacing.sm) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.18))
                    .frame(width: 44, height: 44)
                Image(systemName: deviceIcon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: DSSpacing.xs) {
                    Text(deviceLabel)
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary)
                    if session.is_current {
                        CurrentDeviceBadge()
                    }
                    Spacer()
                }
                Text(String(format: String(localized: "sessions.last_active_format"), lastActive))
                    .font(.system(.footnote, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .lineLimit(2)
            }
        }
        .padding(DSSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(
                    session.is_current ? DSColor.accent.opacity(0.45) : DSColor.border,
                    lineWidth: 1
                )
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// Best-effort UA → device kind. We look at the lowercased UA string
    /// and pick the most specific hit. The server makes no promises, so
    /// anything unrecognized falls through to a generic phone icon.
    private var deviceKind: DeviceKind {
        guard let ua = session.user_agent?.lowercased(), !ua.isEmpty else { return .unknown }
        // Order matters: "ipad" must beat "iphone" (some iPad UAs
        // contain "iPhone OS" because of WKWebView legacy), and Linkfit's
        // own clients should beat generic "Mozilla" markers.
        if ua.contains("ipad") { return .iPad }
        if ua.contains("iphone") { return .iPhone }
        if ua.contains("macintosh") || ua.contains("mac os") || ua.contains("macos") { return .mac }
        if ua.contains("android") { return .android }
        if ua.contains("linkfit-ios") { return .iPhone }
        if ua.contains("linkfit-android") { return .android }
        // Anything with a browser engine marker we treat as Web.
        if ua.contains("mozilla") || ua.contains("safari") || ua.contains("chrome") || ua.contains("firefox") {
            return .web
        }
        return .unknown
    }

    private var deviceIcon: String {
        switch deviceKind {
        case .iPhone:   return "iphone"
        case .iPad:     return "ipad"
        case .mac:      return "laptopcomputer"
        case .android:  return "candybarphone"
        case .web:      return "safari"
        case .unknown:  return "questionmark.square.dashed"
        }
    }

    private var deviceLabel: String {
        switch deviceKind {
        case .iPhone:   return String(localized: "sessions.device.iphone")
        case .iPad:     return String(localized: "sessions.device.ipad")
        case .mac:      return String(localized: "sessions.device.mac")
        case .android:  return String(localized: "sessions.device.android")
        case .web:      return String(localized: "sessions.device.web")
        case .unknown:  return String(localized: "sessions.device.unknown")
        }
    }

    /// Human "5m ago" rendered from `last_used_at` (falls back to
    /// `created_at` if the server hasn't recorded a use yet).
    private var lastActive: String {
        let stamp = session.last_used_at ?? session.created_at
        guard let date = Self.isoFormatter.date(from: stamp) else { return stamp }
        return Self.relativeFormatter.localizedString(for: date, relativeTo: Date())
    }
}

private enum DeviceKind {
    case iPhone, iPad, mac, android, web, unknown
}

/// Lime accent pill marking the current device. Keeps the row's main
/// label clean (single bolded device name) and lets the eye find "this
/// one is me" at a glance.
private struct CurrentDeviceBadge: View {
    var body: some View {
        Text("sessions.current")
            .font(.system(.caption2, design: .rounded, weight: .semibold))
            .foregroundStyle(DSColor.textOnAccent)
            .padding(.horizontal, DSSpacing.xs)
            .padding(.vertical, 2)
            .background(
                Capsule(style: .continuous).fill(DSColor.accent)
            )
            .accessibilityLabel(Text("sessions.current"))
    }
}
