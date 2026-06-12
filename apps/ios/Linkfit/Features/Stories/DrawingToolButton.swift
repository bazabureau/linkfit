import SwiftUI

/// Wave-13 — drawing tool entry-point button hosted in the story
/// editor's toolbar. Sits alongside `MentionToolButton` and
/// `StickerToolButton` and follows the same shape: it takes a
/// `Binding<[StoryOverlay]>` so the button can append a fresh
/// `.drawing(...)` overlay in place once the user finishes painting.
///
/// On tap the button presents `StoryDrawCanvas` as a full-screen
/// cover. The user paints, picks colour/width, optionally erases,
/// then taps "Tamam" (Done). The canvas calls back with the binary
/// `PKDrawing.dataRepresentation()`, we wrap it into a
/// `StoryDrawingOverlay` centred on the canvas (the drawing fills the
/// whole frame so `x`/`y`/`scale`/`rotation` are nominal), and
/// dismiss the modal.
///
/// Visual: an SF Symbol `scribble.variable` glyph inside a circular
/// black-tint chip, matching `MentionToolButton`'s "@" chrome. The
/// glyph reads as "drawing tool" in every locale Apple supports, so
/// no localised label inside the button.
struct DrawingToolButton: View {
    @Binding var overlays: [StoryOverlay]
    @State private var showCanvas = false

    var body: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            showCanvas = true
        } label: {
            Image(systemName: "scribble.variable")
                .font(.system(size: 18, weight: .heavy))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(
                    Circle().fill(Color.black.opacity(0.35))
                )
                .overlay(
                    Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("stories.draw.tool.label"))
        .fullScreenCover(isPresented: $showCanvas) {
            StoryDrawCanvas { drawingData in
                // Centred + identity transform — the drawing was
                // captured at the same canvas size as the editor's
                // photo preview, so it already aligns pixel-for-pixel
                // when re-rendered at scale 1, x/y = 0.5. The
                // transform fields ride along for protocol parity in
                // case a future "shrink-and-tuck-in-corner" gesture
                // lands.
                let drawing = StoryDrawingOverlay(
                    id: UUID(),
                    drawingData: drawingData,
                    x: 0.5,
                    y: 0.5,
                    scale: 1,
                    rotation: 0
                )
                overlays.append(.drawing(drawing))
                showCanvas = false
            }
        }
    }
}
