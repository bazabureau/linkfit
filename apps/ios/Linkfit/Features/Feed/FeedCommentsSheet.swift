import SwiftUI
import UIKit

/// Modal comment thread for a single feed event. Presented from
/// `FeedEventCard` via `.sheet(isPresented:)`. Renders an oldest-first
/// scrollable list with a WhatsApp-style bottom composer (capsule
/// input + lime send button).
///
/// The sheet is self-contained — it owns its view model and handles
/// pagination, send, and delete. The host only injects `apiClient`,
/// `eventId`, and the viewer's identity (id + display name + avatar
/// URL) so optimistic inserts can render the actor name immediately.
struct FeedCommentsSheet: View {
    @State var viewModel: FeedCommentsViewModel
    /// Viewer identity. Used to decide which rows get the long-press
    /// "Sil" action and to render the actor name on optimistic inserts
    /// before the server response lands.
    let currentUserId: String?
    let currentDisplayName: String?
    let currentAvatarURL: String?

    @Environment(\.dismiss) private var dismiss
    @FocusState private var inputFocused: Bool
    /// Non-nil while a destructive-delete confirmation is on screen. We
    /// stash the row here so the action sheet's button knows which
    /// comment to ask the view model to remove. Mirrors the
    /// confirmation-dialog pattern from `ConversationsView`.
    @State private var pendingDelete: FeedCommentItem?
    /// Set when the viewer long-presses someone else's comment and
    /// picks "Şikayət et". Drives the shared `.reportSheet` modifier.
    @State private var reportPayload: ReportTargetPayload?

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                VStack(spacing: 0) {
                    list
                    Divider().overlay(DSColor.border)
                    composer
                }
            }
            .navigationTitle(Text("feed.comments.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .fontWeight(.semibold)
                            .foregroundStyle(DSColor.textSecondary)
                    }
                    .accessibilityLabel(Text("common.cancel"))
                }
            }
        }
        .presentationDragIndicator(.visible)
        .task { await viewModel.onAppear() }
        // Long-press → action sheet → confirm. We use a confirmation
        // dialog (not a plain in-row swipe) because the thread renders
        // inside a ScrollView+LazyVStack rather than a List, and long-
        // press is the gesture iOS users expect for "menu on this row".
        .confirmationDialog(
            Text("feed.comments.delete.title"),
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { comment in
            Button(role: .destructive) {
                Task { await viewModel.delete(comment) }
                pendingDelete = nil
            } label: {
                Text("feed.comments.delete.confirm")
            }
            Button(role: .cancel) { pendingDelete = nil } label: {
                Text("common.cancel")
            }
        }
        // Surface send / delete failures inline. Tapping OK clears the
        // bound message so the alert closes — the view model rolled back
        // the optimistic mutation already.
        .alert(
            "common.error_title",
            isPresented: Binding(
                get: { viewModel.errorMessage != nil },
                set: { if !$0 { viewModel.errorMessage = nil } }
            )
        ) {
            Button("common.ok", role: .cancel) {
                viewModel.errorMessage = nil
            }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
        .reportSheet(payload: $reportPayload)
    }

    // MARK: - Thread list

    @ViewBuilder
    private var list: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView().frame(maxHeight: .infinity)
        case .empty:
            EmptyStateView(
                icon: "text.bubble",
                title: String(localized: "feed.comments.empty.title"),
                message: String(localized: "feed.comments.empty.message")
            )
            .frame(maxHeight: .infinity)
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.refresh() } }
                .frame(maxHeight: .infinity)
        case .loaded(let items):
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: DSSpacing.sm) {
                        if viewModel.isPaging {
                            ProgressView()
                                .controlSize(.regular)
                                .tint(DSColor.accent)
                                .padding(.vertical, DSSpacing.sm)
                        }
                        ForEach(items) { item in
                            FeedCommentRow(
                                item: item,
                                isMine: item.userId == currentUserId,
                                onLongPressDelete: { pendingDelete = item },
                                onLongPressReport: {
                                    UISelectionFeedbackGenerator().selectionChanged()
                                    reportPayload = ReportTargetPayload(
                                        kind: .feed_comment,
                                        targetId: item.id,
                                        targetDisplayName: item.displayName
                                    )
                                }
                            )
                            .id(item.id)
                            .onAppear {
                                // Topmost row triggers older-page load.
                                // We use the FIRST loaded item rather than
                                // the last because the cursor advances
                                // backwards in time on this feed.
                                if item.id == items.first?.id {
                                    Task { await viewModel.loadMore() }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.vertical, DSSpacing.md)
                }
                .onChange(of: items.count) { _, _ in
                    if let last = items.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
                .onAppear {
                    if let last = items.last { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    // MARK: - Composer

    /// WhatsApp-style bottom bar — capsule text input + lime send button.
    /// Disabled when the trimmed draft is empty or a send is in flight so
    /// the user can't fire duplicate POSTs. Visually mirrors the messages
    /// chat composer for consistency across the app's reply surfaces.
    private var composer: some View {
        HStack(spacing: DSSpacing.sm) {
            TextField("",
                      text: $viewModel.draft,
                      prompt: Text("feed.comments.composer.placeholder")
                        .foregroundStyle(DSColor.textTertiary),
                      axis: .vertical)
                .lineLimit(1...4)
                .focused($inputFocused)
                .foregroundStyle(DSColor.textPrimary)
                .padding(.horizontal, DSSpacing.md)
                .padding(.vertical, DSSpacing.sm)
                .background(
                    Capsule(style: .continuous)
                        .fill(DSColor.surfaceElevated))
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(DSColor.border, lineWidth: 1))
                .accessibilityLabel(Text("feed.comments.composer.placeholder"))

            Button {
                Task {
                    await viewModel.send(
                        currentUserId: currentUserId,
                        currentDisplayName: currentDisplayName,
                        currentAvatarURL: currentAvatarURL
                    )
                }
            } label: {
                ZStack {
                    Circle().fill(DSColor.accent).frame(width: 44, height: 44)
                    if viewModel.isSending {
                        ProgressView()
                            .tint(DSColor.textOnAccent)
                            .controlSize(.small)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(DSColor.textOnAccent)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(
                viewModel.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || viewModel.isSending
            )
            .opacity(
                viewModel.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? 0.5 : 1
            )
            .accessibilityLabel(Text("feed.comments.send"))
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(DSColor.background)
    }
}

// MARK: - Comment row

/// A single comment row. Renders an avatar, the actor's display name in
/// semibold, the body, and a relative timestamp. Optimistically inserted
/// rows render at 60% opacity until the POST resolves, mirroring the chat
/// bubble convention so the user knows the message is in flight.
///
/// Long-press on the viewer's own row surfaces the delete action sheet
/// via `onLongPressDelete`. The button itself uses `.plain` style so the
/// long-press recogniser can fire without competing with the tap gesture.
struct FeedCommentRow: View {
    let item: FeedCommentItem
    let isMine: Bool
    let onLongPressDelete: () -> Void
    /// Fired when the viewer long-presses a comment that isn't theirs. The
    /// host opens the shared report sheet bound to the comment id. We
    /// intentionally use the same long-press recognizer as `delete` —
    /// the gesture is the same, only the destination branches on `isMine`.
    let onLongPressReport: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: DSSpacing.sm) {
            avatar
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: DSSpacing.xs) {
                    Text(item.displayName.isEmpty
                         ? String(localized: "feed.comments.unknown_user")
                         : item.displayName)
                        .font(.system(.subheadline, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    Text(relativeCreatedAt)
                        .font(.system(.caption2, design: .default))
                        .foregroundStyle(DSColor.textTertiary)
                }
                Text(item.body)
                    .font(.system(.subheadline, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(DSSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous).fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .opacity(item.pending ? 0.6 : 1)
        // Long-press routes by ownership: own rows → "Sil" (delete),
        // other rows → "Şikayət et" (report). Pending optimistic inserts
        // disable both — there's nothing to delete or report until the
        // server confirms the row.
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: 0.4) {
            guard !item.pending else { return }
            if isMine { onLongPressDelete() } else { onLongPressReport() }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(item.displayName) \(item.body), \(relativeCreatedAt)"))
        // Expose the right action to assistive tech — long-press isn't
        // discoverable via VoiceOver otherwise. Routes by ownership so
        // the action label matches the actual destination.
        .accessibilityAction(named: Text(isMine
                                         ? "feed.comments.delete.confirm"
                                         : "reports.menu.report_comment")) {
            guard !item.pending else { return }
            if isMine { onLongPressDelete() } else { onLongPressReport() }
        }
    }

    private var avatar: some View {
        Group {
            if let urlString = item.avatarURL,
               let url = URL(string: urlString) {
                CachedAsyncImage(url: url) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: {
                    initialsAvatar
                }
                .frame(width: 36, height: 36)
                .clipShape(Circle())
            } else {
                initialsAvatar
            }
        }
    }

    private var initialsAvatar: some View {
        ZStack {
            Circle().fill(LinearGradient(
                colors: [DSColor.accent, DSColor.accentSoft],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )).frame(width: 36, height: 36)
            Text(initials(item.displayName))
                .font(.system(.footnote, design: .default, weight: .bold))
                .foregroundStyle(DSColor.textOnAccent)
        }
    }

    private var relativeCreatedAt: String {
        guard let d = Date.fromISO(item.createdAt) else { return item.createdAt }
        // Match the app language like `FeedEventCard` does — the shared
        // relative formatter otherwise renders in the device locale, which
        // drifts from the rest of the in-app copy when they disagree.
        let langCode = UserDefaults.standard.string(forKey: "linkfit.language") ?? "az"
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        formatter.locale = Locale(identifier: langCode)
        return formatter.localizedString(for: d, relativeTo: Date())
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "?" : parts.joined()
    }
}
