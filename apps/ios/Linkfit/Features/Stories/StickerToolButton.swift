import SwiftUI

/// Sticker tool entry-point button hosted in W12-2's editor toolbar.
///
/// **Locked contract** — W12-2's toolbar instantiates this view by name
/// and hands it the same `[StoryOverlay]` binding the canvas reads. On
/// tap it presents `StoryStickerPickerSheet`; the user picks a glyph,
/// we append a new `StoryStickerOverlay` centred on the canvas at the
/// default scale + zero rotation, and dismiss the sheet.
///
/// The button renders the SF `face.smiling` symbol (emoji glyphs are
/// banned as UI chrome per the design guidelines — emoji stays reserved
/// for user-selected sticker *content*). Styled to match the other story
/// tool buttons (white glyph on a dimmed disc over the media canvas).
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
            Haptics.soft()   // light tier — secondary tool entry, matches Mention/Drawing buttons
            showPicker = true
        } label: {
            Image(systemName: "face.smiling")
                .font(.system(size: 20, weight: .heavy))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(
                    Circle().fill(Color.black.opacity(0.35))
                )
                .overlay(
                    Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1)
                )
                .contentShape(Circle())
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
