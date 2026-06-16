import SwiftUI

/// Sheet for inviting one of the viewer's followers to a squad. Picks
/// from the authenticated user's `following` list — squads are a
/// relationship feature, so the invite pool is "people the captain
/// already plays / talks to" rather than the global directory.
///
/// On tap → POSTs the invite via the parent view-model → toasts
/// "Dəvət göndərildi" → dismisses. The receiver gets an in-app
/// notification with an accept affordance (server side).
struct SquadInviteSheet: View {
    /// The squad detail view-model — owns the actual `invite()` call and
    /// the error surface. Passed in by reference so we don't have to
    /// re-thread an APIClient + squad id through this sheet.
    @Bindable var detailViewModel: SquadDetailViewModel
    /// IDs of users already in the squad — filtered out of the picker
    /// so the captain doesn't see "send invite" rows for people who
    /// are already members. Passed in by the host so this sheet stays
    /// stateless beyond the picker's own search box.
    let excludedUserIds: Set<String>

    @Environment(\.dismiss) private var dismiss
    @Environment(AppContainer.self) private var container

    /// Loaded follower edges, paginated. Same view-model the Players
    /// agent uses on the Profile follows sheet — offset-based pagination,
    /// 30 per page, concurrent-load dedupe — so the wire behaviour is
    /// identical to the rest of the app.
    @State private var followsViewModel: FollowListViewModel?
    /// In-memory search query — filters the loaded edges by display name.
    /// Trimmed and case-insensitive. Doesn't hit the network; the
    /// follows endpoint doesn't support server-side search and the
    /// follower lists for active users stay small enough that a local
    /// filter is fine.
    @State private var query: String = ""
    /// Track which row(s) currently have a POST in flight so the cell
    /// can render a spinner and the tap can't double-fire. Keyed by
    /// user id; we clear the set entry on both success + failure paths.
    @State private var inFlightInvites: Set<String> = []

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                content
            }
            .navigationTitle(Text("squads.invite.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(DSColor.textPrimary)
                            .padding(8)
                            .background(Circle().fill(DSColor.surface))
                    }
                    .accessibilityLabel(Text("common.close"))
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task {
            // Lazy-init so the sheet doesn't fire a follows fetch when
            // it's not yet on screen. Once primed, the view-model
            // dedupes refetches itself.
            if followsViewModel == nil {
                followsViewModel = FollowListViewModel(
                    apiClient: container.apiClient,
                    userId: detailViewModel.currentUserId,
                    kind: .following,
                    viewerUserId: container.currentUser?.id
                )
                await followsViewModel?.onAppear()
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        VStack(spacing: DSSpacing.sm) {
            searchField
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.xs)
            list
        }
    }

    private var searchField: some View {
        HStack(spacing: DSSpacing.sm - 2) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(DSColor.textTertiary)
                .accessibilityHidden(true)
            TextField(text: $query) {
                Text("squads.invite.search.placeholder")
            }
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.search)
            .foregroundStyle(DSColor.textPrimary)
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(DSColor.textTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("common.clear"))
            }
        }
        .padding(.horizontal, DSSpacing.md - 2)
        .padding(.vertical, DSSpacing.sm - 2)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md + 2, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md + 2, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.5), lineWidth: 1)
        )
    }

    @ViewBuilder
    private var list: some View {
        if let vm = followsViewModel {
            switch vm.state {
            case .idle, .loading:
                LoadingView()
            case .empty:
                EmptyStateView(
                    icon: "person.crop.circle.badge.questionmark",
                    title: String(localized: "squads.invite.empty.title"),
                    message: String(localized: "squads.invite.empty.message")
                )
            case .error(let m):
                ErrorStateView(message: m) { Task { await vm.refresh() } }
            case .loaded(let items):
                let filtered = filteredItems(items)
                if filtered.isEmpty {
                    EmptyStateView(
                        icon: "magnifyingglass",
                        title: String(localized: "squads.invite.no_results.title"),
                        message: String(localized: "squads.invite.no_results.message")
                    )
                } else {
                    ScrollView {
                        LazyVStack(spacing: DSSpacing.xs) {
                            ForEach(filtered) { edge in
                                row(edge)
                                    .onAppear {
                                        if edge.id == items.last?.id {
                                            Task { await vm.loadMore() }
                                        }
                                    }
                            }
                            if vm.isPaging {
                                ProgressView()
                                    .controlSize(.regular)
                                    .tint(DSColor.accent)
                                    .padding(.vertical, DSSpacing.sm)
                                    .accessibilityLabel(Text("loading.default"))
                            }
                            Spacer().frame(height: DSSpacing.lg)
                        }
                        .padding(.horizontal, DSSpacing.md)
                    }
                    .scrollIndicators(.hidden)
                }
            }
        } else {
            LoadingView()
        }
    }

    /// Trim+lowercase the query, then filter loaded edges by display name
    /// AND prune any user id already in the squad. Members can't be
    /// re-invited; surfacing them in the picker would just frustrate the
    /// captain.
    private func filteredItems(_ items: [FollowEdge]) -> [FollowEdge] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return items.filter { edge in
            guard !excludedUserIds.contains(edge.id) else { return false }
            if q.isEmpty { return true }
            return edge.display_name.lowercased().contains(q)
        }
    }

    private func row(_ edge: FollowEdge) -> some View {
        let busy = inFlightInvites.contains(edge.id)
        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
            Task { await sendInvite(to: edge) }
        } label: {
            HStack(spacing: DSSpacing.sm) {
                avatar(for: edge)
                VStack(alignment: .leading, spacing: 2) {
                    Text(edge.display_name)
                        .font(DSType.cardTitle)
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                if busy {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(DSColor.accent)
                        .scaleEffect(0.85)
                        .accessibilityLabel(Text("loading.default"))
                } else {
                    Text("squads.invite.cta")
                        .font(DSType.badge)
                        .foregroundStyle(DSColor.accent)
                        .padding(.horizontal, DSSpacing.sm)
                        .padding(.vertical, DSSpacing.xxs + 2)
                        .background(Capsule().fill(DSColor.accent.opacity(0.14)))
                        .overlay(Capsule().strokeBorder(DSColor.accent.opacity(0.4), lineWidth: 1))
                }
            }
            .padding(DSSpacing.md - 2)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                    .fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                    .strokeBorder(DSColor.border.opacity(0.45), lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(edge.display_name))
        .accessibilityHint(Text("squads.invite.cta"))
    }

    private func avatar(for edge: FollowEdge) -> some View {
        let url: URL? = {
            guard let raw = edge.photo_url, !raw.isEmpty, !raw.hasPrefix("data:") else { return nil }
            return URL(string: raw)
        }()
        return ZStack {
            if let url {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initialsCircle(edge.display_name)
                }
            } else {
                initialsCircle(edge.display_name)
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(DSColor.border.opacity(0.6), lineWidth: 1))
    }

    private func initialsCircle(_ name: String) -> some View {
        ZStack {
            Circle().fill(LinearGradient(
                colors: [DSColor.accent, DSColor.accentSoft],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ))
            Text(initials(name))
                .font(.system(.footnote, weight: .bold))
                .foregroundStyle(DSColor.textOnAccent)
        }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "?" : parts.joined()
    }

    /// Fire the invite call. Tracks the row id so the cell renders a
    /// spinner while in flight + the tap can't fire twice. On success
    /// we surface a toast and dismiss the sheet — the captain typically
    /// invites one person at a time per visit, so closing the sheet is
    /// the natural conclusion of the flow.
    private func sendInvite(to edge: FollowEdge) async {
        guard !inFlightInvites.contains(edge.id) else { return }
        inFlightInvites.insert(edge.id)
        defer { inFlightInvites.remove(edge.id) }

        let ok = await detailViewModel.invite(userId: edge.id)
        if ok {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            ToastCenter.shared.success(String(localized: "squads.invite.sent_toast"))
            dismiss()
        } else if let message = detailViewModel.actionError {
            // Surface the API failure as a toast so the sheet stays open
            // and the captain can pick a different follower. We clear the
            // VM's actionError so it doesn't double-fire as an alert on
            // the parent detail screen.
            ToastCenter.shared.error(message)
            detailViewModel.clearError()
        }
    }
}
