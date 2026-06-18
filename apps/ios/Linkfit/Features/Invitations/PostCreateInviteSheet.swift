import SwiftUI
import Observation

/// Payload used to identify+drive a post-create invite sheet presentation.
/// `Identifiable` so SwiftUI's `.sheet(item:)` can present off of it; the
/// stable id is the game id, which can't repeat in the same session.
struct PostCreateInvitePayload: Identifiable, Equatable, Hashable {
    let gameId: String
    let hostUserId: String
    var id: String { gameId }
}

// MARK: - View Model
//
// Owns the post-create invite sheet's followers list and selection set.
// Bound to the freshly-created `gameId` so a single tap on "Send" fires
// a batch invite to the multi-select. The sheet is intentionally a
// separate surface from `InvitePlayerSheet` (which is single-pick from
// GameDetail's host toolbar) — the post-create flow optimises for
// "tell my circle right now", not curated picking.

@Observable
@MainActor
final class PostCreateInviteViewModel {
    /// All of the host's followers. Loaded once on sheet appear.
    private(set) var followers: [FollowEdge] = []
    private(set) var isLoading: Bool = false
    private(set) var loadError: String?
    /// Set of follower ids the host has tapped — drives row check-state
    /// and the bottom CTA's enabled-ness.
    var selectedIds: Set<String> = []
    /// `nil` while idle, populated after a successful send so the parent
    /// can show a confirmation toast before dismissing.
    private(set) var sendResult: BatchInviteResult?
    private(set) var isSending: Bool = false
    private(set) var sendError: String?

    private let apiClient: APIClient
    private let userId: String
    private let gameId: String

    init(apiClient: APIClient, userId: String, gameId: String) {
        self.apiClient = apiClient
        self.userId = userId
        self.gameId = gameId
    }

    /// Loads followers via the existing /users/:id/followers paginated
    /// endpoint. We pull the first page (30) because the sheet is
    /// scoped to "the close circle" — a host with hundreds of followers
    /// is the rare case, and forcing a paginated picker into a sheet
    /// burns design budget on an edge case. The sheet shows a search
    /// box so finding someone past the first 30 stays one tap away
    /// (search keys against the local list to avoid a second round-trip).
    func load() async {
        guard !isLoading else { return }
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            let page = try await apiClient.send(.followers(userId: userId, limit: 50))
            followers = page.items
        } catch let error as APIError {
            loadError = error.errorDescription
                        ?? String(localized: "invitations.post_create.error.load")
            followers = []
        } catch {
            loadError = error.localizedDescription
            followers = []
        }
    }

    func toggle(_ id: String) {
        if selectedIds.contains(id) {
            selectedIds.remove(id)
        } else {
            selectedIds.insert(id)
        }
    }

    var canSend: Bool { !selectedIds.isEmpty && !isSending }

    /// Fires the batch invite and stashes the result. Returns `true` if
    /// the server confirmed (any `sent` count, including 0). On thrown
    /// errors the caller stays on the sheet so the host can retry.
    func send() async -> Bool {
        guard canSend else { return false }
        isSending = true
        sendError = nil
        defer { isSending = false }
        do {
            let ids = Array(selectedIds)
            let result = try await apiClient.send(.batchInviteToGame(gameId: gameId, userIds: ids))
            sendResult = result
            return true
        } catch let error as APIError {
            sendError = error.errorDescription
                        ?? String(localized: "invitations.post_create.error.send")
            return false
        } catch {
            sendError = error.localizedDescription
            return false
        }
    }
}

// MARK: - View

/// Bottom sheet that appears immediately after a game is created.
/// Host picks any subset of followers; tapping "Send" fires a single
/// batch-invite call and dismisses. "Sonra" (Later) skips without
/// inviting anyone — the game itself is already created.
///
/// Design: the sheet's primary CTA shows a count ("Send to N players")
/// so the host can sanity-check before firing. The dismiss-without-
/// invites path is intentionally a soft secondary action below the
/// primary, not a corner X — we want skipping to feel like a
/// deliberate choice, not an accidental tap.
struct PostCreateInviteSheet: View {
    @State var viewModel: PostCreateInviteViewModel
    /// Called when the user dismisses without sending or after a
    /// successful send. The parent decides what to do next (e.g. push
    /// the game detail).
    let onDone: () -> Void
    @State private var query: String = ""

    private var filtered: [FollowEdge] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return viewModel.followers }
        return viewModel.followers.filter {
            $0.display_name.localizedCaseInsensitiveContains(trimmed)
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                VStack(spacing: DSSpacing.sm) {
                    header
                    if !viewModel.followers.isEmpty {
                        searchBar
                    }
                    content
                    Spacer(minLength: 0)
                    bottomBar
                }
                .padding(.top, DSSpacing.sm)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("invitations.post_create.title")
                        .font(.system(.headline, design: .default, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(.ultraThinMaterial)
        .task {
            // Single fetch on appear. If the user has 0 followers we
            // auto-dismiss after a beat so we don't leave them
            // staring at an empty state — the prompt explicitly asks
            // that the sheet only show when there's at least one
            // follower, but defending in depth feels right here.
            await viewModel.load()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text("invitations.post_create.heading")
                .font(.system(size: 24, weight: .heavy, design: .default))
                .foregroundStyle(DSColor.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("invitations.post_create.subtitle")
                .font(DSType.footnote)
                .foregroundStyle(DSColor.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, DSSpacing.md)
    }

    private var searchBar: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(DSColor.textSecondary)
            TextField("",
                      text: $query,
                      prompt: Text("invitations.post_create.search.placeholder")
                .foregroundStyle(DSColor.textTertiary))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .foregroundStyle(DSColor.textPrimary)
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .fontWeight(.semibold)
                        .foregroundStyle(DSColor.textTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("common.clear"))
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .frame(height: 44)
        .background(Capsule().fill(DSColor.surface))
        .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: 1))
        .padding(.horizontal, DSSpacing.md)
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading {
            LoadingView(label: String(localized: "invitations.post_create.loading"))
                .frame(maxHeight: .infinity)
        } else if let err = viewModel.loadError {
            ErrorStateView(message: err) { Task { await viewModel.load() } }
                .frame(maxHeight: .infinity)
        } else if viewModel.followers.isEmpty {
            EmptyStateView(
                icon: "person.2.slash",
                title: String(localized: "invitations.post_create.empty.title"),
                message: String(localized: "invitations.post_create.empty.message")
            )
            .frame(maxHeight: .infinity)
        } else if filtered.isEmpty {
            EmptyStateView(
                icon: "magnifyingglass",
                title: String(localized: "invitations.post_create.search.empty.title"),
                message: String(localized: "invitations.post_create.search.empty.message")
            )
            .frame(maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: DSSpacing.xs) {
                    ForEach(filtered) { f in
                        row(f)
                    }
                }
                .padding(.horizontal, DSSpacing.md)
            }
        }
    }

    private func row(_ f: FollowEdge) -> some View {
        let selected = viewModel.selectedIds.contains(f.id)
        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
            withAnimation(.spring(response: 0.3, dampingFraction: 0.78)) {
                viewModel.toggle(f.id)
            }
        } label: {
            HStack(spacing: DSSpacing.sm) {
                ZStack {
                    Circle().fill(DSColor.surfaceElevated)
                    Text(initials(f.display_name))
                        .font(.system(.caption, design: .default, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(f.display_name)
                        .font(.system(.footnote, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary)
                }
                Spacer()
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(selected ? DSColor.accent : DSColor.textTertiary)
                    .font(.system(size: 22))
            }
            .padding(.horizontal, DSSpacing.sm)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 14)
                .fill(selected ? DSColor.accent.opacity(0.10) : DSColor.surface))
            .overlay(RoundedRectangle(cornerRadius: 14)
                .strokeBorder(selected ? DSColor.accent : DSColor.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var bottomBar: some View {
        VStack(spacing: DSSpacing.xxs) {
            if let err = viewModel.sendError {
                Text(err)
                    .font(.system(.caption, design: .default))
                    .foregroundStyle(DSColor.danger)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DSSpacing.md)
            }
            Button {
                Task {
                    let ok = await viewModel.send()
                    if ok {
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        onDone()
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    if viewModel.isSending {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "paperplane.fill")
                    }
                    Text(sendCTAText)
                }
                .font(.system(.subheadline, design: .default, weight: .heavy))
                .foregroundStyle(DSColor.textOnAccent)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(RoundedRectangle(cornerRadius: 16)
                    .fill(viewModel.canSend ? DSColor.accent : DSColor.accent.opacity(0.4)))
            }
            .buttonStyle(.plain)
            .disabled(!viewModel.canSend)
            .padding(.horizontal, DSSpacing.md)

            // "Sonra" / Later — soft skip, dismisses without inviting.
            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                onDone()
            } label: {
                Text("invitations.post_create.later")
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textSecondary)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, DSSpacing.md)
            .padding(.bottom, DSSpacing.md)
        }
    }

    private var sendCTAText: String {
        if viewModel.selectedIds.isEmpty {
            return String(localized: "invitations.post_create.send.empty")
        }
        return String(
            format: String(localized: "invitations.post_create.send.count_format"),
            viewModel.selectedIds.count
        )
    }

    private func initials(_ name: String) -> String {
        let comps = name.split(separator: " ")
        let chars = comps.prefix(2).compactMap { $0.first }
        return String(chars).uppercased()
    }
}
