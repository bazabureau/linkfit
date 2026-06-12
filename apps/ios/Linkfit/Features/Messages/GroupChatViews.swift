import SwiftUI

// MARK: - Group conversation view model
//
// Drives the group-thread screen. Mirrors `ConversationThreadViewModel` in
// MessagesViews.swift but keeps a separate state machine because the API
// shape and the header chrome differ (participant count, no `other_user_id`).

@Observable
@MainActor
final class GroupConversationViewModel {
    /// One-shot opener — call before `load()` to ensure the server has
    /// created (or surfaced) the conversation row. Returns the canonical
    /// `conversation_id` the view binds to from then on.
    static func resolveConversationId(apiClient: APIClient,
                                      kind: GroupChatKind,
                                      targetId: String) async throws -> String {
        let res = try await apiClient.send(.openGroupConversation(kind: kind, targetId: targetId))
        return res.conversation_id
    }

    private(set) var threadState: ViewState<ConversationThread> = .idle
    private(set) var rosterState: ViewState<GroupParticipantsResponse> = .idle

    var draft: String = ""
    var isSending = false

    let conversationId: String
    private let apiClient: APIClient
    private let realtime: RealtimeClient?
    @ObservationIgnored
    private nonisolated(unsafe) var realtimeTask: Task<Void, Never>?

    init(apiClient: APIClient, conversationId: String, realtime: RealtimeClient? = nil) {
        self.apiClient = apiClient
        self.conversationId = conversationId
        self.realtime = realtime
    }

    deinit {
        realtimeTask?.cancel()
    }

    func startRealtime() {
        guard realtimeTask == nil, let realtime else { return }
        realtimeTask = Task { [weak self] in
            let stream = await realtime.subscribe()
            for await event in stream {
                guard let self else { return }
                if Task.isCancelled { return }
                self.handle(event)
            }
        }
    }

    private func handle(_ event: RealtimeEvent) {
        guard case .message(let payload) = event,
              payload.conversation_id == conversationId else { return }
        guard case .loaded(let thread) = threadState else { return }
        if thread.messages.contains(where: { $0.id == payload.id }) { return }
        let newMessage: Message
        do {
            let bridged = try JSONEncoder().encode(payload)
            newMessage = try JSONDecoder().decode(Message.self, from: bridged)
        } catch {
            return
        }
        let merged = ConversationThread(
            conversation_id: thread.conversation_id,
            other_user_id: thread.other_user_id,
            other_display_name: thread.other_display_name,
            other_last_read_at: thread.other_last_read_at,
            messages: thread.messages + [newMessage]
        )
        threadState = .loaded(merged)
    }

    func loadAll() async {
        async let thread: () = loadThread()
        async let roster: () = loadRoster()
        _ = await (thread, roster)
    }

    func loadThread() async {
        let firstLoad: Bool = { if case .loaded = threadState { return false } else { return true } }()
        if firstLoad { threadState = .loading }
        guard UUID(uuidString: conversationId) != nil else {
            threadState = .error(message: String(localized: "api.error.not_found"))
            return
        }
        do {
            let thread = try await apiClient.send(.conversationThread(id: conversationId))
            threadState = .loaded(thread)
        } catch is CancellationError { return }
        catch let error as APIError {
            threadState = .error(message: error.errorDescription ?? String(localized: "messages.error.load_thread"))
        } catch {
            threadState = .error(message: error.localizedDescription)
        }
    }

    func loadRoster() async {
        let firstLoad: Bool = { if case .loaded = rosterState { return false } else { return true } }()
        if firstLoad { rosterState = .loading }
        guard UUID(uuidString: conversationId) != nil else {
            rosterState = .error(message: String(localized: "api.error.not_found"))
            return
        }
        do {
            let r = try await apiClient.send(.groupParticipants(conversationId: conversationId))
            rosterState = .loaded(r)
        } catch is CancellationError { return }
        catch let error as APIError {
            rosterState = .error(message: error.errorDescription ?? String(localized: "group_chat.error.load_participants"))
        } catch {
            rosterState = .error(message: error.localizedDescription)
        }
    }

    func send() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !isSending else { return }
        isSending = true
        defer { isSending = false }
        do {
            _ = try await apiClient.send(.sendMessage(conversationId: conversationId, body: body))
            draft = ""
            await loadThread()
        } catch {
            // Keep the draft on failure so the user can retry.
        }
    }

    // Owner-side roster mutations. The views guard the buttons; the server
    // also enforces ownership so a tampered client never escalates.
    func addParticipant(userId: String) async -> Bool {
        do {
            _ = try await apiClient.send(.addGroupParticipant(conversationId: conversationId, userId: userId))
            await loadRoster()
            return true
        } catch { return false }
    }

    func removeParticipant(userId: String) async -> Bool {
        do {
            _ = try await apiClient.send(.removeGroupParticipant(conversationId: conversationId, userId: userId))
            await loadRoster()
            return true
        } catch { return false }
    }
}

// MARK: - Group conversation view

/// Group-thread screen. Visually matches the 1:1 `ConversationThreadView` —
/// same composer, same bubbles — but the header swaps the avatar circle for
/// a stack of initials and adds a tap-to-roster gesture.
struct GroupConversationView: View {
    @State var viewModel: GroupConversationViewModel
    let currentUserId: String?
    /// Called when the user taps a participant row inside the sheet —
    /// upstream pushes a profile route. We keep the navigation glue out of
    /// this file so the view stays composable in different shells.
    let onOpenProfile: ((String) -> Void)?
    @FocusState private var inputFocused: Bool
    @State private var showRoster = false

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                Divider().overlay(DSColor.border)
                messages
                composer
            }
        }
        .task {
            // Track active conversation for in-app notification toasts suppression
            InAppNotificationNotifier.shared.activeConversationId = viewModel.conversationId
            viewModel.startRealtime()
            await viewModel.loadAll()
        }
        .onDisappear {
            InAppNotificationNotifier.shared.activeConversationId = nil
        }
        .sheet(isPresented: $showRoster) {
            GroupParticipantsSheet(
                viewModel: viewModel,
                currentUserId: currentUserId,
                onOpenProfile: { id in
                    showRoster = false
                    onOpenProfile?(id)
                },
            )
        }
    }

    // MARK: header

    private var header: some View {
        Button { showRoster = true } label: {
            HStack(spacing: DSSpacing.sm) {
                groupAvatar
                VStack(alignment: .leading, spacing: 2) {
                    Text(headerTitle)
                        .font(.system(.headline, design: .rounded, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    Text(participantCountLabel)
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(DSColor.textSecondary)
                }
                Spacer()
                Image(systemName: "person.2.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(DSColor.textTertiary)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.vertical, DSSpacing.sm)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var headerTitle: String {
        if case .loaded(let r) = viewModel.rosterState, !r.title.isEmpty { return r.title }
        return String(localized: "group_chat.default_title")
    }

    private var participantCountLabel: String {
        if case .loaded(let r) = viewModel.rosterState {
            let format = String(localized: "group_chat.participants_count")
            return String(format: format, r.items.count)
        }
        return String(localized: "group_chat.tap_for_members")
    }

    private var groupAvatar: some View {
        ZStack {
            Circle()
                .fill(LinearGradient(
                    colors: [DSColor.accent, DSColor.accentSoft],
                    startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 40, height: 40)
            Image(systemName: "person.3.fill")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
        }
    }

    // MARK: messages

    @ViewBuilder
    private var messages: some View {
        switch viewModel.threadState {
        case .idle, .loading:
            LoadingView().frame(maxHeight: .infinity)
        case .loaded(let thread):
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: DSSpacing.xs) {
                        ForEach(thread.messages, id: \.id) { m in
                            GroupMessageBubble(
                                message: m,
                                isMine: m.sender_user_id == currentUserId,
                                senderName: senderName(for: m.sender_user_id),
                            )
                            .id(m.id)
                        }
                    }
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.vertical, DSSpacing.sm)
                }
                .onChange(of: thread.messages.count) { _, _ in
                    if let last = thread.messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
                .onAppear {
                    if let last = thread.messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        case .empty:
            EmptyStateView(
                icon: "person.3.sequence",
                title: String(localized: "group_chat.empty.title"),
                message: String(localized: "group_chat.empty.message"))
                .frame(maxHeight: .infinity)
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.loadThread() } }
                .frame(maxHeight: .infinity)
        }
    }

    private func senderName(for userId: String) -> String? {
        guard case .loaded(let r) = viewModel.rosterState else { return nil }
        return r.items.first(where: { $0.user_id == userId })?.display_name
    }

    // MARK: composer

    private var composer: some View {
        HStack(spacing: DSSpacing.sm) {
            TextField("",
                      text: $viewModel.draft,
                      prompt: Text("messages.composer.placeholder")
                        .foregroundStyle(DSColor.textTertiary),
                      axis: .vertical)
                .lineLimit(1...4)
                .focused($inputFocused)
                .foregroundStyle(DSColor.textPrimary)
                .padding(.horizontal, DSSpacing.md)
                .padding(.vertical, DSSpacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(DSColor.surfaceElevated))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(DSColor.border, lineWidth: 1))

            Button {
                Task { await viewModel.send() }
            } label: {
                ZStack {
                    Circle().fill(DSColor.accent).frame(width: 44, height: 44)
                    if viewModel.isSending {
                        ProgressView().tint(.white).controlSize(.small)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(DSColor.textOnAccent)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(viewModel.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                      || viewModel.isSending)
            .opacity(viewModel.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.5 : 1)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.bottom, DSSpacing.sm)
        .background(DSColor.background)
    }
}

// MARK: - Participants sheet

struct GroupParticipantsSheet: View {
    @State var viewModel: GroupConversationViewModel
    let currentUserId: String?
    let onOpenProfile: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                content
            }
            .navigationTitle(Text("group_chat.participants_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(DSColor.textSecondary)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.rosterState {
        case .idle, .loading:
            LoadingView()
        case .loaded(let roster):
            list(roster: roster)
        case .empty:
            EmptyStateView(
                icon: "person.crop.circle.badge.questionmark",
                title: String(localized: "group_chat.empty_roster.title"),
                message: String(localized: "group_chat.empty_roster.message"))
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.loadRoster() } }
        }
    }

    private func list(roster: GroupParticipantsResponse) -> some View {
        let amIOwner = (roster.owner_user_id == currentUserId)
        return ScrollView {
            VStack(spacing: DSSpacing.xs) {
                ForEach(roster.items, id: \.user_id) { p in
                    GroupParticipantRow(
                        participant: p,
                        canKick: amIOwner && !p.is_owner && p.user_id != currentUserId,
                        onTap: { onOpenProfile(p.user_id) },
                        onKick: { Task { _ = await viewModel.removeParticipant(userId: p.user_id) } },
                    )
                }

                if amIOwner {
                    Divider()
                        .padding(.vertical, DSSpacing.sm)
                    // The "add" affordance is a thin stub — handing off to a
                    // followed-players picker is out of scope here, but the
                    // hook is in place so a future agent can present the
                    // existing PlayersView search and call
                    // `viewModel.addParticipant(userId:)` once one is picked.
                    HStack(spacing: DSSpacing.sm) {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(DSColor.accent)
                        Text("group_chat.add_participant")
                            .font(.system(.subheadline, design: .rounded, weight: .semibold))
                            .foregroundStyle(DSColor.textPrimary)
                        Spacer()
                    }
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.vertical, DSSpacing.sm)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(DSColor.surface))
                }
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.top, DSSpacing.sm)
        }
        .refreshable { await viewModel.loadRoster() }
    }
}

private struct GroupParticipantRow: View {
    let participant: GroupParticipant
    let canKick: Bool
    let onTap: () -> Void
    let onKick: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: DSSpacing.sm) {
                ZStack {
                    Circle()
                        .fill(LinearGradient(
                            colors: [DSColor.accent, DSColor.accentSoft],
                            startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(width: 40, height: 40)
                    Text(initials(participant.display_name))
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(.white)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(participant.display_name)
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary)
                    if participant.is_owner {
                        Text("group_chat.owner_badge")
                            .font(.system(.caption2, design: .rounded, weight: .bold))
                            .foregroundStyle(DSColor.accent)
                    }
                }
                Spacer()
                if canKick {
                    Button(action: onKick) {
                        Image(systemName: "minus.circle.fill")
                            .foregroundStyle(DSColor.textTertiary)
                            .font(.system(size: 20))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.vertical, DSSpacing.sm)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(DSColor.surface))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "?" : parts.joined()
    }
}

// MARK: - Bubbles

private struct GroupMessageBubble: View {
    let message: Message
    let isMine: Bool
    /// Sender display name — surfaced *above* the bubble in group threads so
    /// the recipient can tell who's speaking. Falls back to a short hash of
    /// the user_id when the roster hasn't loaded yet.
    let senderName: String?

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            if isMine { Spacer(minLength: 60) }
            VStack(alignment: isMine ? .trailing : .leading, spacing: 4) {
                if !isMine, let name = senderName, !name.isEmpty {
                    Text(name)
                        .font(.system(.caption2, design: .rounded, weight: .semibold))
                        .foregroundStyle(DSColor.textTertiary)
                        .padding(.leading, 4)
                }
                if !message.body.isEmpty {
                    Text(message.body)
                        .font(.system(.subheadline, design: .default))
                        .foregroundStyle(isMine ? DSColor.textOnAccent : DSColor.textPrimary)
                        .padding(.horizontal, DSSpacing.md)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(isMine ? DSColor.accent : DSColor.surface))
                }
                Text(timeLabel(message.created_at))
                    .font(.system(.caption2, design: .rounded))
                    .foregroundStyle(DSColor.textTertiary)
                    .padding(.horizontal, 4)
            }
            if !isMine { Spacer(minLength: 60) }
        }
    }

    private func timeLabel(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return "" }
        let f = DateFormatter()
        f.locale = Locale.current
        f.setLocalizedDateFormatFromTemplate("Hm")
        return f.string(from: date)
    }
}
