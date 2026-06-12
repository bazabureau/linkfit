import SwiftUI
import PencilKit
import CoreGraphics

/// Wave-13 — finger-drawing overlay for the story editor.
///
/// The drawing tool is the "scribble" entry on the editor toolbar
/// (matches Instagram). The user taps `DrawingToolButton` (pen glyph)
/// to open `StoryDrawCanvas` — a full-screen modal `PKCanvasView`
/// overlaying the photo. They paint with one or more strokes, switch
/// colour and width from the bottom toolbar, optionally erase, then
/// tap "Tamam" (Done). The serialised `PKDrawing` rides into this
/// payload via `drawingData` and gets appended to `[StoryOverlay]`
/// as `.drawing(StoryDrawingOverlay(...))`.
///
/// **Locked contract** with the sibling editor + wire encoders:
///
///   * Type name is `StoryDrawingOverlay`.
///   * Field set: `id`, `drawingData`, `x`, `y`, `scale`, `rotation`.
///   * `drawingData` carries the raw bytes of `PKDrawing.dataRepresentation()`
///     — the binary PencilKit format. Persisted as base64 on the wire
///     (see `Endpoint+Stories.swift`).
///   * `x`, `y`, `scale`, `rotation` are present for protocol parity
///     with text/mention/sticker payloads — the drawing always fills
///     the entire canvas, so we ship them as `(0.5, 0.5, 1, 0)` and
///     never translate at render time. They exist so a future "pinch
///     to shrink a drawing into a corner" feature lands without a
///     schema migration.
///
/// **Why PencilKit over a hand-rolled stroke recorder.** PencilKit
/// ships proper variable-width strokes (pressure curve faked for
/// finger input), an undo stack, ink + eraser tools, and a stable
/// binary serialisation that round-trips perfectly across iOS
/// versions. Rolling our own would re-implement all of that and
/// still not match Instagram's feel. Target is iOS 18, PencilKit
/// has been in iOS since 13 — safe baseline.
struct StoryDrawingOverlay: StoryOverlayPayload {
    let id: UUID
    /// Binary `PKDrawing.dataRepresentation()`. Decoded at render time
    /// via `try? PKDrawing(data: drawingData)`. We hold raw `Data`
    /// rather than a `PKDrawing` because the payload needs to be
    /// `Hashable`/`Equatable` for the `StoryOverlay` enum and `Data`
    /// already conforms; `PKDrawing` does not.
    let drawingData: Data
    var x: CGFloat
    var y: CGFloat
    var scale: CGFloat
    var rotation: Double

    init(
        id: UUID = UUID(),
        drawingData: Data,
        x: CGFloat = 0.5,
        y: CGFloat = 0.5,
        scale: CGFloat = 1.0,
        rotation: Double = 0
    ) {
        self.id = id
        self.drawingData = drawingData
        self.x = x
        self.y = y
        self.scale = scale
        self.rotation = rotation
    }
}

// MARK: - Renderable view

/// Pure-presentation view for a drawing overlay on the editor canvas.
///
/// Wraps a `PKCanvasView` in a `UIViewRepresentable`. Critically the
/// canvas is in **read-only** mode (`isUserInteractionEnabled = false`)
/// because gesture handling — drag, scale, rotate, double-tap-to-delete
/// — lives on the parent canvas wrapper in `StoryEditorView`, same as
/// the other overlay types. If we let `PKCanvasView` receive touches it
/// would intercept the gesture stack and the user could neither move
/// nor remove a finished drawing.
///
/// Visual:
///   * Transparent background (`backgroundColor = .clear`) so the photo
///     beneath shows through wherever the user didn't paint.
///   * `drawingPolicy = .anyInput` to ensure finger strokes render the
///     same on simulator + iPad + iPhone without an Apple Pencil.
///   * Active state — when `isActive` is true the editor's parent
///     wrapper draws its own lime dashed ring around the bounding box;
///     no chrome lives in this view directly. Same pattern as
///     `StoryStickerOverlayView`.
struct StoryDrawingOverlayView: View {
    let overlay: StoryDrawingOverlay
    /// Whether this drawing is the currently-selected overlay in the
    /// editor. Carried on the API for parity with the other overlay
    /// views — the lime ring lives on the parent wrapper, so we don't
    /// use this value internally. Marked `_` in the body to silence the
    /// unused-warning under `SWIFT_TREAT_WARNINGS_AS_ERRORS`.
    var isActive: Bool = false

    var body: some View {
        // `_` reference so the linter doesn't trip on the unused
        // public-API parameter under `-warnings-as-errors`. Same
        // approach `StoryStickerOverlayView` takes.
        let _ = isActive
        PKCanvasRepresentable(drawingData: overlay.drawingData)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("stories.draw.tool.label"))
            .accessibilityHint(Text("stories.draw.remove"))
    }
}

// MARK: - UIViewRepresentable wrapper (read-only render)

/// Minimal bridge that mounts a `PKCanvasView` in read-only mode and
/// loads a serialised `PKDrawing` into it. Used both by
/// `StoryDrawingOverlayView` above (editor canvas) and by future
/// viewer-side rendering (`StoryViewer` overlay hydration is a Wave-13+
/// follow-up).
///
/// Why a dedicated representable instead of inline-creating the canvas
/// in `makeUIView`: `updateUIView` needs to re-load the drawing when
/// `drawingData` changes (e.g. an in-place edit lands later) without
/// rebuilding the underlying view, and keeping the wrapper named makes
/// previews + tests easier to spot.
private struct PKCanvasRepresentable: UIViewRepresentable {
    let drawingData: Data

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = PKCanvasView()
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        // Read-only: gestures are owned by the parent overlay wrapper
        // in `StoryEditorView`. Without this the canvas would eat drag
        // events and the user couldn't reposition the drawing.
        canvas.isUserInteractionEnabled = false
        // Accept finger input on every device — defaults vary by iOS
        // version. Without this, simulator builds silently refuse to
        // draw and engineers chase ghosts.
        canvas.drawingPolicy = .anyInput
        applyDrawing(to: canvas)
        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        applyDrawing(to: canvas)
    }

    private func applyDrawing(to canvas: PKCanvasView) {
        // `PKDrawing(data:)` throws on corrupted/forward-version data
        // — fall back to an empty drawing rather than crashing, so a
        // bad wire payload from a newer client renders blank instead
        // of taking the editor down.
        if let drawing = try? PKDrawing(data: drawingData) {
            canvas.drawing = drawing
        } else {
            canvas.drawing = PKDrawing()
        }
    }
}

// MARK: - View builder hook on the payload

extension StoryDrawingOverlay {
    /// Convenience builder so `StoryEditorView` can dispatch on the
    /// enum and call `overlay.view(isActive: …)` directly — mirrors
    /// the pattern set by `StoryStickerOverlay` and `StoryMentionOverlay`.
    @MainActor
    func view(isActive: Bool) -> some View {
        StoryDrawingOverlayView(overlay: self, isActive: isActive)
    }
}
