import SwiftUI

/// "Blocked users" screen. Lists every user the caller has blocked,
/// with a trailing **Unblock** button on each row. Tap the button to
/// confirm and then DELETE the relationship server-side (optimistic).
///
/// Long-press on a row surfaces an action sheet with three options —
/// **View profile** (push a fresh `ProfileView`), **Unblock** (same
/// confirm flow as the trailing button), and **Cancel**.
///
/// Mirrors the `SessionsView` idiom (idle/loading/loaded/empty/error
/// ViewState, per-row destructive action, pull-to-refresh) so the two
/// trust-&-safety list screens feel like siblings.
///
/// FAZA 61.5 / Wave-10: moved from `Features/Privacy/` into
/// `Features/Settings/` so the trust-&-safety UI lives alongside its
/// entry point in `SettingsView`. Network endpoints stay in the shared
/// `Endpoint+Blocks.swift` module.
struct BlockedUsersView: View {
    @Environment(AppContainer.self) private var container
    @State private var viewModel: BlockedUsersViewModel?

    /// Drives the "Are you sure?" confirmation dialog. Wrapped in an
    /// `Identifiable` payload so the dialog binding can re-present for
    /// a *different* user without going through a nil intermediate
    /// state (which would dismiss + re-show with a visible flicker).
    @State private var pendingUnblock: BlockedUser?

    /// Drives the long-press action sheet. Separate identity from
    /// `pendingUnblock` so the sheet can transition smoothly into the
    /// destructive confirmation without the two presentations racing.
    @State private var actionSheetUser: BlockedUser?

    /// Identifiable wrapper for the pushed `ProfileView` destination —
    /// `.navigationDestination(item:)` re-pushes a fresh screen if the
    /// user backs out and selects a different blocked row.
    @State private var pushedProfile: PushedProfile?

    fileprivate struct PushedProfile: Identifiable, Hashable {
        let userId: String
        var id: String { userId }
    }

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            content
        }
        .navigationTitle(Text("blocked_users.title"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if viewModel == nil {
                viewModel = BlockedUsersViewModel(apiClient: container.apiClient)
            }
            await viewModel?.load()
        }
        // Long-press action sheet — three options, native confirmation
        // dialog with a destructive Unblock that hands off to the
        // confirmation alert below. "Cancel" is implicit (.cancel role).
        .confirmationDialog(
            actionSheetUser.map { Text($0.display_name) } ?? Text(""),
            isPresented: Binding(
                get: { actionSheetUser != nil },
                set: { if !$0 { actionSheetUser = nil } }
            ),
            titleVisibility: .visible,
            presenting: actionSheetUser
        ) { user in
            Button {
                Haptics.selection()
                pushedProfile = PushedProfile(userId: user.id)
                actionSheetUser = nil
            } label: {
                Text("blocked_users.action.view_profile")
            }
            Button(role: .destructive) {
                Haptics.selection()
                pendingUnblock = user
                actionSheetUser = nil
            } label: {
                Text("blocked_users.action.unblock")
            }
            Button(role: .cancel) {
                actionSheetUser = nil
            } label: {
                Text("common.cancel")
            }
        }
        // Destructive confirmation before the actual unblock. The
        // message is keyed with %@ so the user can see exactly which
        // relationship they're undoing — important when several rows
        // share a similar display name.
        .confirmationDialog(
            Text("blocked_users.unblock.confirm.title"),
            isPresented: Binding(
                get: { pendingUnblock != nil },
                set: { if !$0 { pendingUnblock = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingUnblock
        ) { user in
            Button(role: .destructive) {
                Haptics.warning()
                let target = user
                pendingUnblock = nil
                Task { await viewModel?.unblock(target) }
            } label: {
                Text("blocked_users.action.unblock")
            }
            Button(role: .cancel) {
                pendingUnblock = nil
            } label: {
                Text("common.cancel")
            }
        } message: { user in
            Text("blocked_users.unblock.confirm.message \(user.display_name)")
        }
        .navigationDestination(item: $pushedProfile) { pushed in
            ProfileView(viewModel: ProfileViewModel(
                apiClient: container.apiClient,
                userId: pushed.userId,
                container: container
            ))
        }
    }

    @ViewBuilder
    private var content: some View {
        if let vm = viewModel {
            switch vm.state {
            case .idle, .loading:
                LoadingView(label: String(localized: "loading.default"))
            case .loaded(let items):
                loadedList(vm: vm, items: items)
            case .empty:
                emptyList(vm: vm)
            case .error(let message):
                ErrorStateView(message: message) {
                    Task { await vm.load() }
                }
            }
        } else {
            LoadingView(label: String(localized: "loading.default"))
        }
    }

    private func loadedList(vm: BlockedUsersViewModel, items: [BlockedUser]) -> some View {
        List {
            ForEach(items) { user in
                BlockedUserRow(
                    user: user,
                    isUnblocking: vm.inFlight.contains(user.id),
                    onUnblock: {
                        Haptics.selection()
                        pendingUnblock = user
                    },
                    onLongPress: {
                        Haptics.selection()
                        actionSheetUser = user
                    }
                )
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: DSSpacing.xxs, leading: DSSpacing.md, bottom: DSSpacing.xxs, trailing: DSSpacing.md))
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
        .refreshable { await vm.load() }
    }

    /// The empty state is still wrapped in a `List` so pull-to-refresh
    /// stays available — otherwise the user has no way to reload after
    /// blocking somebody outside the screen.
    private func emptyList(vm: BlockedUsersViewModel) -> some View {
        List {
            Section {
                EmptyStateView(
                    icon: "hand.raised",
                    title: String(localized: "blocked_users.empty.title"),
                    message: String(localized: "blocked_users.empty.message")
                )
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .frame(maxWidth: .infinity, minHeight: 360)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color.clear)
        .refreshable { await vm.load() }
    }
}

// MARK: - Row

/// One row in the blocked-users list. Avatar on the leading edge,
/// name + "Blocked 5 m ago" caption in the middle, destructive
/// "Unblock" button trailing. The button disables itself while an
/// unblock request is in flight to keep a fast double-tap from racing.
///
/// Long-press anywhere on the row surfaces an action sheet — that
/// gesture is owned by the parent so this row stays cheap and stateless.
private struct BlockedUserRow: View {
    let user: BlockedUser
    let isUnblocking: Bool
    let onUnblock: () -> Void
    let onLongPress: () -> Void

    /// Shared formatters — `blockedCaption` runs every body pass per row.
    private static let isoFormatter = ISO8601DateFormatter()
    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()

    var body: some View {
        HStack(alignment: .center, spacing: DSSpacing.sm) {
            avatar
            VStack(alignment: .leading, spacing: 4) {
                Text(user.display_name)
                    .font(.system(.subheadline, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                Text(blockedCaption)
                    .font(.system(.footnote, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: DSSpacing.xs)
            unblockButton
        }
        .padding(DSSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .contentShape(Rectangle())
        // The long-press lives at row level (rather than on the button)
        // so the user can hit a wide gesture target — including the
        // avatar / caption area — instead of having to land precisely
        // on the trailing Capsule.
        .onLongPressGesture(minimumDuration: 0.4, perform: onLongPress)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(user.display_name), \(blockedCaption)"))
        .accessibilityAction(named: Text("blocked_users.action.unblock"), onUnblock)
        .accessibilityAction(named: Text("blocked_users.action.view_profile"), onLongPress)
    }

    private var avatar: some View {
        let url = user.photo_url.flatMap { URL(string: $0) }
        return CachedAsyncImage(url: url) { image in
            image
                .resizable()
                .aspectRatio(contentMode: .fill)
        } placeholder: {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.18))
                Text(initials)
                    .font(.system(size: 16, weight: .heavy))
                    .foregroundStyle(DSColor.accent)
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(DSColor.border, lineWidth: 1))
    }

    private var unblockButton: some View {
        Button(role: .destructive, action: onUnblock) {
            HStack(spacing: 4) {
                if isUnblocking {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .scaleEffect(0.7)
                } else {
                    Text("blocked_users.action.unblock")
                        .font(.system(.footnote, weight: .semibold))
                }
            }
            .foregroundStyle(DSColor.danger)
            .padding(.horizontal, DSSpacing.sm)
            .padding(.vertical, DSSpacing.xs)
            .background(
                Capsule(style: .continuous).fill(DSColor.danger.opacity(0.12))
            )
            .overlay(
                Capsule(style: .continuous).strokeBorder(DSColor.danger.opacity(0.35), lineWidth: 1)
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isUnblocking)
        .accessibilityLabel(Text("blocked_users.action.unblock"))
    }

    /// Up-to-two-letter initials drawn from the display name. Falls
    /// back to a single placeholder if the name is empty (shouldn't
    /// happen but we don't want to render an empty avatar bubble).
    private var initials: String {
        let parts = user.display_name
            .split(whereSeparator: { $0.isWhitespace })
            .prefix(2)
        let letters = parts.compactMap { $0.first.map(String.init) }
        let joined = letters.joined().uppercased()
        return joined.isEmpty ? "?" : joined
    }

    /// "Blocked 5 m ago" — relative formatter parsed off the server's
    /// ISO-8601 stamp. Falls back to the raw string if parsing fails so
    /// the user at least sees something instead of a blank caption.
    private var blockedCaption: String {
        guard let date = Self.isoFormatter.date(from: user.blocked_at) else {
            return String(format: String(localized: "blocked_users.row.blocked_format"), user.blocked_at)
        }
        let relative = Self.relativeFormatter.localizedString(for: date, relativeTo: Date())
        return String(format: String(localized: "blocked_users.row.blocked_format"), relative)
    }
}
