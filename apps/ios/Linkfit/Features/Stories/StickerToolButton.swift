import SwiftUI

/// Sticker tool entry-point button hosted in W12-2's editor toolbar.
///
/// **Locked contract** — W12-2's toolbar instantiates this view by name
/// and hands it the same `[StoryOverlay]` binding the canvas reads. On
/// tap it presents `StoryStickerPickerSheet`; the user picks a glyph,
/// we append a new `StoryStickerOverlay` centred on the canvas at the
/// default scale + zero rotation, and dismiss the sheet.
///
/// The button is a bare `Button("😀")` (no label localization) because
/// the glyph itself is the affordance — matching Instagram, Snapchat,
/// and every other story editor where the emoji icon doubles as a verb.
/// VoiceOver users get a localized accessibility label from
/// `stories.sticker.tool.label`.
///
/// Defaults for the spawned sticker:
///   * `x: 0.5, y: 0.5` — dead centre of the canvas (the rest of the
///     overlay family uses normalized coordinates, see `StoryOverlay`).
///   * `scale: 1` — intrinsic 96pt glyph, which renders large enough
///     to read but small enough that the user has obvious room to pinch
///     up. Same starting scale as W12-2's text overlay.
///   * `rotation: 0` — upright. Users rotate later via the canvas
///     gesture handler.
struct StickerToolButton: View {
    @Binding var overlays: [StoryOverlay]
    @State private var showPicker = false

    var body: some View {
        Button {
            showPicker = true
        } label: {
            Text("\u{1F600}")
                .font(.system(size: 24))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("stories.sticker.tool.label"))
        .sheet(isPresented: $showPicker) {
            StoryStickerPickerSheet { emoji in
                let sticker = StoryStickerOverlay(
                    id: UUID(),
                    emoji: emoji,
                    x: 0.5,
                    y: 0.5,
                    scale: 1,
                    rotation: 0
                )
                overlays.append(.sticker(sticker))
                showPicker = false
            }
        }
    }
}
