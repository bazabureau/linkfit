import SwiftUI

/// Sticker overlay payload — a single emoji glyph rendered as a draggable,
/// pinchable, rotatable sticker on top of a story photo. Wave-12 "😀" tool.
///
/// **Locked contract** with W12-2 (`StoryEditorView` canvas) and W12-1
/// (`StoryOverlay` enum): `id`, `emoji`, `x`, `y`, `scale`, `rotation`. Do
/// not rename or reshape fields without bumping the sibling agents —
/// `StoryOverlay.sticker` pattern-matches on this exact payload type and
/// the editor canvas reads the field set by name.
///
/// Coordinate semantics mirror the rest of the overlay family (see
/// `StoryOverlay.swift`): `x` and `y` are normalized fractions of the canvas
/// (`0.5` = centre), `scale` is a unitless multiplier of the intrinsic 96pt
/// glyph size, `rotation` is radians (SwiftUI convention — positive =
/// clockwise). The gesture handlers in `StoryEditorView`'s canvas mutate
/// these fields in place during a drag/pinch/rotate via the view-model, so
/// the payload is a `struct` with `var`s rather than an immutable record.
///
/// The emoji is stored as the user-selected glyph itself (e.g. `"🎾"`),
/// not an enum key. This keeps the sticker tool open-ended — we curate a
/// recommended set in `StoryStickerPickerSheet` but the editor doesn't
/// constrain what the wire model can carry. Server persistence (a future
/// Wave-13 concern) will round-trip the glyph as a UTF-8 string.
struct StoryStickerOverlay: StoryOverlayPayload {
    let id: UUID
    var emoji: String
    var x: CGFloat
    var y: CGFloat
    var scale: CGFloat
    var rotation: Double
}

// MARK: - Renderable view

/// Pure-presentation view for a sticker overlay on the canvas.
///
/// **Locked contract** — `StoryEditorView` (W12-2) instantiates this view
/// by name (`StoryStickerOverlayView(overlay: payload)`) inside the canvas
/// switch. The editor wraps each overlay in its own transform layer (drag
/// offset, scale delta, rotation delta) and draws the selection-ring
/// chrome externally, so this view stays purely visual.
///
/// Visual:
///   • The emoji at `.font(.system(size: 96))` — large enough to read at
///     a glance and to give a comfortable hit-test target. The canvas's
///     `scaleEffect` multiplies this by the overlay's `scale` for the
///     final render.
///   • `.fixedSize` so SwiftUI doesn't truncate when the parent's frame
///     is tighter than the glyph's intrinsic width (some compound emojis
///     are wider than they look).
///
/// Gesture handling and the lime selection ring are NOT attached here —
/// they belong to the editor canvas wrapper. Keeping the view presentational
/// matches the pattern set by `StoryMentionOverlayView` and `StoryTextOverlayView`.
struct StoryStickerOverlayView: View {
    let overlay: StoryStickerOverlay

    /// Whether the sticker is the currently-selected overlay in the editor.
    /// W12-2's canvas draws its own dashed lime handle ring around the
    /// selected overlay, so we don't need to render one here — but we keep
    /// the parameter on the API so the contract surface stays uniform with
    /// the mention/text overlays (the task spec called for a `view(isActive:)`
    /// builder, see the convenience extension below).
    var isActive: Bool = false

    var body: some View {
        Text(overlay.emoji)
            .font(.system(size: 96))
            // Some compound emojis (ZWJ sequences like 🏋️‍♂️) report a wider
            // intrinsic width than the base glyph — `fixedSize` keeps
            // SwiftUI from clipping or truncating them inside a narrow
            // ancestor frame.
            .fixedSize(horizontal: true, vertical: true)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(overlay.emoji))
            .accessibilityHint(Text("stories.sticker.remove"))
    }
}

// MARK: - View builder hook on the payload

extension StoryStickerOverlay {
    /// Convenience builder so the editor canvas can write
    /// `overlay.view(isActive: …)` directly without spelling out the view
    /// type. Mirrors the pattern shipped by `StoryMentionOverlay` so any
    /// future canvas refactor that walks `[StoryOverlay]` and dispatches on
    /// the enum can call the same method on every payload variant.
    @MainActor
    func view(isActive: Bool) -> some View {
        StoryStickerOverlayView(overlay: self, isActive: isActive)
    }
}
