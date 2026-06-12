import SwiftUI

/// Wave-13 Instagram-style reply-to-story composer.
///
/// Bottom-anchored input strip that appears at the foot of
/// `StoryViewer` when the active frame is NOT the viewer's own story.
/// Two rows:
///
///   * **Quick-reactions** — a horizontal row of five tappable emojis
///     (❤️ 🔥 💯 👏 🎾). Each tap fires the matching emoji as a
///     single-character reply message, just like Instagram. Same
///     glyphs as the `StoryReactionsBar`, but the action is a DM
///     send, not a reaction upsert.
///
///   * **Text composer** — `TextField` (axis = `.vertical`, capped at
///     3 visible lines via `lineLimit(1...3)`) on the left, send
///     button on the right. The send button stays disabled (gray)
///     while `draft` is empty-after-trim; when populated it goes
///     lime + accepts taps. Tapping the field grabs focus → the VM's
///     `setComposerActive(true)` pauses the story timer + suppresses
///     the gesture overlay so typing can't accidentally close or
///     advance the viewer.
///
/// Send flow:
///   1. Tap send → `Haptics.medium()`.
///   2. Call `viewModel.sendReply(text:)`. The VM dim's the strip via
///      `isSendingReply` and fires the network call.
///   3. On success, the VM surfaces the success toast and we clear
///      `draft` + resign focus locally. On failure, the VM surfaces an
///      error toast and we keep `draft` intact so the user can retry.
///
/// Hide rule: caller (StoryViewer) is expected to construct this only
/// when `!viewModel.ownsCurrent`. Defensive: if `currentGroup` is nil
/// (transient state during dismiss) we render an `EmptyView` so the
/// footer collapses cleanly.
struct StoryReplyComposer: View {
    @Bindable var viewModel: StoryViewerViewModel
    /// Local draft text — kept here rather than on the VM because the
    /// VM only cares about the value at send-time. Keystroke-level
    /// state in the View avoids round-tripping every character
    /// through the observable graph.
    @State private var draft: String = ""
    /// Bound to the TextField's focus state. The VM's
    /// `setComposerActive` mirrors this to pause the timer + suppress
    /// the gesture overlay while the keyboard is up.
    @FocusState private var fieldFocused: Bool

    /// Five quick-react emojis surfaced as one-tap shortcuts above the
    /// text composer. Same glyph order as `StoryReactionEmoji.allCases`
    /// so the visual identity matches the reactions bar; the action is
    /// different (DM send vs. reaction upsert), but the glyphs are
    /// stable so the user's muscle memory transfers.
    private static let quickReactions: [String] = ["\u{2764}\u{FE0F}", "\u{1F525}", "\u{1F4AF}", "\u{1F44F}", "\u{1F3BE}"]

    /// Hide the entire composer when there's no recipient — happens
    /// mid-dismiss when `currentGroup` briefly goes nil before the
    /// view tears down.
    var body: some View {
        if let group = viewModel.currentGroup {
            VStack(spacing: 10) {
                quickReactionRow
                composerRow(authorName: group.display_name)
            }
            // Stop touch-down anywhere inside the composer strip from
            // bubbling up to the gesture catcher. Without this, a tap
            // on the TextField would also trigger the half-screen
            // next/previous gesture under it.
            .contentShape(Rectangle())
            // Mirror the focus into the VM so the gesture overlay can
            // suppress its taps + drags while the keyboard is up.
            // Watching the @FocusState binding (not the VM's value)
            // keeps the source-of-truth one-directional: SwiftUI owns
            // focus, the VM is downstream.
            .onChange(of: fieldFocused) { _, focused in
                viewModel.setComposerActive(focused)
            }
        } else {
            EmptyView()
        }
    }

    // MARK: - Quick reactions

    /// Horizontal row of one-tap quick-reaction emojis. Each tap sends
    /// the glyph as a single-character reply (`viewModel.sendReply`)
    /// and surfaces a soft haptic. We intentionally don't dim the row
    /// while a previous send is in flight — quick reactions are
    /// throwaway, and a rapid double-tap producing two heart messages
    /// matches Instagram's behavior.
    private var quickReactionRow: some View {
        HStack(spacing: 12) {
            ForEach(Self.quickReactions, id: \.self) { glyph in
                Button {
                    Haptics.soft()
                    // Quick reactions ignore `draft` — they send the
                    // emoji literally. We don't await the result here
                    // (fire-and-forget) since the toast surfaces success
                    // and the strip stays interactive for the next tap.
                    Task { await viewModel.sendReply(text: glyph) }
                } label: {
                    Text(glyph)
                        .font(.system(size: 28))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(Text(String(
                    format: String(localized: "stories.reply.quick.a11y"),
                    glyph
                )))
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(
            Capsule()
                .fill(Color.black.opacity(0.35))
        )
    }

    // MARK: - Text composer

    /// Bottom row: text field + send button. The placeholder reads
    /// "{author_name}-a cavab yaz..." in AZ so the recipient is
    /// immediately legible — same pattern Instagram uses
    /// ("Reply to @handle…").
    private func composerRow(authorName: String) -> some View {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let canSend = !trimmed.isEmpty && !viewModel.isSendingReply
        let placeholder = String(
            format: String(localized: "stories.reply.placeholder_format"),
            authorName
        )

        return HStack(spacing: 10) {
            TextField(
                "",
                text: $draft,
                prompt: Text(placeholder)
                    .foregroundStyle(Color.white.opacity(0.55)),
                axis: .vertical
            )
            .lineLimit(1...3)
            .focused($fieldFocused)
            .submitLabel(.send)
            .textInputAutocapitalization(.sentences)
            // Submit-on-return only when the field has non-empty text;
            // an empty `.send` press is a no-op (Instagram parity).
            .onSubmit {
                guard canSend else { return }
                trySend()
            }
            .font(.system(size: 15))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.black.opacity(0.45))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(Color.white.opacity(0.18), lineWidth: 0.5)
                    )
            )

            sendButton(canSend: canSend)
        }
    }

    /// Round send button — gray-disabled when there's nothing to send
    /// or a previous send is in flight, lime when armed. The lime
    /// state animates in via a scale + color change so the user gets
    /// a clear "you can send now" signal once they start typing.
    private func sendButton(canSend: Bool) -> some View {
        Button {
            trySend()
        } label: {
            Image(systemName: "arrow.up")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(canSend ? DSColor.textOnAccent : Color.white.opacity(0.5))
                .frame(width: 36, height: 36)
                .background(
                    Circle()
                        .fill(canSend ? DSColor.accent : Color.white.opacity(0.18))
                )
                .scaleEffect(canSend ? 1.0 : 0.92)
                .animation(.spring(response: 0.25, dampingFraction: 0.7), value: canSend)
        }
        .disabled(!canSend)
        .accessibilityLabel(Text("stories.reply.send.a11y"))
    }

    // MARK: - Send

    /// Fire the reply send. Wrapped in a Task so the View doesn't
    /// block on the network call; on success we clear the draft +
    /// resign focus so the keyboard dismisses and the composer goes
    /// back to its idle state. On failure the VM surfaces an error
    /// toast and `draft` stays intact so the user can correct + retry.
    private func trySend() {
        let textToSend = draft
        let trimmed = textToSend.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        Haptics.medium()
        Task {
            let ok = await viewModel.sendReply(text: textToSend)
            if ok {
                await MainActor.run {
                    draft = ""
                    fieldFocused = false
                }
            }
        }
    }
}
