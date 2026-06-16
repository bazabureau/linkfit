import SwiftUI

/// Instagram-style emoji reaction bar that sits above the caption in
/// `StoryViewer`.
///
/// Layout: a horizontal row of five emoji buttons inside a single
/// semi-transparent black pill. Each button stacks the glyph on top
/// of an optional count badge (shown only when > 0). The viewer's
/// current selection is highlighted with a lime ring + a 1.08x scale
/// nudge so it pops against the others without changing layout.
///
/// Interaction:
///   * Tap an emoji → fires `onTap(emoji)` and lets the parent VM
///     run the optimistic update + network call.
///   * Long-press (any emoji, or even the pill background) →
///     `onPressStart` so the viewer can pause its progress timer;
///     `onPressEnd` resumes. The detection happens at the pill level
///     via `LongPressGesture(minimumDuration: 0)` chained into a
///     sequenced DragGesture — that pattern fires the "began" callback
///     immediately on touch-down and the "ended" callback on touch-up,
///     which is exactly the pause-while-touching contract.
///
/// Why a separate file: the bar is meaningfully self-contained (lots
/// of internal state for the press animation + count display) and
/// the parent `StoryViewer.swift` is already large. Keeping the
/// reaction concern co-located in `Features/Stories/` makes the
/// agent boundary easy to see.
struct StoryReactionsBar: View {
    /// Current reaction tally — wire keys (`"heart"`, …) → count.
    /// Unknown keys are ignored; missing keys render as zero.
    let reactions: [String: Int]
    /// Viewer's current reaction, as a wire key. `nil` when they
    /// haven't reacted (no selected button gets the lime ring).
    let myReaction: String?
    /// Fired when the user taps an emoji button. The parent decides
    /// whether this is a "set", "switch", or "clear" mutation based
    /// on the relationship to `myReaction`.
    let onTap: (StoryReactionEmoji) -> Void
    /// Fired on touch-down anywhere inside the bar. The parent uses
    /// this to pause the story timer (matches Instagram — long-press
    /// on a story pauses; the reaction bar inherits that affordance).
    let onPressStart: () -> Void
    /// Fired on touch-up. Pairs with `onPressStart`.
    let onPressEnd: () -> Void

    /// Per-button "just tapped" pulse state. Drives a tiny scale
    /// bounce when the user taps an emoji — without it, the optimistic
    /// count bump can feel disconnected from the touch. Cleared after
    /// the animation by a Task.delay; concurrent taps on different
    /// emojis just swap the active key, which is fine because the
    /// previous animation hasn't visually settled yet either.
    @State private var pulseEmoji: StoryReactionEmoji?

    /// Honor Reduce Motion — the selection/pulse springs are decorative,
    /// so under Reduce Motion we drop the spring and let the state change
    /// apply instantly (no scale bounce).
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 4) {
            ForEach(StoryReactionEmoji.allCases, id: \.self) { emoji in
                reactionButton(for: emoji)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            Capsule()
                .fill(Color.black.opacity(0.45))
        )
        // Touch-detection wrapping the whole pill: any finger down on
        // the bar pauses the story. `minimumDuration: 0` makes this
        // fire immediately on touch — equivalent to "press began",
        // not "long press detected". The sequenced DragGesture is the
        // standard pattern for getting both began + ended callbacks
        // from a press-and-hold without committing to a long-press
        // recognition delay.
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0)
                .sequenced(before: DragGesture(minimumDistance: 0))
                .onChanged { value in
                    if case .second(true, _) = value {
                        onPressStart()
                    }
                }
                .onEnded { _ in
                    onPressEnd()
                }
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("stories.reactions.a11y"))
    }

    // MARK: - Button

    @ViewBuilder
    private func reactionButton(for emoji: StoryReactionEmoji) -> some View {
        let count = reactions[emoji.rawValue] ?? 0
        let isSelected = myReaction == emoji.rawValue
        let isPulsing = pulseEmoji == emoji

        Button {
            handleTap(emoji)
        } label: {
            VStack(spacing: 2) {
                Text(emoji.glyph)
                    .font(.system(size: 26))
                    // Scale stack: selected = 1.12 (subtle pop),
                    // pulsing = +0.18 transient. Both compose so a
                    // selected+pulsing tap reads as a "bigger pop"
                    // without two competing transforms.
                    .scaleEffect(reduceMotion ? (isSelected ? 1.12 : 1.0) : (isSelected ? 1.12 : 1.0) * (isPulsing ? 1.18 : 1.0))
                    .animation(reduceMotion ? nil : .spring(response: 0.28, dampingFraction: 0.55), value: isSelected)
                    .animation(reduceMotion ? nil : .spring(response: 0.25, dampingFraction: 0.5), value: isPulsing)
                    // Drop shadow on the selected glyph — adds enough
                    // separation against the pill that the lime ring
                    // doesn't have to fight the emoji for contrast.
                    .shadow(color: isSelected ? DSColor.accent.opacity(0.5) : .clear,
                            radius: 6, x: 0, y: 0)

                // Count label — hidden when zero. Reserving the slot
                // would shift the glyphs vertically every time a count
                // crosses 0↔1; conditional render is fine because the
                // outer VStack re-layouts smoothly.
                if count > 0 {
                    Text("\(count)")
                        .font(DSType.caption2)
                        .foregroundStyle(.white.opacity(0.9))
                        .monospacedDigit()
                        .transition(reduceMotion ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
                }
            }
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
            // Subtle lime ring on the selected button. Background sits
            // INSIDE the outer pill, so the ring reads as "this is
            // your current pick" without redrawing the pill itself.
            .background(
                Capsule()
                    .stroke(isSelected ? DSColor.accent : Color.clear, lineWidth: 1.5)
                    .padding(2)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(emoji.glyph))
        .accessibilityValue(count > 0 ? Text("\(count)") : Text(verbatim: ""))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    // MARK: - Tap handling

    /// Tap = trigger pulse + delegate to parent. The pulse cancels
    /// itself after 250ms (matching the spring's settle time); concurrent
    /// taps overwrite the pulse target which is the desired behavior —
    /// the user wants the newest tap to be the one that's animating.
    private func handleTap(_ emoji: StoryReactionEmoji) {
        pulseEmoji = emoji
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 250_000_000)
            if pulseEmoji == emoji {
                pulseEmoji = nil
            }
        }
        onTap(emoji)
    }
}
