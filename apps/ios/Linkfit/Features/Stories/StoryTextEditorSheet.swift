import SwiftUI

/// Full-screen modal for editing a single text overlay.
///
/// Shown when the user taps the "Aa" tool (new overlay) or taps an
/// existing text overlay on the canvas. Mirrors Instagram's text-tool
/// modal layout:
///   * Centred TextEditor with a giant text caret.
///   * Bottom toolbar: alignment toggle on the left, size slider in the
///     middle, "Tamam" (Done) on the right.
///   * Color swatches strip just above the toolbar.
///
/// The sheet holds a local mutable copy of the payload so we can preview
/// live without mutating the parent's overlay until the user commits via
/// "Tamam". Cancel discards everything.
struct StoryTextEditorSheet: View {
    /// The initial payload — used to seed local state on appear.
    let initial: StoryTextOverlay
    /// Called with the edited payload when the user commits.
    let onCommit: (StoryTextOverlay) -> Void
    /// Called when the user dismisses without committing.
    let onCancel: () -> Void

    // MARK: - Local working state

    @State private var text: String = ""
    @State private var color: StoryTextOverlay.ColorOption = .white
    @State private var size: StoryTextOverlay.SizeOption = .medium
    @State private var alignment: StoryTextOverlay.TextAlign = .center

    /// Focus the TextEditor as soon as the sheet appears so the
    /// keyboard slides up and the user can start typing immediately —
    /// no extra tap. `@FocusState` is the SwiftUI-native way to drive
    /// programmatic focus on a TextEditor.
    @FocusState private var isFocused: Bool

    var body: some View {
        ZStack {
            // Tap-anywhere-outside-the-editor → commit. Same gesture
            // Instagram ships; lets the user "set" their text without
            // hunting for the Done button.
            Color.black.opacity(0.55)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { commit() }

            VStack(spacing: 0) {
                // Top bar — close (cancel) + done. Both routes leave the
                // sheet; only "Tamam" persists.
                topBar
                    .padding(.horizontal, 16)
                    .padding(.top, 12)

                Spacer(minLength: 24)

                // Live preview / text input. We use a TextField for the
                // multi-line input (axis: .vertical) instead of TextEditor
                // because TextEditor's background is opaque on iOS 18
                // and fights the live "see the styling under your text"
                // effect we're after. TextField with `axis: .vertical`
                // grows to fit, no opaque background, supports return-
                // for-newline.
                TextField(
                    "",
                    text: $text,
                    prompt: Text("stories.text.placeholder")
                        .foregroundStyle(.white.opacity(0.55)),
                    axis: .vertical
                )
                .focused($isFocused)
                .font(.system(size: size.pointSize, weight: .heavy))
                .multilineTextAlignment(alignment.textAlignment)
                .foregroundStyle(color.swiftUIColor)
                .tint(DSColor.accent)
                .shadow(color: .black.opacity(0.35), radius: 4, x: 0, y: 2)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity, alignment: alignmentForFrame)

                Spacer(minLength: 24)

                bottomChrome
            }
        }
        .onAppear {
            text = initial.text
            color = initial.color
            size = initial.size
            alignment = initial.alignment
            // Defer the focus flip a tick so SwiftUI has time to mount
            // the TextField; without this the keyboard appears late on
            // device.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                isFocused = true
            }
        }
    }

    // MARK: - Top bar

    private var topBar: some View {
        HStack {
            Button {
                onCancel()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Color.black.opacity(0.4), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("common.close"))

            Spacer()

            Button {
                commit()
            } label: {
                Text("stories.text.done")
                    .font(.system(size: 15, weight: .heavy))
                    .foregroundStyle(DSColor.textOnAccent)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 9)
                    .background(Capsule().fill(DSColor.accent))
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Bottom chrome (color row + size+align row)

    private var bottomChrome: some View {
        VStack(spacing: 18) {
            colorRow
            controlsRow
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
    }

    /// Six-swatch palette. Selected swatch gets a lime ring so the user
    /// can tell their pick from the others without a checkmark badge.
    private var colorRow: some View {
        HStack(spacing: 14) {
            ForEach(StoryTextOverlay.ColorOption.allCases, id: \.self) { option in
                Button {
                    color = option
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                } label: {
                    Circle()
                        .fill(option.swiftUIColor)
                        .frame(width: 28, height: 28)
                        .overlay(
                            Circle()
                                .strokeBorder(Color.white.opacity(0.6), lineWidth: 1)
                        )
                        .overlay(
                            Circle()
                                .strokeBorder(
                                    color == option ? DSColor.accent : .clear,
                                    lineWidth: 3
                                )
                                .padding(-4)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("stories.text.color"))
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// Bottom-row controls: alignment cycle button + size slider.
    private var controlsRow: some View {
        HStack(spacing: 18) {
            Button {
                cycleAlignment()
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            } label: {
                Image(systemName: alignment.symbolName)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Color.black.opacity(0.4), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("stories.text.align"))

            // Three-stop size slider. We bind to a continuous Double in
            // 0…1 and snap to the nearest stop on change for that nice
            // "feel the detent" feedback.
            HStack(spacing: 8) {
                Image(systemName: "textformat.size.smaller")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white.opacity(0.7))
                Slider(
                    value: Binding(
                        get: { sliderValue(for: size) },
                        set: { size = sizeOption(for: $0) }
                    ),
                    in: 0...1
                )
                .tint(DSColor.accent)
                Image(systemName: "textformat.size.larger")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white.opacity(0.7))
            }
            .accessibilityLabel(Text("stories.text.size"))
        }
    }

    // MARK: - Helpers

    /// Mirror the TextField's frame alignment so the text edge aligns
    /// with what the live multiline alignment will be on the canvas.
    private var alignmentForFrame: Alignment {
        switch alignment {
        case .left:   return .leading
        case .center: return .center
        case .right:  return .trailing
        }
    }

    private func cycleAlignment() {
        switch alignment {
        case .left:   alignment = .center
        case .center: alignment = .right
        case .right:  alignment = .left
        }
    }

    /// Map size stop → slider midpoint.
    private func sliderValue(for size: StoryTextOverlay.SizeOption) -> Double {
        switch size {
        case .small:  return 0.0
        case .medium: return 0.5
        case .large:  return 1.0
        }
    }

    /// Map slider raw value → closest stop.
    private func sizeOption(for raw: Double) -> StoryTextOverlay.SizeOption {
        if raw < 0.33 { return .small }
        if raw < 0.66 { return .medium }
        return .large
    }

    /// Build a new payload from the local working state, preserving the
    /// transform fields from the initial payload (so the canvas position
    /// the user dragged into doesn't snap back to centre on edit).
    private func commit() {
        var updated = initial
        updated.text = text
        updated.color = color
        updated.size = size
        updated.alignment = alignment
        onCommit(updated)
    }
}
