import SwiftUI
import PhotosUI
import AVFoundation

// MARK: - Conversations list

@Observable
@MainActor
final class ConversationsViewModel {
    private(set) var state: ViewState<[ConversationSummary]> = .idle
    /// Non-nil while a `delete` failure needs to surface to the view. The view
    /// binds an `.alert` to this and clears it on dismiss. Carries a localized
    /// message rather than the raw error so the UI can render it as-is.
    var deleteErrorMessage: String?
    private let apiClient: APIClient

    init(apiClient: APIClient) { self.apiClient = apiClient }

    func load() async {
        if case .loaded = state {} else { state = .loading }
        do {
            let items = try await apiClient.send(.conversations).items
            state = items.isEmpty ? .empty : .loaded(items)
        } catch is CancellationError { return }
        catch let error as APIError { state = .error(message: error.errorDescription ?? String(localized: "messages.error.load_conversations")) }
        catch { state = .error(message: error.localizedDescription) }
    }

    /// Optimistically remove a single conversation, then post DELETE.
    /// Reverts on server failure so the user doesn't silently lose a row,
    /// and surfaces an error message via `deleteErrorMessage` for the
    /// view to render as an alert. Mirrors the notifications-list pattern.
    func delete(_ conversation: ConversationSummary) async {
        guard case .loaded(var items) = state else { return }
        let snapshot = items
        items.removeAll { $0.id == conversation.id }
        state = items.isEmpty ? .empty : .loaded(items)
        do {
            _ = try await apiClient.send(.deleteConversation(id: conversation.id))
        } catch is CancellationError {
            // Don't roll back on cancel — the row stays optimistically gone
            // and the next `load()` repairs if the request never made it.
            return
        } catch let error as APIError {
            state = .loaded(snapshot)
            deleteErrorMessage = error.errorDescription
                ?? String(localized: "common.error.generic")
        } catch {
            state = .loaded(snapshot)
            deleteErrorMessage = error.localizedDescription
        }
    }
}

struct ConversationsView: View {
    @State var viewModel: ConversationsViewModel
    var onOpen: (ConversationSummary) -> Void

    @State private var heroVisible = false
    @State private var contentVisible = false
    /// Non-nil while a destructive-delete confirmation is on screen. We
    /// stash the row here so the confirmation dialog's action knows which
    /// conversation to ask the view model to remove.
    @State private var pendingDelete: ConversationSummary?

    var body: some View {
        ZStack {
            AppGlassBackground()
            // Loaded state uses a `List` so we get native `.swipeActions`
            // (iOS-standard swipe-to-delete with full-swipe commit). Other
            // states stay on the existing ScrollView layout so the hero +
            // skeletons / empty / error placeholders look unchanged.
            if case .loaded(let items) = viewModel.state {
                loadedList(items: items)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        PremiumPageHero(
                            icon: "bubble.left.and.bubble.right.fill",
                            titleKey: "messages.title",
                            subtitleKey: "messages.subtitle"
                        )
                        .padding(.top, 8)
                        .opacity(heroVisible ? 1 : 0)
                        .offset(y: heroVisible ? 0 : 10)

                        nonLoadedContent
                            .opacity(contentVisible ? 1 : 0)

                        Spacer().frame(height: 120)
                    }
                    .padding(.horizontal, 16)
                }
                .scrollIndicators(.hidden)
                .refreshable { await viewModel.load() }
            }
        }
        .task { await viewModel.load() }
        .onAppear(perform: stagger)
        // Destructive confirmation for swipe-to-delete. The dialog is
        // driven by `pendingDelete`; clearing it dismisses. We use a
        // confirmation dialog (not a plain swipe-commit) because removing
        // a thread is irreversible from the inbox even though the other
        // party can still see it.
        .confirmationDialog(
            Text("conversations.confirm.delete.title"),
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { conversation in
            Button(role: .destructive) {
                Task { await viewModel.delete(conversation) }
                pendingDelete = nil
            } label: {
                Text("conversations.action.delete")
            }
            Button(role: .cancel) { pendingDelete = nil } label: {
                Text("common.cancel")
            }
        } message: { _ in
            Text("conversations.confirm.delete.message")
        }
        // Surface delete failures so the user knows the row came back on
        // purpose. The view model already rolled back the optimistic
        // removal — this just explains why.
        .alert(
            "common.error_title",
            isPresented: Binding(
                get: { viewModel.deleteErrorMessage != nil },
                set: { if !$0 { viewModel.deleteErrorMessage = nil } }
            )
        ) {
            Button("common.ok", role: .cancel) {
                viewModel.deleteErrorMessage = nil
            }
        } message: {
            Text(viewModel.deleteErrorMessage ?? "")
        }
    }

    /// Non-loaded placeholders rendered inside the ScrollView layout.
    /// `loaded` is excluded here because it's owned by `loadedList` so the
    /// list can host native `.swipeActions`.
    @ViewBuilder
    private var nonLoadedContent: some View {
        switch viewModel.state {
        case .idle, .loading:
            VStack(spacing: 10) {
                ForEach(0..<5, id: \.self) { _ in ConversationRowSkeleton() }
            }
            .accessibilityHidden(true)
        case .empty:
            premiumEmptyState
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }.frame(height: 280)
        case .loaded:
            // Unreachable — loaded state is rendered via `loadedList`.
            EmptyView()
        }
    }

    /// Renders the loaded list using a SwiftUI `List` so each row gets
    /// native `.swipeActions` (full-swipe-to-delete). The hero lives in
    /// the first section so it scrolls with the content the way the
    /// original ScrollView layout did. List chrome is hidden so the rows
    /// keep their glass-card look.
    private func loadedList(items: [ConversationSummary]) -> some View {
        List {
            Section {
                PremiumPageHero(
                    icon: "bubble.left.and.bubble.right.fill",
                    titleKey: "messages.title",
                    subtitleKey: "messages.subtitle"
                )
                .padding(.top, 8)
                .opacity(heroVisible ? 1 : 0)
                .offset(y: heroVisible ? 0 : 10)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 8, trailing: 16))
            }
            Section {
                ForEach(items) { c in
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        onOpen(c)
                    } label: {
                        PremiumConversationRow(conversation: c)
                    }
                    // Custom press-feedback style. Drives the scale-on-press
                    // through SwiftUI's button configuration (the proper
                    // channel) instead of a competing simultaneous gesture
                    // — see comment in `PremiumConversationRow` for the
                    // history of that bug.
                    .buttonStyle(ConversationRowButtonStyle())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) {
                            UINotificationFeedbackGenerator().notificationOccurred(.warning)
                            pendingDelete = c
                        } label: {
                            Label {
                                Text("conversations.action.delete")
                            } icon: {
                                Image(systemName: "trash")
                            }
                        }
                    }
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
        .scrollIndicators(.hidden)
        .opacity(contentVisible ? 1 : 0)
        .refreshable { await viewModel.load() }
    }

    /// Premium empty state matching the design system pattern: glass
    /// medallion + heading + supporting line. No CTA because starting a
    /// conversation requires a target user, which lives on profile views.
    private var premiumEmptyState: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.16))
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.40), lineWidth: 1)
                    .frame(width: 72, height: 72)
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(spacing: 4) {
                Text("messages.empty.title")
                    .font(.system(size: 17, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                Text("messages.empty.message")
                    .font(.system(size: 14, weight: .regular, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .padding(.horizontal, 8)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(DSColor.surface)
                .shadow(color: Color.black.opacity(0.02), radius: 10, x: 0, y: 5)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .padding(.top, 12)
    }

    private func stagger() {
        let reduce = UIAccessibility.isReduceMotionEnabled
        if reduce { heroVisible = true; contentVisible = true; return }
        withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
            heroVisible = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.10) {
            withAnimation(.easeOut(duration: 0.35)) {
                contentVisible = true
            }
        }
    }
}

/// Subtle scale-on-press feedback for conversation rows. Drives the
/// "I pressed it" visual through SwiftUI's `ButtonStyle.Configuration`
/// — the canonical channel — instead of a competing `simultaneousGesture`
/// that races the cell's tap recognizer inside a `List + .swipeActions`
/// context (the original bug: the row's tap never reached the parent
/// `Button` so `onOpen(c)` never fired and the thread never pushed).
private struct ConversationRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.985 : 1.0)
            .animation(.spring(response: 0.25, dampingFraction: 0.78),
                       value: configuration.isPressed)
    }
}

/// Premium conversation row — gradient avatar disc + name/preview stack
/// + relative timestamp + unread accent dot. Glass-blur background with
/// a brighter lime border tint when the row carries unread messages so
/// the inbox is scannable.
///
/// Hit-target note: this view is wrapped in a `Button` by the parent
/// `ConversationsView` list. We define a `.contentShape(Rectangle())`
/// over the whole row so the gaps between the avatar and the text
/// remain tappable (otherwise SwiftUI's hit-test traces only the
/// rendered subviews, and the glass background — a `.fill(.ultraThinMaterial)`
/// behind a `RoundedRectangle` — registers as transparent for hit-testing).
/// We deliberately do NOT attach a `simultaneousGesture(DragGesture(minimumDistance: 0))`
/// for the press-scale effect — in `List` rows with `.swipeActions`, that
/// gesture races the cell's tap recognizer and the row stops navigating
/// (the original bug: tapping the row never pushed the thread). Press
/// feedback is driven by `ConversationRowButtonStyle` above.
private struct PremiumConversationRow: View {
    let conversation: ConversationSummary

    var body: some View {
        HStack(spacing: 12) {
            avatar
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(conversation.other_display_name)
                        .font(.system(size: 15, weight: .heavy, design: .default))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    Spacer()
                    if let t = conversation.last_message_at {
                        Text(timeAgo(t))
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(DSColor.textTertiary)
                    }
                }
                HStack(spacing: 6) {
                    Text(conversation.last_message_body ?? String(localized: "messages.start_conversation"))
                        .font(.system(size: 13, weight: conversation.unread ? .semibold : .regular))
                        .foregroundStyle(conversation.unread ? DSColor.textPrimary : DSColor.textSecondary)
                        .lineLimit(1)
                    Spacer()
                    if conversation.unread {
                        Circle()
                            .fill(DSColor.accent)
                            .frame(width: 9, height: 9)
                            .shadow(color: DSColor.accent.opacity(0.6), radius: 4)
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.surface)
                .shadow(color: Color.black.opacity(0.02), radius: 8, x: 0, y: 3)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(
                    conversation.unread
                        ? DSColor.accent.opacity(0.5)
                        : DSColor.border,
                    lineWidth: 1
                )
        )
        .contentShape(Rectangle())
    }

    /// Initials disc — the discovery payload doesn't include avatars
    /// today, so we render an initials disc with a hashed gradient so
    /// every contact has a stable, distinct colour.
    private var avatar: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: avatarColors,
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 46, height: 46)
            Text(initials(conversation.other_display_name))
                .font(.system(size: 15, weight: .heavy, design: .default))
                .foregroundStyle(DSColor.textOnAccent)
        }
        .overlay(
            Circle()
                .strokeBorder(DSColor.textOnAccent.opacity(0.10), lineWidth: 1)
        )
    }

    /// Two-colour gradient derived from the name's hash so the disc
    /// stays consistent across launches but doesn't require any
    /// per-user art from design. Every stop is mixed from the brand ramp
    /// (royal-blue accent + its soft variant + the lime-yellow secondary)
    /// rather than the old hardcoded rainbow `Color(hex:)` set — the discs
    /// stay distinct and stable while reading as on-brand instead of noise.
    private var avatarColors: [Color] {
        let seed = conversation.other_display_name.hash
        let palette: [[Color]] = [
            [DSColor.accent, DSColor.accentSoft],                 // royal blue → soft blue
            [DSColor.accent, DSColor.secondary],                  // royal blue → lime-yellow
            [DSColor.accentSoft, DSColor.secondary],              // soft blue → lime-yellow
            [DSColor.secondary, DSColor.accent],                  // lime-yellow → royal blue
            [DSColor.accentSoft, DSColor.accent],                 // soft blue → royal blue
        ]
        return palette[abs(seed) % palette.count]
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "?" : parts.joined()
    }
    private func timeAgo(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return "" }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f.localizedString(for: date, relativeTo: Date())
    }
}

private struct ConversationRowSkeleton: View {
    @State private var phase: CGFloat = -1
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(DSColor.surfaceElevated.opacity(0.7)).frame(width: 46, height: 46)
            VStack(alignment: .leading, spacing: 6) {
                Capsule().fill(DSColor.surfaceElevated.opacity(0.7))
                    .frame(width: 140, height: 12)
                Capsule().fill(DSColor.surfaceElevated.opacity(0.6))
                    .frame(width: 200, height: 11)
            }
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .overlay(
            LinearGradient(
                colors: [.clear, DSColor.accent.opacity(0.10), .clear],
                startPoint: .leading, endPoint: .trailing
            )
            .offset(x: phase * 200)
            .mask(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .allowsHitTesting(false)
        )
        .onAppear {
            guard !UIAccessibility.isReduceMotionEnabled else { return }
            withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) {
                phase = 1
            }
        }
    }
}

// MARK: - Voice recorder

/// Drives `AVAudioRecorder` for the chat composer's hold-to-record affordance.
/// Owns a single in-progress recording at a time; consumers observe
/// `isRecording` / `elapsed` / `cancelled` via `@Observable` and pull the
/// finished file URL out of `finish()`.
///
/// Hard-caps at 60s — `AVAudioRecorder.record(forDuration:)` stops the file
/// for us; the polling timer mirrors that into `elapsed` so the UI can wind
/// down with a real-time counter.
@Observable
@MainActor
final class VoiceRecorder: NSObject, AVAudioRecorderDelegate {
    /// True between `start()` succeeding and `finish()`/`cancel()` being called.
    /// The composer reads this to swap into the recording-overlay state.
    private(set) var isRecording = false
    /// Seconds elapsed in the active recording. Polled at ~10Hz off the main
    /// timer; cleared back to 0 after `finish()` returns or `cancel()` runs.
    private(set) var elapsed: TimeInterval = 0
    /// Flipped by the gesture-driven `cancel()` so the view can fade out the
    /// indicator. Cleared on the next `start()`.
    private(set) var cancelled = false

    /// Hard cap — recordings longer than this are auto-stopped by
    /// `AVAudioRecorder` itself. Keeps voice-message size predictable.
    private static let maxDuration: TimeInterval = 60

    private var recorder: AVAudioRecorder?
    /// Backing path for the current take. Re-derived on every `start()` so
    /// concurrent attempts don't trample each other.
    private var fileURL: URL?
    /// Repeating poll that bumps `elapsed`. Cancelled in `stop()`.
    @ObservationIgnored
    private var pollTask: Task<Void, Never>?

    /// Requests mic permission if not already granted, then starts a fresh
    /// `.m4a` recording at 22.05 kHz / 64 kbit/s AAC — a tight format that
    /// stays under ~480 KB for the 60s cap. Returns false if permission was
    /// denied or session setup failed; the caller should bail out silently.
    func start() async -> Bool {
        if isRecording { return true }
        let granted = await Self.requestPermission()
        guard granted else { return false }
        do {
            let session = AVAudioSession.sharedInstance()
            // `allowBluetooth` was renamed to `allowBluetoothHFP` in iOS 18.2.
            // Use the new spelling when available so the build stays clean
            // on newer SDKs; older iOS-18 ships the old name. Without one
            // of these flags the route picker hides BT-HFP headsets when
            // recording, which surprises users with AirPods in their ears.
            var options: AVAudioSession.CategoryOptions = [.defaultToSpeaker]
            if #available(iOS 18.2, *) {
                options.insert(.allowBluetoothHFP)
            }
            try session.setCategory(.playAndRecord, mode: .default, options: options)
            try session.setActive(true, options: [])
        } catch {
            return false
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 22_050.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            let rec = try AVAudioRecorder(url: url, settings: settings)
            rec.delegate = self
            rec.isMeteringEnabled = false
            guard rec.record(forDuration: Self.maxDuration) else { return false }
            recorder = rec
            fileURL = url
            isRecording = true
            cancelled = false
            elapsed = 0
            startPolling()
            return true
        } catch {
            return false
        }
    }

    /// Stops the recording and returns the audio file URL along with its
    /// duration. Returns `nil` if no recording was in flight or the file
    /// doesn't exist after stop — both treated as "nothing to send".
    /// The caller is responsible for cleaning up the file on disk.
    func finish() -> (url: URL, duration: TimeInterval)? {
        guard isRecording else { return nil }
        let duration = recorder?.currentTime ?? elapsed
        stop()
        guard let url = fileURL,
              FileManager.default.fileExists(atPath: url.path) else { return nil }
        fileURL = nil
        return (url, duration)
    }

    /// Aborts the recording, deletes the partial file, and flips `cancelled`
    /// so the composer can animate out. Safe to call when nothing's recording.
    func cancel() {
        guard isRecording else { return }
        let url = fileURL
        recorder?.stop()
        stop()
        if let url { try? FileManager.default.removeItem(at: url) }
        fileURL = nil
        cancelled = true
    }

    private func stop() {
        recorder?.stop()
        recorder = nil
        pollTask?.cancel()
        pollTask = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 100_000_000)
                guard let self else { return }
                if let t = self.recorder?.currentTime { self.elapsed = t }
            }
        }
    }

    /// Bridges the new `AVAudioApplication.requestRecordPermission` API
    /// (iOS 17+) and the older `AVAudioSession.requestRecordPermission`
    /// fallback. Awaited via continuations so the call sites can stay
    /// async/await all the way through.
    private static func requestPermission() async -> Bool {
        if #available(iOS 17, *) {
            if AVAudioApplication.shared.recordPermission == .granted { return true }
            return await withCheckedContinuation { cont in
                AVAudioApplication.requestRecordPermission { granted in
                    cont.resume(returning: granted)
                }
            }
        } else {
            let session = AVAudioSession.sharedInstance()
            if session.recordPermission == .granted { return true }
            return await withCheckedContinuation { cont in
                session.requestRecordPermission { granted in
                    cont.resume(returning: granted)
                }
            }
        }
    }

    // MARK: AVAudioRecorderDelegate
    // The 60s `forDuration:` cap routes through here when the recorder
    // auto-stops; we leave the file in place so a subsequent `finish()`
    // from a button-release picks it up. If recording aborted with an
    // error, treat the same as a cancel — the file may be corrupt.
    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            if !flag { self.cancel() }
            // Successful auto-stop: leave isRecording on so the gesture's
            // release handler still runs finish() and reads the file.
        }
    }
}

// MARK: - Thread view

/// Reused parser for `created_at` strings in the chat hot path. Allocating
/// a fresh `ISO8601DateFormatter` per call is surprisingly expensive — for
/// a 100-message thread the section builder used to spin one up *and* parse
/// every row on each body re-render (every keystroke in the composer). One
/// shared instance, accessed only on the main actor where the section
/// builder runs, removes that per-frame allocation.
@MainActor
private let chatISO8601Formatter = ISO8601DateFormatter()

/// Shared formatter for the "Mar 5" / "Mar 5, 2024" day-divider label. The
/// underlying `setLocalizedDateFormatFromTemplate` call is comparatively
/// pricey on each invocation, so we cache *two* configurations — one for
/// "this year", one for older — and pick between them at the call site.
@MainActor
private let chatDayFormatterCurrentYear: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale.current
    f.setLocalizedDateFormatFromTemplate("MMMd")
    return f
}()
@MainActor
private let chatDayFormatterOlder: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale.current
    f.setLocalizedDateFormatFromTemplate("MMMdyyyy")
    return f
}()

/// Local-only optimistic message. Rendered in the thread the instant the
/// user taps Send so the bubble appears with zero perceived latency. The
/// row sticks around until either (a) the server confirms — the canonical
/// `Message` arrives via the post-`send()` `load()` or the SSE drain in
/// `handle(_:)` — at which point we strip it by UUID, or (b) the API
/// errors and `status` flips to `.failed` so the bubble shows a Retry
/// affordance without forcing the user to retype. `id` is a fresh UUID so
/// it never collides with a server-issued id; `attachmentURL` is non-nil
/// for image sends.
struct PendingMessage: Identifiable, Hashable {
    enum Status: Hashable { case sending, failed }

    let id: UUID
    let body: String
    let attachmentURL: String?
    let attachmentType: MessageAttachmentType?
    let createdAt: Date
    var status: Status
}

@Observable
@MainActor
final class ConversationThreadViewModel {
    /// Local-only marker representing the timestamp the *current* user opened
    /// the thread. Messages newer than this should appear below an "Unread"
    /// separator until the user scrolls/reloads.
    private(set) var unreadCutoff: Date?

    /// One-shot upload state — flips to `true` during a multipart upload so the
    /// composer can swap the send affordance for a spinner.
    private(set) var isUploading = false

    private(set) var state: ViewState<ConversationThread> = .idle
    /// Optimistic outbound queue. A row is appended the moment the user
    /// invokes `send()` / `sendImage()`; it stays here until either the API
    /// confirms (then we drop the row by UUID — the canonical server copy
    /// has already folded into `state` via `load()` or the realtime drain)
    /// or the request fails (status flips to `.failed` and the bubble
    /// renders with a Retry button).
    private(set) var pendingMessages: [PendingMessage] = []

    /// Memoized day-bucketed render model. Recomputed only when `state`
    /// (the server thread) or `pendingMessages` actually mutate — see
    /// `recomputeSections()`. The view reads this directly so SwiftUI's
    /// body re-render (which fires on every keystroke in the composer)
    /// doesn't re-parse every `created_at` and re-sort the full thread.
    // `fileprivate` not `private(set)` because `DaySection` is a
    // file-private type — Swift refuses to expose a property whose
    // type's visibility is narrower than the property itself. The view
    // and the view-model live in the same file so file-scope is enough.
    fileprivate var sections: [DaySection] = []

    /// Current user's id, owned by the surrounding view but mirrored here
    /// so `recomputeSections()` can decide where the "Unread" separator
    /// belongs (it only goes above the first inbound message *not* from
    /// the current user). The view sets this once on appear; flipping it
    /// recomputes sections to keep the separator placement correct.
    var currentUserId: String? {
        didSet {
            guard oldValue != currentUserId else { return }
            recomputeSections()
        }
    }

    var draft: String = ""
    var isSending = false
    let conversationId: String
    private let apiClient: APIClient
    /// Optional realtime channel. When non-nil and `startRealtime()` is
    /// called, new `message` events for this conversation are folded into
    /// `state` without a refetch.
    private let realtime: RealtimeClient?
    /// Background task draining the realtime subscription. Held so we can
    /// cancel it from `deinit` and `stopRealtime`.
    ///
    /// `@ObservationIgnored` because the task handle is plumbing — no view
    /// observes it — and the `@Observable` macro otherwise tries to wrap
    /// it in tracking machinery that's incompatible with `nonisolated`.
    /// `nonisolated(unsafe)` is required so we can cancel the task from
    /// `deinit`, which Swift 6 treats as a non-isolated context even on
    /// `@MainActor` types; access is otherwise main-actor only so the
    /// lack of additional synchronization is safe.
    @ObservationIgnored
    private nonisolated(unsafe) var realtimeTask: Task<Void, Never>?

    init(apiClient: APIClient, conversationId: String, realtime: RealtimeClient? = nil) {
        self.apiClient = apiClient
        self.conversationId = conversationId
        self.realtime = realtime
    }

    deinit {
        // Drop the realtime drain when the thread view goes away. Cancelling
        // the Task terminates the inner `for await`, which calls the stream's
        // onTermination and removes our subscriber slot in the actor.
        realtimeTask?.cancel()
    }

    /// Subscribe to the realtime channel and merge incoming messages into
    /// the thread. Safe to call multiple times; only the first call
    /// actually spawns a drain task.
    func startRealtime() {
        guard realtimeTask == nil, let realtime else { return }
        realtimeTask = Task { [weak self] in
            // `subscribe()` is actor-isolated on RealtimeClient and returns
            // synchronously inside the actor — we only `await` the hop.
            let stream = await realtime.subscribe()
            for await event in stream {
                guard let self else { return }
                if Task.isCancelled { return }
                // We're on the main actor here (the enclosing Task inherits
                // isolation from this method's @MainActor context), so the
                // call to `handle` is synchronous — no `await` needed.
                self.handle(event)
            }
        }
    }

    /// Fold a realtime event into local state.
    /// Currently only `.message` events for the active conversation are
    /// applied; everything else is ignored (notifications surface
    /// elsewhere).
    var isOtherTyping = false
    private var lastTypingSentAt: Date?

    func sendTypingStatus(isTyping: Bool) {
        if isTyping {
            if let last = lastTypingSentAt, Date().timeIntervalSince(last) < 2.0 {
                return
            }
            lastTypingSentAt = Date()
        }
        Task {
            do {
                _ = try await apiClient.send(.sendTypingStatus(id: conversationId, isTyping: isTyping))
            } catch {
                // ignore network failures for typing indicator
            }
        }
    }

    func markRead() {
        Task {
            do {
                _ = try await apiClient.send(.markConversationRead(id: conversationId))
            } catch {
                // ignore
            }
        }
    }

    private func handle(_ event: RealtimeEvent) {
        guard case .loaded(let thread) = state else { return }
        switch event {
        case .message(let payload):
            guard payload.conversation_id == conversationId else { return }
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
            state = .loaded(merged)
            recomputeSections()

        case .typing(let payload):
            guard payload.conversation_id == conversationId,
                  payload.user_id != currentUserId else { return }
            isOtherTyping = payload.is_typing

        case .readReceipt(let payload):
            guard payload.conversation_id == conversationId,
                  payload.user_id != currentUserId else { return }
            let merged = ConversationThread(
                conversation_id: thread.conversation_id,
                other_user_id: thread.other_user_id,
                other_display_name: thread.other_display_name,
                other_last_read_at: payload.last_read_at,
                messages: thread.messages
            )
            state = .loaded(merged)
            recomputeSections()

        default:
            break
        }
    }

    func load() async {
        let firstLoad: Bool = {
            if case .loaded = state { return false } else { return true }
        }()
        if firstLoad { state = .loading }
        guard UUID(uuidString: conversationId) != nil else {
            state = .error(message: String(localized: "api.error.not_found"))
            return
        }
        do {
            let thread = try await apiClient.send(.conversationThread(id: conversationId))
            if firstLoad {
                // Anchor the unread separator at the moment the user opens
                // the thread for the first time. Subsequent reloads keep the
                // same anchor so previously-seen messages don't "re-unread".
                unreadCutoff = lastOtherTimestamp(thread)
            }
            state = .loaded(thread)
            recomputeSections()
        } catch is CancellationError { return }
        catch let error as APIError { state = .error(message: error.errorDescription ?? String(localized: "messages.error.load_thread")) }
        catch { state = .error(message: error.localizedDescription) }
    }

    /// Returns the timestamp of the most recent message from the *other*
    /// party. We don't bother with messages I sent because they can't be
    /// "unread to me".
    private func lastOtherTimestamp(_ thread: ConversationThread) -> Date? {
        return thread.messages.reversed().first(where: { $0.sender_user_id == thread.other_user_id })
            .flatMap { chatISO8601Formatter.date(from: $0.created_at) }
    }

    func send() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !isSending else { return }
        // Optimistic: append the pending row *before* the API call so the
        // bubble lands in the thread the moment the user taps Send. Clear
        // the draft on the same tick so the composer empties immediately —
        // a failure leaves the row in `pendingMessages` with `.failed` and
        // a Retry affordance, so we don't need the draft text anymore.
        let pending = PendingMessage(
            id: UUID(),
            body: body,
            attachmentURL: nil,
            attachmentType: nil,
            createdAt: Date(),
            status: .sending,
        )
        pendingMessages.append(pending)
        recomputeSections()
        draft = ""
        await performSend(pendingID: pending.id, body: body)
    }

    /// Uploads `imageData` and posts a message referencing the returned URL.
    /// `caption` is the current text in the composer; if non-empty it travels
    /// with the image as the message body, otherwise the message is
    /// image-only. The optimistic bubble cannot land until the upload
    /// resolves (we don't yet have the URL), so the row is appended *after*
    /// the upload but *before* the message POST — this is still instant
    /// versus the user-perceived "send tap" for text-only sends, and only
    /// pays the upload latency when an image is attached.
    func sendImage(_ imageData: Data, mimeType: String) async {
        guard !isUploading, !isSending else { return }
        isUploading = true
        defer { isUploading = false }
        let caption = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let upload = try await apiClient.uploadImage(
                imageData: imageData,
                mimeType: mimeType,
                filename: "photo.\(mimeType == "image/png" ? "png" : "jpg")",
            )
            let pending = PendingMessage(
                id: UUID(),
                body: caption,
                attachmentURL: upload.url,
                attachmentType: .image,
                createdAt: Date(),
                status: .sending,
            )
            pendingMessages.append(pending)
            recomputeSections()
            draft = ""
            await performSendImage(
                pendingID: pending.id,
                attachmentUrl: upload.url,
                caption: caption,
            )
        } catch {
            // Upload itself failed — no pending row to flip, so we just bail.
            // A future iteration can surface a toast here.
        }
    }

    /// Re-attempts a previously-failed pending message. Flips the row back
    /// to `.sending` so the bubble swaps its red exclamation for the gray
    /// clock again, then re-runs the appropriate POST. On success the row
    /// is dropped (the server copy will have landed); on failure the row
    /// flips back to `.failed` so the user can try once more.
    func retry(_ pendingID: UUID) async {
        guard let pending = pendingMessages.first(where: { $0.id == pendingID }) else { return }
        // Reset the visible status so the bubble animates back to "sending".
        updatePending(pendingID) { $0.status = .sending }
        if let url = pending.attachmentURL, pending.attachmentType == .image {
            await performSendImage(pendingID: pendingID, attachmentUrl: url, caption: pending.body)
        } else {
            await performSend(pendingID: pendingID, body: pending.body)
        }
    }

    /// Shared inner step for text-only sends. Pulled out so `retry()` can
    /// re-run the same path without duplicating the success / failure flip.
    private func performSend(pendingID: UUID, body: String) async {
        isSending = true
        defer { isSending = false }
        do {
            _ = try await apiClient.send(.sendMessage(conversationId: conversationId, body: body))
            // Server accepted — drop the optimistic row. The canonical copy
            // is brought in by the subsequent `load()` (or the SSE drain).
            pendingMessages.removeAll { $0.id == pendingID }
            recomputeSections()
            await load()
        } catch is CancellationError {
            // Surface as failure so the user has a Retry path; we don't
            // know whether the request actually landed.
            updatePending(pendingID) { $0.status = .failed }
        } catch {
            updatePending(pendingID) { $0.status = .failed }
        }
    }

    /// Shared inner step for image sends. Skips the upload (the caller
    /// already has a hosted URL) so this is reusable from `retry()` —
    /// the photo bytes aren't kept around after the initial upload.
    private func performSendImage(pendingID: UUID, attachmentUrl: String, caption: String) async {
        do {
            _ = try await apiClient.send(.sendImageMessage(
                conversationId: conversationId,
                attachmentUrl: attachmentUrl,
                caption: caption,
            ))
            pendingMessages.removeAll { $0.id == pendingID }
            recomputeSections()
            await load()
        } catch is CancellationError {
            updatePending(pendingID) { $0.status = .failed }
        } catch {
            updatePending(pendingID) { $0.status = .failed }
        }
    }

    /// In-place mutation helper for `pendingMessages`. Pulls the row by id,
    /// applies the mutation, and writes it back. No-op if the row was
    /// removed in the meantime (e.g. a parallel success).
    private func updatePending(_ id: UUID, _ mutate: (inout PendingMessage) -> Void) {
        guard let idx = pendingMessages.firstIndex(where: { $0.id == id }) else { return }
        var row = pendingMessages[idx]
        mutate(&row)
        pendingMessages[idx] = row
        // The pending row's content (status) is encoded into the cached
        // `DaySection.Entry`, so the memo has to refresh — otherwise a
        // .sending → .failed flip wouldn't surface to the bubble.
        recomputeSections()
    }

    /// 60-second grouping window for the "consecutive bubble" cluster. WhatsApp
    /// uses ~30s, iMessage ~60s — this matches the spec. Mirrored on the view
    /// model so the section builder doesn't have to reach back into the view.
    private static let bubbleClusterWindow: TimeInterval = 60

    /// Rebuild the cached day-bucketed render model from the current
    /// `state` + `pendingMessages`. Called from every mutation site that
    /// changes either input — never from the view, so the body re-render
    /// hot path (every composer keystroke) does no work here.
    private func recomputeSections() {
        guard case .loaded(let thread) = state else {
            sections = []
            return
        }
        sections = Self.buildSections(
            messages: thread.messages,
            pending: pendingMessages,
            unreadCutoff: unreadCutoff,
            currentUserId: currentUserId,
        )
    }

    /// Pure section builder. Reads no view-model state — all inputs are
    /// passed in — so it's safe to call from `recomputeSections()` (and
    /// trivial to unit-test). The previous implementation lived on the
    /// view and allocated a fresh `ISO8601DateFormatter` on every body
    /// re-render; we now hoist that into `chatISO8601Formatter` and only
    /// run this on actual data mutations.
    // `fileprivate` matches the `DaySection` return type's visibility —
    // see the `sections` property comment above.
    fileprivate static func buildSections(
        messages: [Message],
        pending: [PendingMessage],
        unreadCutoff: Date?,
        currentUserId: String?,
    ) -> [DaySection] {
        // Single sorted stream of "row" entries. We tag each row with the
        // date it sorts by, so server messages (created_at strings) and
        // optimistic pending rows (`createdAt: Date`) interleave correctly
        // — a pending bubble newly tapped at 12:34:56 lands right after a
        // server message stamped 12:34:50 even if the network hop hasn't
        // brought it back yet. Pending rows always come from the current
        // user, so they never trigger the unread separator.
        enum Row {
            case server(Message, Date)
            case pending(PendingMessage)

            var date: Date {
                switch self {
                case .server(_, let d): return d
                case .pending(let p): return p.createdAt
                }
            }

            var sender: String {
                switch self {
                case .server(let m, _): return m.sender_user_id
                case .pending: return "__pending__"
                }
            }
        }
        var rows: [Row] = []
        rows.reserveCapacity(messages.count + pending.count)
        for m in messages {
            rows.append(.server(m, chatISO8601Formatter.date(from: m.created_at) ?? Date()))
        }
        for p in pending {
            rows.append(.pending(p))
        }
        // Stable sort by timestamp so equal-time rows keep their original
        // relative order (server-first, then pending — matters when the
        // pending row was just confirmed and a near-simultaneous server
        // row also exists).
        rows.sort { $0.date < $1.date }

        // Pre-compute per-row group flags before bucketing into day sections.
        // A "group" is a run of consecutive same-sender rows whose timestamps
        // sit within `bubbleClusterWindow` of each other AND don't straddle a
        // day boundary. Day boundaries get their own visual break already, so
        // we don't want a cluster to span across the divider.
        let cal = Calendar.current
        var isFirst = [Bool](repeating: true, count: rows.count)
        var isLast = [Bool](repeating: true, count: rows.count)
        if rows.count > 1 {
            for i in 1..<rows.count {
                let prev = rows[i - 1]
                let curr = rows[i]
                let sameSender = prev.sender == curr.sender
                let sameDay = cal.isDate(prev.date, inSameDayAs: curr.date)
                let withinWindow = curr.date.timeIntervalSince(prev.date) <= bubbleClusterWindow
                if sameSender && sameDay && withinWindow {
                    isFirst[i] = false
                    isLast[i - 1] = false
                }
            }
        }

        var sections: [DaySection] = []
        var currentKey: Date?
        var bucket = DaySection(label: "", entries: [])
        var insertedSeparator = false

        for (i, row) in rows.enumerated() {
            let dayStart = cal.startOfDay(for: row.date)
            if currentKey != dayStart {
                if currentKey != nil { sections.append(bucket) }
                currentKey = dayStart
                bucket = DaySection(label: dayLabel(dayStart), entries: [])
            }
            switch row {
            case .server(let m, _):
                // Insert the unread separator immediately BEFORE the first
                // message newer than the cutoff captured on entry — and only
                // if that message wasn't authored by us. Pending rows are
                // always ours, so the check below handles that implicitly.
                if !insertedSeparator,
                   let unreadCutoff,
                   row.date > unreadCutoff,
                   m.sender_user_id != currentUserId
                {
                    bucket.entries.append(.unreadSeparator)
                    insertedSeparator = true
                }
                bucket.entries.append(.message(m, isFirstInGroup: isFirst[i], isLastInGroup: isLast[i]))
            case .pending(let p):
                bucket.entries.append(.pendingMessage(p))
            }
        }
        if currentKey != nil { sections.append(bucket) }
        return sections
    }

    /// Day-divider label. Static so the section builder stays a pure
    /// function — and uses the file-scope cached formatters so we don't
    /// pay `setLocalizedDateFormatFromTemplate` on every divider.
    static func dayLabel(_ day: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(day) { return String(localized: "chat.divider.today") }
        if cal.isDateInYesterday(day) { return String(localized: "chat.divider.yesterday") }
        let f = cal.isDate(day, equalTo: Date(), toGranularity: .year)
            ? chatDayFormatterCurrentYear
            : chatDayFormatterOlder
        return f.string(from: day)
    }

    /// Uploads an m4a/aac voice clip and posts a `voice`-typed attachment
    /// message. Re-uses the existing `/api/v1/messages/upload-image` endpoint
    /// (despite the name, it's the multipart sink the backend accepts) — the
    /// returned URL is sent through to `/conversations/:id/messages` with
    /// `attachment_type: "voice"`, which the backend already understands
    /// (see messages.service.ts attachment_type enum).
    ///
    /// `fileURL` is a temp file produced by `VoiceRecorder`; we read it
    /// into memory and then attempt to delete it after the call returns.
    /// Bails silently on failure — UI-side a future iteration can show a toast.
    func sendVoice(fileURL: URL, mimeType: String = "audio/m4a") async {
        guard !isUploading, !isSending else { return }
        isUploading = true
        defer {
            isUploading = false
            try? FileManager.default.removeItem(at: fileURL)
        }
        guard let data = try? Data(contentsOf: fileURL), !data.isEmpty else { return }
        do {
            let upload = try await apiClient.uploadImage(
                imageData: data,
                mimeType: mimeType,
                filename: "voice.m4a",
            )
            _ = try await apiClient.send(Endpoint<Message>(
                method: .post,
                path: "/api/v1/conversations/\(conversationId)/messages",
                body: try? JSONSerialization.data(withJSONObject: [
                    "attachment_url": upload.url,
                    "attachment_type": "voice",
                ]),
                requiresAuth: true,
            ))
            await load()
        } catch {
            // Quiet failure — the recording is already discarded by the
            // deferred remove. A future iteration can surface a retry toast.
        }
    }
}

struct ConversationThreadView: View {
    @State var viewModel: ConversationThreadViewModel
    let currentUserId: String?
    @FocusState private var inputFocused: Bool

    /// PhotosPicker selection. Mutated by the system; we observe via
    /// `.onChange` and translate into an upload.
    @State private var pickedItem: PhotosPickerItem?

    /// Hold-to-record state for the mic button. Owns the AVAudioRecorder
    /// session and surfaces a `elapsed` counter so the overlay can show a
    /// live timer. Kept here (rather than on the view model) because the
    /// recording lifecycle is purely a composer-affordance concern — no
    /// realtime / API state cares about it until the file is shipped.
    @State private var recorder = VoiceRecorder()
    /// Horizontal drag distance while the user holds the mic. Negative
    /// values indicate "swiped left toward the trash"; once it crosses the
    /// cancel threshold (-100pt) we cancel on release.
    @State private var dragOffset: CGFloat = 0
    /// Set when a long-press has armed the recorder. We then wait for the
    /// recorder's permission/setup to flip `isRecording`; the drag gesture
    /// only matters once recording is actually live.
    @State private var armed = false
    private static let cancelThreshold: CGFloat = -100

    /// True when the scroll view is parked at (or near) the bottom of the
    /// thread. Drives visibility of the floating scroll-to-bottom button and
    /// the "N new messages" pill. Initial state is `true` — we open threads
    /// scrolled to the latest message, so we shouldn't flash the affordance
    /// before the first scroll-geometry callback fires.
    @State private var isAtBottom = true
    /// Tally of messages that arrived from the realtime / refetch path while
    /// the user was scrolled up. Reset to zero whenever we either return to
    /// the bottom or the user taps the pill. Read by the "%d new messages"
    /// affordance — never displayed when `isAtBottom == true`.
    @State private var unseenCount = 0
    /// ID of the last *server* message we've already counted toward
    /// `unseenCount`. Without this, an `.onChange(messages.count)` listener
    /// would treat every re-render as a new message and overcount.
    @State private var lastSeenMessageID: String?

    /// 60-second grouping window for the "consecutive bubble" cluster. WhatsApp
    /// uses ~30s, iMessage ~60s — this matches the spec.
    private static let bubbleClusterWindow: TimeInterval = 60
    /// Pixels from the bottom edge of the content we still consider "at
    /// bottom". Padding + keyboard nudges easily push past 0pt of distance,
    /// so we give some slack before the floating affordance pops in.
    private static let scrollBottomEpsilon: CGFloat = 32

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            VStack(spacing: 0) {
                messages
                composer
            }
        }
        // Title/avatar live in the native nav bar (principal toolbar item)
        // instead of a hand-rolled in-content header — see FAZA 45 §13.4
        // (native chrome, inline display mode). `.navigationTitle` supplies
        // the accessibility/back-affordance label; the principal item draws
        // the avatar + name to match the rest of the app's pushed details.
        .navigationTitle(threadDisplayName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                threadTitle
            }
        }
        .task {
            // Mirror the current user id onto the view model so its
            // memoized section builder can place the "Unread" separator
            // correctly (only above inbound messages from the *other*
            // party). Done here — once, on entry — so the view body
            // re-render path stays read-only against the view model.
            viewModel.currentUserId = currentUserId
            // Track active conversation for in-app notification toasts suppression
            InAppNotificationNotifier.shared.activeConversationId = viewModel.conversationId
            // Kick off realtime *before* the REST load so we don't miss
            // messages that land between the two. The first load() pulls
            // current state; subsequent live events fold in via the
            // dedupe-by-id path in the view model.
            viewModel.startRealtime()
            await viewModel.load()
            viewModel.markRead()
        }
        .onDisappear {
            InAppNotificationNotifier.shared.activeConversationId = nil
        }
        .onChange(of: pickedItem) { _, newItem in
            guard let newItem else { return }
            Task { await handlePicked(newItem) }
        }
    }

    /// Plain-text title backing `.navigationTitle` — drives the
    /// accessibility label and the back-button affordance on the pushed
    /// stack. The visible avatar + name are drawn by `threadTitle` in the
    /// principal toolbar slot.
    private var threadDisplayName: String {
        if case .loaded(let t) = viewModel.state { return t.other_display_name }
        return ""
    }

    /// Principal nav-bar content — compact avatar disc + name. Replaces the
    /// former in-content `threadHeader`; sits inline in the system nav bar
    /// so we keep native back-swipe, long-press-back, and status-bar
    /// tap-to-top. The avatar mirrors the inbox row's brand-ramp disc.
    @ViewBuilder
    private var threadTitle: some View {
        if case .loaded(let t) = viewModel.state {
            HStack(spacing: DSSpacing.xs) {
                ZStack {
                    Circle().fill(LinearGradient(
                        colors: [DSColor.accent, DSColor.accentSoft],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )).frame(width: 28, height: 28)
                    Text(initials(t.other_display_name))
                        .font(.system(size: 11, weight: .bold, design: .default))
                        .foregroundStyle(DSColor.textOnAccent)
                }
                Text(t.other_display_name)
                    .font(.system(.headline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .combine)
        }
    }

    @ViewBuilder
    private var messages: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView().frame(maxHeight: .infinity)
        case .loaded(let thread):
            loadedScroll(thread)
        case .empty:
            EmptyStateView(icon: "bubble.left",
                           title: String(localized: "messages.thread.empty.title"),
                           message: String(localized: "messages.thread.empty.message"))
                .frame(maxHeight: .infinity)
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
                .frame(maxHeight: .infinity)
        }
    }

    /// Loaded-state thread body. Pulled out as its own helper so the
    /// section building, scroll proxy, and floating affordances all share
    /// a single `proxy` capture — and so the switch above stays readable.
    @ViewBuilder
    private func loadedScroll(_ thread: ConversationThread) -> some View {
        // Read the memoized model. Recomputed by the view model only when
        // `state` or `pendingMessages` mutate — body re-renders (every
        // keystroke in the composer) just snapshot the cached array.
        let sections = viewModel.sections
        // Find the trailing own-message id so MessageBubble can decide
        // whether to render the "Seen"/"Sent" footer underneath it. Only
        // the *true tail* gets a status footer — once the other party
        // replies, the marker moves with them.
        let lastOwnMessageID: String? = thread.messages.last(where: { $0.sender_user_id == currentUserId })?.id

        ScrollViewReader { proxy in
            ZStack(alignment: .bottomTrailing) {
                ScrollView {
                    LazyVStack(spacing: DSSpacing.xs) {
                        ForEach(sections, id: \.self) { section in
                            DayDivider(label: section.label)
                                .padding(.top, DSSpacing.sm)
                            ForEach(section.entries, id: \.self) { entry in
                                row(entry, lastOwnMessageID: lastOwnMessageID, otherLastReadAt: thread.other_last_read_at)
                            }
                        }
                        // Typing indicator placeholder — UI only; tied to a
                        // future presence channel.
                        if showTypingIndicator(thread) {
                            TypingIndicator(name: thread.other_display_name)
                                .padding(.top, 4)
                        }
                        // Sentinel anchor for the scroll-to-bottom button.
                        // Zero-height marker we can `scrollTo` by id —
                        // separate from the trailing message because that
                        // row's id is volatile (server payloads churn).
                        Color.clear
                            .frame(height: 1)
                            .id("thread-bottom-anchor")
                    }
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.vertical, DSSpacing.sm)
                }
                // iOS 18+: cheap, GPU-driven hook to learn when the
                // visible rect's bottom is within `epsilon` of the
                // content's bottom. We use `containerSize.height -
                // (contentOffset.y + bounds.height)`-equivalent math
                // via the helper below.
                .onScrollGeometryChange(for: Bool.self) { geo in
                    let distanceFromBottom = (geo.contentSize.height + geo.contentInsets.bottom)
                        - (geo.contentOffset.y + geo.containerSize.height)
                    return distanceFromBottom < Self.scrollBottomEpsilon
                } action: { _, atBottom in
                    isAtBottom = atBottom
                    if atBottom { unseenCount = 0 }
                }
                .onChange(of: thread.messages.count) { _, _ in
                    handleNewMessages(thread, proxy: proxy)
                }
                // Snap to a freshly-appended pending row too — otherwise
                // optimistic bubbles can land off-screen for users who've
                // scrolled up in the thread. Pending rows are always ours,
                // so this is always desired (no "stay scrolled up" case).
                .onChange(of: viewModel.pendingMessages.count) { _, _ in
                    if let last = viewModel.pendingMessages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
                .onChange(of: inputFocused) { _, focused in
                    // Keyboard came up — keep the latest message visible.
                    guard focused, let last = thread.messages.last else { return }
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
                .onAppear {
                    if let last = thread.messages.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                    lastSeenMessageID = thread.messages.last?.id
                }

                // Floating jump-to-bottom + unseen pill. Stacked vertically
                // (pill above the arrow) so a single bottomTrailing anchor
                // positions both at once.
                if !isAtBottom {
                    scrollToBottomCluster(proxy: proxy)
                        .padding(.trailing, DSSpacing.md)
                        .padding(.bottom, DSSpacing.sm)
                        .transition(.opacity.combined(with: .scale(scale: 0.85, anchor: .bottomTrailing)))
                }
            }
            .animation(.easeInOut(duration: 0.18), value: isAtBottom)
            .animation(.easeInOut(duration: 0.18), value: unseenCount)
        }
    }

    /// Renders one row of the LazyVStack. Hoisted so the body of the
    /// switch is small and easy to read.
    @ViewBuilder
    private func row(_ entry: DaySection.Entry, lastOwnMessageID: String?, otherLastReadAt: String?) -> some View {
        switch entry {
        case .message(let m, let isFirstInGroup, let isLastInGroup):
            MessageBubble(
                message: m,
                isMine: m.sender_user_id == currentUserId,
                isFirstInGroup: isFirstInGroup,
                isLastInGroup: isLastInGroup,
                isLastOwnMessage: m.id == lastOwnMessageID,
                readReceipt: readReceipt(for: m, lastOwnMessageID: lastOwnMessageID, otherLastReadAt: otherLastReadAt),
            )
            .id(m.id)
            // Tight when in the middle of a same-sender cluster,
            // looser between clusters / authors. WhatsApp uses ~2pt
            // intra-cluster, ~8pt inter — we mirror that here using
            // negative top padding to overcome the LazyVStack spacing.
            .padding(.top, isFirstInGroup ? 0 : -(DSSpacing.xs - 2))
        case .pendingMessage(let p):
            // Optimistic bubble — anchored on the local UUID so the
            // auto-scroll target tracks it the moment the row appears,
            // before the server confirms.
            PendingMessageBubble(pending: p) {
                Task { await viewModel.retry(p.id) }
            }
            .id(p.id)
        case .unreadSeparator:
            UnreadSeparator()
                .id("unread-separator")
        }
    }

    /// Read-receipt label rendered under the very last own message. Currently
    /// always returns `.sent` because the backend ships no `read_at` /
    /// `seen_at` field on Message — once that lands, swap the body for a
    /// real comparison against the other party's "last seen" timestamp on
    /// the conversation.
    ///
    /// TODO(read-receipts, backend): Add `Message.read_at` (or a per-conversation
    /// `other_last_read_at` on `ConversationThread`) and flip this to return
    /// `.seen` when the timestamp post-dates `message.created_at`.
    private func readReceipt(for message: Message, lastOwnMessageID: String?, otherLastReadAt: String?) -> ChatReadReceipt? {
        guard message.id == lastOwnMessageID else { return nil }
        guard message.sender_user_id == currentUserId else { return nil }
        if let otherLastReadAt,
           let readDate = chatISO8601Formatter.date(from: otherLastReadAt),
           let messageDate = chatISO8601Formatter.date(from: message.created_at) {
            return readDate >= messageDate ? .seen : .sent
        }
        return .sent
    }

    /// Pill + arrow button stack at the bottom-right of the scroll view.
    /// Tapping anywhere on either piece scrolls to the bottom and zeros the
    /// new-message counter.
    @ViewBuilder
    private func scrollToBottomCluster(proxy: ScrollViewProxy) -> some View {
        VStack(spacing: 8) {
            if unseenCount > 0 {
                Button {
                    jumpToBottom(proxy: proxy)
                } label: {
                    NewMessagesPill(count: unseenCount)
                }
                .buttonStyle(.plain)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            Button {
                jumpToBottom(proxy: proxy)
            } label: {
                ScrollToBottomChip()
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("chat.action.scroll_to_bottom"))
        }
    }

    /// Fold a count-bump from `thread.messages.count` into the unseen
    /// counter / scroll position. When parked at the bottom, we always
    /// follow new messages; when scrolled up, we only follow our own
    /// optimistic-confirmed messages so the user's read position isn't
    /// stolen.
    private func handleNewMessages(_ thread: ConversationThread, proxy: ScrollViewProxy) {
        guard let last = thread.messages.last else { return }
        if isAtBottom {
            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
            unseenCount = 0
            viewModel.markRead()
        } else if last.sender_user_id == currentUserId {
            // We just sent something while parked offscreen — still snap.
            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
            unseenCount = 0
        } else if last.id != lastSeenMessageID {
            // Real new inbound while scrolled up. Increment by the number
            // of messages newer than the last-seen marker — a single SSE
            // event normally bumps by one, but a refetch can replay several.
            let newCount: Int
            if let anchor = lastSeenMessageID,
               let anchorIdx = thread.messages.firstIndex(where: { $0.id == anchor })
            {
                newCount = max(0, thread.messages.count - (anchorIdx + 1))
            } else {
                newCount = 1
            }
            unseenCount += newCount
        }
        lastSeenMessageID = last.id
    }

    /// Smooth scroll back to the bottom anchor and clear the unseen
    /// counter. Used by both the arrow and the pill.
    private func jumpToBottom(proxy: ScrollViewProxy) {
        withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) {
            proxy.scrollTo("thread-bottom-anchor", anchor: .bottom)
        }
        unseenCount = 0
    }

    private var composer: some View {
        // Two stacked rows — the recording banner only takes layout while
        // a recording is in flight, so the input row never jumps when the
        // mic is idle. Outer VStack keeps the background flush against
        // the safe area.
        VStack(spacing: 0) {
            if recorder.isRecording {
                recordingBanner
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            composerRow
        }
        .background(DSColor.background)
        .animation(.easeInOut(duration: 0.18), value: recorder.isRecording)
    }

    private var composerRow: some View {
        HStack(spacing: DSSpacing.sm) {
            // Image-pick affordance — left of the text field. Tapping presents
            // the photo library; once a photo is chosen `onChange(of:pickedItem)`
            // fires the upload + send.
            PhotosPicker(selection: $pickedItem,
                         matching: .images,
                         photoLibrary: .shared()) {
                ZStack {
                    Circle()
                        .fill(DSColor.surfaceElevated)
                        .frame(width: 38, height: 38)
                    Image(systemName: "photo")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }
            }
            .disabled(viewModel.isUploading || viewModel.isSending || recorder.isRecording)
            .opacity(recorder.isRecording ? 0.35 : 1)
            .accessibilityLabel(Text("messages.attach_image"))

            TextField("", text: $viewModel.draft, prompt: Text("messages.composer.placeholder")
                .foregroundStyle(DSColor.textTertiary), axis: .vertical)
                .lineLimit(1...4)
                .focused($inputFocused)
                .foregroundStyle(DSColor.textPrimary)
                .padding(.horizontal, DSSpacing.md)
                .padding(.vertical, DSSpacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(DSColor.surfaceElevated)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(DSColor.border, lineWidth: 1)
                )
                .disabled(recorder.isRecording)
                .onChange(of: viewModel.draft) { _, newValue in
                    let isTyping = !newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    viewModel.sendTypingStatus(isTyping: isTyping)
                }
                .accessibilityLabel(Text("messages.composer.placeholder"))
                .accessibilityHint(Text("a11y.composer.hint"))
                .opacity(recorder.isRecording ? 0.35 : 1)

            trailingActionButton
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.bottom, DSSpacing.sm)
    }

    /// Send arrow when the draft has text; otherwise the hold-to-record mic.
    /// Swapped via `if/else` so the mic gesture state is recreated only
    /// when the input transitions between empty and non-empty (rare).
    @ViewBuilder
    private var trailingActionButton: some View {
        if viewModel.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            micButton
        } else {
            sendButton
        }
    }

    private var sendButton: some View {
        Button {
            Task { await viewModel.send() }
        } label: {
            ZStack {
                Circle().fill(DSColor.accent).frame(width: 44, height: 44)
                if viewModel.isSending || viewModel.isUploading {
                    ProgressView().tint(DSColor.textOnAccent).controlSize(.small)
                } else {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(DSColor.textOnAccent)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(viewModel.isSending || viewModel.isUploading)
        // Previously "Send image" — but this button posts text from
        // the composer draft (image uploads happen automatically
        // inside the PhotosPicker `onChange`, not via a tap here).
        // VoiceOver users were hearing the wrong action.
        .accessibilityLabel(Text("a11y.send_message"))
    }

    /// Hold-to-record mic. SwiftUI doesn't ship a clean "hold AND drag"
    /// gesture, so we use a `LongPressGesture` (to arm the recorder)
    /// simultaneously with a `DragGesture` (to track the slide-to-cancel
    /// offset). `simultaneously` is required: a `sequenced` chain wouldn't
    /// let the drag start until the long-press *ended*, which is the
    /// opposite of what we want.
    private var micButton: some View {
        let drag = DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard recorder.isRecording else { return }
                // Clamp positive translation to 0 — we only care about
                // leftward swipes for the cancel affordance.
                dragOffset = min(0, value.translation.width)
            }
            .onEnded { _ in
                onMicRelease()
            }
        let press = LongPressGesture(minimumDuration: 0.15)
            .onEnded { _ in
                onMicLongPress()
            }
        return ZStack {
            Circle()
                .fill(recorder.isRecording ? DSColor.accent : DSColor.surfaceElevated)
                .frame(width: 44, height: 44)
                .overlay(
                    Circle().strokeBorder(DSColor.border, lineWidth: 1)
                        .opacity(recorder.isRecording ? 0 : 1)
                )
                .scaleEffect(recorder.isRecording ? 1.25 : 1)
            if viewModel.isUploading {
                ProgressView().tint(DSColor.accent).controlSize(.small)
            } else {
                Image(systemName: "mic.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(recorder.isRecording ? DSColor.textOnAccent : DSColor.accent)
            }
        }
        .contentShape(Circle())
        .animation(.spring(response: 0.25, dampingFraction: 0.7), value: recorder.isRecording)
        .gesture(press.simultaneously(with: drag))
        .accessibilityLabel(Text("messages.voice.send"))
        .accessibilityHint(Text("messages.voice.hold_to_record"))
        .disabled(viewModel.isUploading || viewModel.isSending)
    }

    /// Banner shown above the input row while a recording is in flight.
    /// Pulsing red dot, live timer, and a slide-to-cancel hint whose
    /// opacity dims as the user drags left. Once the drag crosses the
    /// cancel threshold the dot turns grey and the hint colour shifts
    /// to red — releasing there cancels the take.
    private var recordingBanner: some View {
        let willCancel = dragOffset <= Self.cancelThreshold
        return HStack(spacing: DSSpacing.sm) {
            ZStack {
                Circle()
                    .fill(willCancel ? DSColor.textTertiary : DSColor.danger)
                    .frame(width: 10, height: 10)
                Circle()
                    .stroke(willCancel ? DSColor.textTertiary : DSColor.danger, lineWidth: 1)
                    .frame(width: 18, height: 18)
                    .opacity(willCancel ? 0 : 0.4)
                    .scaleEffect(willCancel ? 1 : 1.4)
                    .animation(
                        UIAccessibility.isReduceMotionEnabled
                            ? nil
                            : .easeInOut(duration: 0.9).repeatForever(autoreverses: true),
                        value: recorder.isRecording
                    )
            }
            Text("messages.voice.recording")
                .font(.system(.footnote, design: .default, weight: .semibold))
                .foregroundStyle(DSColor.textPrimary)
            Text(timerLabel(recorder.elapsed))
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(DSColor.textSecondary)
                .monospacedDigit()
            Spacer()
            HStack(spacing: 4) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 11, weight: .bold))
                Text("messages.voice.slide_to_cancel")
                    .font(.system(.caption2, design: .default))
            }
            .foregroundStyle(willCancel ? DSColor.danger : DSColor.textTertiary)
            .opacity(max(0.3, 1.0 + Double(dragOffset / 200)))
            .offset(x: dragOffset / 4)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, 10)
        .background(
            DSColor.surface
                .overlay(
                    Rectangle().fill(DSColor.border.opacity(0.5)).frame(height: 0.5),
                    alignment: .top,
                )
        )
    }

    /// User finished the initial long-press: try to start the recorder.
    /// Async because the permission prompt is async; we do nothing visible
    /// if it fails (the user already declined or the session refused).
    private func onMicLongPress() {
        guard !recorder.isRecording, !armed else { return }
        armed = true
        dragOffset = 0
        // Light haptic to confirm the press registered. Lives inline so
        // the recorder class stays UI-agnostic.
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task {
            let ok = await recorder.start()
            if !ok { armed = false }
        }
    }

    /// Gesture released — either commit the recording, or discard it if
    /// the user dragged far enough to cancel or the take was too short
    /// to be intentional.
    private func onMicRelease() {
        defer {
            armed = false
            dragOffset = 0
        }
        guard recorder.isRecording else { return }
        if dragOffset <= Self.cancelThreshold {
            UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
            recorder.cancel()
            return
        }
        guard let take = recorder.finish() else { return }
        // Sub-1s recordings are almost always accidental taps. Drop the
        // file and bail — the upload path doesn't even see them.
        guard take.duration >= 1 else {
            try? FileManager.default.removeItem(at: take.url)
            return
        }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        Task { await viewModel.sendVoice(fileURL: take.url) }
    }

    /// Formats `seconds` as `m:ss` for the live timer. Always at least
    /// `0:00` even before the recorder ticks for the first time.
    private func timerLabel(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    // MARK: - Helpers

    /// Converts the picker selection to raw bytes, infers the MIME type and
    /// hands it to the view model. PhotosPicker on iOS 18+ returns transcoded
    /// JPEG/HEIC; we always send `image/jpeg` because the API doesn't accept
    /// HEIC — UIImage round-trip ensures the bytes are real JPEG.
    private func handlePicked(_ item: PhotosPickerItem) async {
        defer { pickedItem = nil }
        guard let raw = try? await item.loadTransferable(type: Data.self) else { return }
        // Re-encode as JPEG via UIImage so HEIC inputs become a format the
        // backend accepts. We accept a small quality loss in exchange for
        // simplicity and a fixed MIME.
        let bytes: Data
        let mime: String
        if let image = UIImage(data: raw), let jpeg = image.jpegData(compressionQuality: 0.85) {
            bytes = jpeg
            mime = "image/jpeg"
        } else {
            // Fall back to raw bytes if UIImage refused — likely a format the
            // backend will refuse too, but let the server be the source of
            // truth.
            bytes = raw
            mime = "image/jpeg"
        }
        await viewModel.sendImage(bytes, mimeType: mime)
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "?" : parts.joined()
    }

    /// We only show the typing indicator if the latest message came from the
    /// other party very recently (≤ 30s) — a believable placeholder until a
    /// real presence channel ships.
    private func showTypingIndicator(_ thread: ConversationThread) -> Bool {
        return viewModel.isOtherTyping
    }
}

/// Read-receipt label rendered beneath the user's trailing message. Reads
/// as a single check icon + localized status text. `.seen` is wired up
/// but currently never emitted — see TODO on `readReceipt(for:)` for the
/// backend hook.
private enum ChatReadReceipt: Hashable {
    case sent
    case seen
}

// MARK: - Bubbles & section pieces

private struct DaySection: Hashable {
    let label: String
    var entries: [Entry]

    /// `isFirstInGroup` / `isLastInGroup` are pre-computed by the section
    /// builder so the bubble doesn't have to look at its neighbours at
    /// render time — kept on the case rather than the row so the LazyVStack
    /// gets a stable hashable shape.
    enum Entry: Hashable {
        case message(Message, isFirstInGroup: Bool, isLastInGroup: Bool)
        case pendingMessage(PendingMessage)
        case unreadSeparator
    }
}

/// WhatsApp/iMessage-style centred date divider — capsule on a neutral
/// background, no leading/trailing rules. Tile-able above each `DaySection`.
private struct DayDivider: View {
    let label: String
    var body: some View {
        Text(label)
            .font(.system(.caption2, design: .default, weight: .semibold))
            .foregroundStyle(DSColor.textSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .background(
                Capsule()
                    .fill(DSColor.surface)
                    .overlay(
                        Capsule().strokeBorder(DSColor.border.opacity(0.5), lineWidth: 0.5)
                    )
            )
            .frame(maxWidth: .infinity)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct UnreadSeparator: View {
    var body: some View {
        HStack(spacing: DSSpacing.xs) {
            Rectangle().fill(DSColor.accent.opacity(0.4)).frame(height: 1)
            Text("messages.unread")
                .font(.system(.caption2, design: .default, weight: .bold))
                .foregroundStyle(DSColor.accent)
            Rectangle().fill(DSColor.accent.opacity(0.4)).frame(height: 1)
        }
        .padding(.vertical, 4)
    }
}

private struct TypingIndicator: View {
    let name: String
    @State private var dot = 0

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(DSColor.textSecondary.opacity(dot == i ? 0.9 : 0.3))
                    .frame(width: 6, height: 6)
            }
            Text(String(format: String(localized: "messages.typing"), name))
                .font(.system(.caption2, design: .default))
                .foregroundStyle(DSColor.textTertiary)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(DSColor.surface)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            Task {
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 380_000_000)
                    await MainActor.run { dot = (dot + 1) % 3 }
                }
            }
        }
    }
}

private struct MessageBubble: View {
    let message: Message
    let isMine: Bool
    /// True when this bubble starts a new same-sender cluster (or is the
    /// only one in its run). Used to decide intra-cluster spacing —
    /// non-first rows render with a tight top margin to read as a single
    /// thought.
    let isFirstInGroup: Bool
    /// True when this is the last bubble of a same-sender cluster. The
    /// trailing timestamp is rendered only on this row so mid-cluster
    /// bubbles stay compact, matching the iMessage convention.
    let isLastInGroup: Bool
    /// True for the very last message the *current user* has sent in the
    /// thread. Drives the "Seen" / "Sent" read-receipt footer underneath
    /// the bubble.
    let isLastOwnMessage: Bool
    /// Receipt to render under the bubble — `nil` for all but the trailing
    /// own message. Stays decoupled from `isMine` so a future per-message
    /// expansion (e.g. tap to reveal status on any row) requires only a
    /// caller change.
    let readReceipt: ChatReadReceipt?

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            if isMine { Spacer(minLength: 60) }
            VStack(alignment: isMine ? .trailing : .leading, spacing: 4) {
                if message.attachment_type == .image, let urlString = message.attachment_url,
                   let url = URL(string: urlString) {
                    ImageAttachmentBubble(url: url, isMine: isMine, originalURL: urlString)
                }
                if message.attachment_type == .voice, let urlString = message.attachment_url,
                   let url = URL(string: urlString) {
                    VoiceAttachmentBubble(url: url, isMine: isMine)
                }
                if !message.body.isEmpty {
                    Text(message.body)
                        .font(.system(.subheadline, design: .default))
                        .foregroundStyle(isMine ? DSColor.textOnAccent : DSColor.textPrimary)
                        .padding(.horizontal, DSSpacing.md)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(isMine ? DSColor.accent : DSColor.surface)
                        )
                }
                // Timestamp only on the trailing bubble of a cluster —
                // matches iMessage's collapse rule and keeps mid-cluster
                // rows visually tight.
                if isLastInGroup {
                    Text(timeLabel(message.created_at))
                        .font(.system(.caption2, design: .default))
                        .foregroundStyle(DSColor.textTertiary)
                        .padding(.horizontal, 4)
                }
                // Read receipt — only rendered on the very last own message.
                // See `ConversationThreadView.readReceipt(for:)` for the
                // stubbed-sent / future-seen wiring.
                if isLastOwnMessage, let readReceipt {
                    ReadReceiptLabel(receipt: readReceipt)
                        .padding(.horizontal, 4)
                        .padding(.top, 2)
                }
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

/// Tiny check-icon + status text row rendered under the user's most recent
/// outgoing bubble. Today's wire format omits any read state, so the
/// rendered state is always `.sent` (single grey check). Once the backend
/// surfaces a read-at timestamp the `.seen` branch fills in with the
/// accent-colored double check.
private struct ReadReceiptLabel: View {
    let receipt: ChatReadReceipt
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: iconName)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(tint)
            Text(receipt == .seen ? "chat.status.seen" : "chat.status.sent")
                .font(.system(.caption2, design: .default, weight: .medium))
                .foregroundStyle(tint)
        }
        .accessibilityElement(children: .combine)
    }

    private var iconName: String {
        receipt == .seen ? "checkmark.circle.fill" : "checkmark"
    }
    private var tint: Color {
        receipt == .seen ? DSColor.accent : DSColor.textTertiary
    }
}

/// Floating circular arrow button shown above the composer when the user
/// has scrolled away from the latest message. Tap returns the thread to
/// the bottom and clears any "%d new messages" pill stacked above it.
private struct ScrollToBottomChip: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(DSColor.surfaceElevated)
                .frame(width: 40, height: 40)
                .shadow(color: Color.black.opacity(0.18), radius: 8, x: 0, y: 4)
            Circle()
                .strokeBorder(DSColor.border, lineWidth: 0.5)
                .frame(width: 40, height: 40)
            Image(systemName: "arrow.down")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(DSColor.textPrimary)
        }
        .contentShape(Circle())
    }
}

/// Accent-tinted pill that floats above the scroll-to-bottom chip when one
/// or more inbound messages arrived while the user was parked offscreen.
/// `count` is the plural-aware tally — formatted via
/// `chat.new_messages_format`.
private struct NewMessagesPill: View {
    let count: Int
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "arrow.down")
                .font(.system(size: 10, weight: .bold))
            Text(label)
                .font(.system(.footnote, design: .default, weight: .semibold))
        }
        .foregroundStyle(DSColor.textOnAccent)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            Capsule()
                .fill(DSColor.accent)
                .shadow(color: DSColor.accent.opacity(0.35), radius: 6, x: 0, y: 3)
        )
        .accessibilityLabel(Text(label))
    }

    /// xcstrings template — `%d new messages`-style. We deliberately keep
    /// the catalog entry as a flat `%d` template (rather than per-language
    /// plural variations) so the call-site can read like every other
    /// templated string in this app — see e.g. the `messages.typing` site.
    /// A future iteration can switch to Stringsdict if locale-specific
    /// pluralisation becomes worth the complexity.
    private var label: String {
        String(format: String(localized: "chat.new_messages_format"), locale: Locale.current, count)
    }
}

/// Renders an optimistic outbound bubble — same right-aligned, accent-filled
/// layout as the user's own `MessageBubble`, just slightly translucent and
/// stamped with a "sending" indicator (gray clock icon) next to the
/// timestamp. On `.failed` the bubble gains a red border, a red
/// exclamation glyph, and a Retry button that re-runs the send through
/// the view model.
///
/// Lives next to `MessageBubble` so the two read together; kept private to
/// the messages feature because no other surface renders pending state.
private struct PendingMessageBubble: View {
    let pending: PendingMessage
    /// Fired when the user taps Retry on a failed row. The view model wires
    /// this to `retry(_:)`, which flips status back to `.sending` and
    /// re-runs the appropriate POST.
    let onRetry: () -> Void

    var body: some View {
        // Pending bubbles are always from the current user, so we always
        // render right-aligned with the accent-filled body — mirroring the
        // `isMine: true` path on `MessageBubble`. The only visible
        // differences are the reduced opacity and the trailing status
        // chip / Retry button.
        HStack(alignment: .bottom, spacing: 6) {
            Spacer(minLength: 60)
            VStack(alignment: .trailing, spacing: 4) {
                if pending.attachmentType == .image,
                   let urlString = pending.attachmentURL,
                   let url = URL(string: urlString) {
                    ImageAttachmentBubble(url: url, isMine: true, originalURL: urlString)
                        .opacity(pending.status == .sending ? 0.75 : 1)
                }
                if !pending.body.isEmpty {
                    Text(pending.body)
                        .font(.system(.subheadline, design: .default))
                        .foregroundStyle(DSColor.textOnAccent)
                        .padding(.horizontal, DSSpacing.md)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(DSColor.accent.opacity(pending.status == .sending ? 0.75 : 1))
                        )
                        .overlay(
                            // Red outline on failure so the bubble reads as
                            // a problem at a glance, even in motion-reduced
                            // mode where any status animation might be off.
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .strokeBorder(
                                    pending.status == .failed ? DSColor.danger : Color.clear,
                                    lineWidth: 1.5,
                                )
                        )
                }
                statusFooter
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilityLabel)
        }
    }

    /// Time + status indicator + optional Retry. The trailing-aligned VStack
    /// above places this directly under the bubble.
    @ViewBuilder
    private var statusFooter: some View {
        HStack(spacing: 6) {
            Text(timeLabel(pending.createdAt))
                .font(.system(.caption2, design: .default))
                .foregroundStyle(DSColor.textTertiary)
            switch pending.status {
            case .sending:
                // Single gray clock = "sending". The spec calls for a check
                // glyph, but the SF Symbol bundle's `clock` reads more
                // unambiguously as "in-flight" against the dark canvas — and
                // the "sent" state falls through to the canonical
                // `MessageBubble` once the server confirms (no separate
                // sent-check needed because by then this row is gone).
                Image(systemName: "clock")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DSColor.textTertiary)
                    .accessibilityLabel(Text("messages.status.sending"))
            case .failed:
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DSColor.danger)
                    Text("messages.status.failed")
                        .font(.system(.caption2, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.danger)
                    Button(action: onRetry) {
                        Text("messages.action.retry")
                            .font(.system(.caption2, design: .default, weight: .bold))
                            .foregroundStyle(DSColor.accent)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(
                                Capsule()
                                    .strokeBorder(DSColor.accent.opacity(0.6), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("messages.action.retry"))
                }
            }
        }
        .padding(.horizontal, 4)
    }

    private func timeLabel(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale.current
        f.setLocalizedDateFormatFromTemplate("Hm")
        return f.string(from: date)
    }

    /// Combined-children accessibility label for the bubble. Reads as
    /// "<body>, sending" or "<body>, failed". Falls back to the
    /// localized "attach image" label when the bubble carries no body text
    /// (image-only sends).
    private var accessibilityLabel: Text {
        let bodyText = pending.body.isEmpty
            ? String(localized: "messages.attach_image")
            : pending.body
        let statusKey: LocalizedStringKey = pending.status == .sending
            ? "messages.status.sending"
            : "messages.status.failed"
        return Text("\(bodyText), ") + Text(statusKey)
    }
}

/// AsyncImage with a fixed rounded shape, a placeholder while loading and a
/// long-press menu to save the image. Tap to expand in a sheet.
private struct ImageAttachmentBubble: View {
    let url: URL
    let isMine: Bool
    let originalURL: String

    @State private var saving = false
    @State private var showFull: PhotoViewerTarget?

    var body: some View {
        CachedAsyncImage(url: url, transaction: Transaction(animation: .easeInOut)) { phase in
            switch phase {
            case .empty:
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(DSColor.surface)
                    .frame(width: 220, height: 160)
                    .overlay(ProgressView().tint(DSColor.textSecondary))
            case .success(let image):
                image
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: 240, maxHeight: 280)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            case .failure:
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(DSColor.surface)
                    .frame(width: 220, height: 120)
                    .overlay(
                        VStack(spacing: 6) {
                            Image(systemName: "photo.badge.exclamationmark")
                                .font(.system(size: 22))
                                .foregroundStyle(DSColor.textTertiary)
                            Text("messages.image_failed")
                                .font(.caption2)
                                .foregroundStyle(DSColor.textTertiary)
                        }
                    )
            @unknown default:
                EmptyView()
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(isMine ? DSColor.accent.opacity(0.6) : DSColor.border, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .onTapGesture { showFull = PhotoViewerTarget(url: url) }
        .contextMenu {
            Button {
                Task { await save() }
            } label: {
                Label("messages.save_image", systemImage: "square.and.arrow.down")
            }
            .disabled(saving)
        }
        .fullScreenCover(item: $showFull) { target in
            PhotoViewer(imageURL: target.url) { showFull = nil }
        }
    }

    /// Fetch and save into the camera roll. Permission is handled by the
    /// system add-only API — no Info.plist key beyond `NSPhotoLibraryAddUsageDescription`
    /// is required.
    private func save() async {
        if saving { return }
        saving = true
        defer { saving = false }
        guard let saveURL = URL(string: originalURL),
              let (data, _) = try? await URLSession.shared.data(from: saveURL),
              let image = UIImage(data: data) else { return }
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
    }
}

/// Identifiable wrapper around the image URL — drives
/// `.fullScreenCover(item:)` in `ImageAttachmentBubble`. We can't conform
/// `URL` itself to `Identifiable` (that would leak into every file), and a
/// `Bool`-toggled cover would lose the URL across re-renders, so we wrap it
/// here. Keyed on the URL itself: SwiftUI will rebuild the cover only when
/// the user taps a different image.
struct PhotoViewerTarget: Identifiable, Hashable {
    let url: URL
    var id: URL { url }
}

// MARK: - Voice attachment

/// Inline player bubble for a `voice` attachment. Tap the disc to toggle
/// playback. The waveform is a static stylised set of bars (we don't
/// precompute peaks server-side) — a future iteration could fetch and
/// render real samples, but the visual cue is enough to recognise a voice
/// message at a glance. Duration shows the remaining time while playing
/// and the total when idle.
@MainActor
private struct VoiceAttachmentBubble: View {
    let url: URL
    let isMine: Bool

    @State private var player: AVPlayer?
    @State private var isPlaying = false
    @State private var duration: TimeInterval = 0
    @State private var elapsed: TimeInterval = 0
    /// Periodic-time observer handle. Held so we can detach on disappear
    /// without leaking the closure.
    @State private var timeObserver: Any?

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            Button(action: toggle) {
                ZStack {
                    Circle()
                        .fill(isMine ? DSColor.textOnAccent.opacity(0.18) : DSColor.accent.opacity(0.15))
                        .frame(width: 36, height: 36)
                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(isMine ? DSColor.textOnAccent : DSColor.accent)
                        // Optical centring — the play glyph has weight on
                        // the right; pause is symmetric. Nudge play right.
                        .offset(x: isPlaying ? 0 : 1)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("messages.voice.attachment"))

            VStack(alignment: .leading, spacing: 4) {
                waveform
                Text(formatTime(displayTime))
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(isMine ? DSColor.textOnAccent.opacity(0.75) : DSColor.textTertiary)
                    .monospacedDigit()
            }
            .frame(minWidth: 110, maxWidth: 180)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(isMine ? DSColor.accent : DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(
                    isMine ? DSColor.accent.opacity(0.6) : DSColor.border,
                    lineWidth: 1,
                )
        )
        .onAppear { prime() }
        .onDisappear { teardown() }
    }

    /// Fourteen fixed bars, modulated by playback progress: bars to the
    /// left of `progress` use the "foreground" color, the rest dim.
    /// Heights are seeded by a tiny deterministic hash on bar-index so
    /// the shape looks like a real waveform but stays stable across renders.
    private var waveform: some View {
        let progress: Double = duration > 0 ? min(1, elapsed / duration) : 0
        return HStack(alignment: .center, spacing: 4) {
            ForEach(0..<14, id: \.self) { i in
                let frac = Double(i) / 13
                let active = frac <= progress
                let h = barHeight(i)
                Capsule()
                    .fill(barColor(active: active))
                    .frame(width: 3, height: h)
            }
        }
        .frame(height: 22)
        .animation(.linear(duration: 0.1), value: progress)
    }

    private func barHeight(_ i: Int) -> CGFloat {
        // Pseudo-random but stable: peaks in the middle, smaller at the ends.
        let middleBias = 1 - abs(Double(i) - 6.5) / 6.5
        let jitter = Double((i &* 2_654_435_761) & 0xFFFF) / Double(0xFFFF)
        return 6 + CGFloat(middleBias * 14 + jitter * 4)
    }

    private func barColor(active: Bool) -> Color {
        if isMine {
            return active ? DSColor.textOnAccent : DSColor.textOnAccent.opacity(0.35)
        } else {
            return active ? DSColor.accent : DSColor.border
        }
    }

    /// While playing we show the elapsed timer ("0:03"); when paused we show
    /// the total clip length so the user can decide whether to play it.
    private var displayTime: TimeInterval {
        isPlaying ? elapsed : duration
    }

    private func formatTime(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded()))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    /// Lazy-init the AVPlayer — we don't preload audio for every bubble
    /// (would hammer the network for a long thread). The first tap kicks
    /// off the asset load.
    private func toggle() {
        if let player {
            if isPlaying {
                player.pause()
                isPlaying = false
            } else {
                // If we've already played to the end, rewind first.
                if duration > 0, elapsed >= duration - 0.1 {
                    player.seek(to: .zero)
                    elapsed = 0
                }
                player.play()
                isPlaying = true
            }
            return
        }
        // First play. Build the player, attach observers, kick it off.
        Task {
            // Switch into playback so the speaker (not the earpiece) is used.
            // Best-effort — failure here doesn't block playback, just
            // routes through whatever route is current.
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
            try? AVAudioSession.sharedInstance().setActive(true, options: [])
            let p = AVPlayer(url: url)
            self.player = p
            attachObservers(to: p)
            p.play()
            isPlaying = true
        }
    }

    private func attachObservers(to player: AVPlayer) {
        let interval = CMTime(seconds: 0.1, preferredTimescale: 600)
        // The periodic time observer's closure isn't main-actor-isolated by
        // type even though we pin queue: .main. Hop explicitly via
        // `MainActor.assumeIsolated` (cheap because we already ARE on main)
        // so the compiler lets us mutate the @State-backed properties.
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { time in
            MainActor.assumeIsolated {
                self.elapsed = time.seconds.isFinite ? time.seconds : 0
                // Pull duration lazily — it's NaN until the asset loads.
                if let d = player.currentItem?.duration.seconds, d.isFinite, d > 0 {
                    self.duration = d
                }
            }
        }
        // End-of-playback — stop animating and rewind so the next tap
        // replays from the start.
        NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime,
                                               object: player.currentItem, queue: .main) { _ in
            MainActor.assumeIsolated {
                self.isPlaying = false
                player.seek(to: .zero)
                self.elapsed = 0
            }
        }
    }

    /// Light pre-population of `duration` so the bubble shows a real number
    /// before playback starts. Uses the modern async loadValues — best
    /// effort, drops back to `0` if the asset metadata won't load.
    private func prime() {
        Task {
            let asset = AVURLAsset(url: url)
            if let d = try? await asset.load(.duration).seconds, d.isFinite, d > 0 {
                self.duration = d
            }
        }
    }

    private func teardown() {
        if let player, let obs = timeObserver {
            player.removeTimeObserver(obs)
        }
        timeObserver = nil
        player?.pause()
        player = nil
        isPlaying = false
        NotificationCenter.default.removeObserver(self, name: .AVPlayerItemDidPlayToEndTime, object: nil)
    }
}
