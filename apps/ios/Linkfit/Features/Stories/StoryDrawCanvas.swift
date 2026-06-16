import SwiftUI
import PencilKit
import UIKit

/// Wave-13 — full-screen drawing modal presented over the story
/// editor's image. Lives behind the toolbar's pen icon (see
/// `DrawingToolButton`). The user paints with one or more strokes,
/// switches colour and width, optionally erases, then taps "Tamam"
/// (Done) to commit. On commit the modal hands the parent a binary
/// `PKDrawing.dataRepresentation()` blob that gets wrapped into a
/// `StoryDrawingOverlay` and appended to `[StoryOverlay]`.
///
/// Layout:
///
/// ```
///   ┌─ ✕ Cancel                                Done ✓ ─┐
///   │                                                  │
///   │            <PKCanvasView, transparent>           │
///   │                                                  │
///   │   ●●●●●●●●  (color swatches, 8)                  │
///   │   ────────  (width slider, 3 stops)              │
///   │   ↶ Undo                       Eraser toggle     │
///   └──────────────────────────────────────────────────┘
/// ```
///
/// Why a SwiftUI modal wrapper (instead of mounting `PKToolPicker`
/// directly) — `PKToolPicker` is the iPad-class tool palette and
/// looks foreign on a phone-sized story editor. Instagram's drawing
/// tool has its own compact colour row + width slider that matches
/// the rest of the editor's chrome. A SwiftUI shell lets us drive
/// `PKCanvasView.tool` from our own state and theme the controls
/// with `DSColor`.
struct StoryDrawCanvas: View {
    /// Callback fired when the user taps "Tamam" (Done). Hands back
    /// the binary `PKDrawing.dataRepresentation()` payload — the
    /// parent (`DrawingToolButton`) wraps it into a
    /// `StoryDrawingOverlay` and appends it to the editor's overlay
    /// list. We pass `Data`, not `PKDrawing`, because the overlay
    /// payload is `Hashable` (`PKDrawing` is not) and the wire format
    /// is byte-identical.
    let onDone: (Data) -> Void

    /// Optional explicit cancel callback. The button's
    /// `fullScreenCover` handles its own dismissal via `isPresented`
    /// — we still expose this so a future caller that mounts the
    /// canvas inline can wire up a custom cancel path. Defaults to a
    /// no-op which is fine: the SwiftUI `dismiss` action below
    /// handles the actual modal teardown.
    var onCancel: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss

    /// Underlying PencilKit canvas. Held as `@State` so the
    /// representable wrapper can keep the same instance across
    /// re-renders — rebuilding the canvas on every tap would drop
    /// the in-progress drawing.
    @State private var canvas: PKCanvasView = {
        let c = PKCanvasView()
        c.backgroundColor = .clear
        c.isOpaque = false
        // `.anyInput` so the simulator + finger input on real
        // hardware paint identically. Default is `.pencilOnly` on
        // some iOS versions, which silently refuses finger strokes
        // — easy bug to chase.
        c.drawingPolicy = .anyInput
        return c
    }()

    /// Selected colour for the ink tool. Starts on white because the
    /// editor's photo is usually content-rich and white reads against
    /// the largest fraction of likely backgrounds.
    @State private var selectedColor: Color = .white

    /// Selected width stop. Three coarse stops (small / medium /
    /// large) instead of a continuous slider — matches Instagram's
    /// finger-friendly affordance and gives predictable line weights
    /// across the colour row.
    @State private var selectedWidth: WidthStop = .medium

    /// Eraser toggle. When true the canvas's `tool` becomes a
    /// `PKEraserTool`, otherwise it's a `PKInkingTool` parameterised
    /// by colour + width.
    @State private var isErasing: Bool = false

    /// Hardcoded colour palette — eight swatches that cover the
    /// majority of "writing on a photo" use cases. Order picked so
    /// the highlight + lime accents sit near the start where the
    /// user's eye lands first.
    /// Each entry pairs the ink colour with a localization key for its
    /// VoiceOver label (`stories.draw.color.*`). The raw RGB triples
    /// here are *drawing content* the user paints onto their photo —
    /// not UI chrome — so they intentionally live outside `DSColor`,
    /// which only governs app surfaces. The brand swatch reuses
    /// `DSColor.accent` (royal blue) so painting in-brand stays one tap
    /// away.
    private let palette: [(key: LocalizedStringKey, color: Color)] = [
        ("stories.draw.color.white",  .white),
        ("stories.draw.color.black",  .black),
        ("stories.draw.color.brand",  DSColor.accent),   // royal-blue brand accent
        ("stories.draw.color.red",    Color(red: 0.95, green: 0.26, blue: 0.21)),
        ("stories.draw.color.blue",   Color(red: 0.26, green: 0.52, blue: 0.96)),
        ("stories.draw.color.yellow", Color(red: 0.98, green: 0.87, blue: 0.27)),
        ("stories.draw.color.pink",   Color(red: 0.96, green: 0.40, blue: 0.69)),
        ("stories.draw.color.orange", Color(red: 0.98, green: 0.60, blue: 0.20)),
    ]

    var body: some View {
        ZStack {
            // Translucent black so the editor's photo (mounted
            // beneath the full-screen cover by `DrawingToolButton`'s
            // host) is still partly visible while drawing. Pure
            // opacity makes the strokes pop without losing the
            // composition the user is annotating.
            Color.black.opacity(0.35).ignoresSafeArea()

            // Drawing surface — fills every spare pt between the top
            // and bottom toolbars so the user has the maximum
            // possible canvas. PencilKit clips strokes to the view
            // bounds so we don't need to manage that ourselves.
            DrawCanvasRepresentable(
                canvas: canvas,
                tool: currentTool
            )
            .ignoresSafeArea()
            .accessibilityHidden(true)  // the toolbar buttons carry the labels

            VStack {
                topBar
                Spacer()
                bottomBar
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - Top bar

    /// Cancel ✕ on the left, Done ✓ on the right. Both compact glyph
    /// buttons inside a black-tinted pill so they sit cleanly on top
    /// of whatever the canvas/photo composition behind looks like.
    private var topBar: some View {
        HStack {
            Button {
                onCancel?()
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Color.black.opacity(0.45), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("stories.draw.cancel"))

            Spacer()

            Button {
                Haptics.medium()   // commit action — medium tier per the haptic ladder
                // Serialise the strokes into the binary PencilKit
                // representation. Empty drawings (user opened the
                // canvas but didn't paint anything) still produce a
                // valid blob — the editor can decide whether to
                // bother appending; for now we always forward so the
                // parent's policy stays simple.
                let data = canvas.drawing.dataRepresentation()
                onDone(data)
                dismiss()
            } label: {
                Image(systemName: "checkmark")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(DSColor.textOnAccent)
                    .frame(width: 40, height: 40)
                    .background(DSColor.accent, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("stories.draw.done"))
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    // MARK: - Bottom bar (palette + width + undo + eraser)

    /// Three rows stacked vertically:
    ///   1. Colour swatches.
    ///   2. Width slider (3 stops).
    ///   3. Undo + Eraser action row.
    private var bottomBar: some View {
        VStack(spacing: 14) {
            colorRow
            widthRow
            actionRow
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 16)
        .background(
            // Soft black gradient so the controls read against the
            // canvas without a hard divider. Same chrome as the
            // editor's bottom bar.
            LinearGradient(
                colors: [Color.black.opacity(0.0), Color.black.opacity(0.55)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        )
    }

    /// Colour row — 8 circular swatches. Tapping a swatch picks the
    /// colour and (importantly) drops out of eraser mode, otherwise
    /// the new colour would silently be ignored on the next stroke.
    private var colorRow: some View {
        HStack(spacing: 10) {
            ForEach(0..<palette.count, id: \.self) { index in
                let entry = palette[index]
                let isSelected = !isErasing && selectedColor.isApproximatelyEqual(to: entry.color)
                Button {
                    selectedColor = entry.color
                    isErasing = false
                } label: {
                    Circle()
                        .fill(entry.color)
                        .frame(width: 28, height: 28)
                        .overlay(
                            // Selected swatch gets a white ring; black
                            // swatch gets a faint grey ring even when
                            // unselected so it doesn't disappear into
                            // the gradient background.
                            Circle()
                                .strokeBorder(
                                    isSelected ? Color.white : Color.white.opacity(0.18),
                                    lineWidth: isSelected ? 2.5 : 1
                                )
                                .padding(-2)
                        )
                        .shadow(color: .black.opacity(0.4), radius: 2, y: 1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(entry.key))
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// Width row — three coarse stops. We render them as
    /// progressively-larger dots so the affordance is self-explanatory
    /// without a label.
    private var widthRow: some View {
        HStack(spacing: 22) {
            ForEach(WidthStop.allCases, id: \.self) { stop in
                let isSelected = !isErasing && selectedWidth == stop
                Button {
                    selectedWidth = stop
                    isErasing = false
                } label: {
                    Circle()
                        .fill(Color.white)
                        .frame(width: stop.visualDotSize, height: stop.visualDotSize)
                        .overlay(
                            Circle()
                                .strokeBorder(
                                    isSelected ? DSColor.accent : Color.white.opacity(0.0),
                                    lineWidth: 2.5
                                )
                                .padding(-6)
                        )
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(stop.accessibilityKey))
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// Undo (left) and eraser toggle (right). Centred so the eye
    /// doesn't have to track between widely-separated tap targets.
    private var actionRow: some View {
        HStack(spacing: 28) {
            Button {
                // PKCanvasView ships an undoManager off the responder
                // chain. Walking it lets us pop the most recent
                // stroke without any state bookkeeping.
                canvas.undoManager?.undo()
            } label: {
                Image(systemName: "arrow.uturn.backward")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Color.black.opacity(0.45), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("stories.draw.undo"))

            Button {
                isErasing.toggle()
            } label: {
                Image(systemName: "eraser")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(isErasing ? DSColor.textOnAccent : .white)
                    .frame(width: 44, height: 44)
                    .background(
                        isErasing ? DSColor.accent : Color.black.opacity(0.45),
                        in: Circle()
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("stories.draw.eraser"))
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Tool composition

    /// The `PKTool` driven onto the canvas by the
    /// `DrawCanvasRepresentable` whenever the user changes colour,
    /// width, or toggles the eraser. PencilKit takes a brand-new
    /// `PKInkingTool`/`PKEraserTool` every time — there's no in-place
    /// mutate API for ink — so we rebuild the tool struct on every
    /// state change.
    private var currentTool: PKTool {
        if isErasing {
            // `.bitmap` matches the marker-style ink we use for inking,
            // so erasing a pen stroke removes the same pixels the
            // stroke painted. `.vector` would only remove whole strokes
            // (an alternative IG considered but rejected).
            return PKEraserTool(.bitmap)
        }
        return PKInkingTool(
            .marker,
            color: UIColor(selectedColor),
            width: selectedWidth.pointSize
        )
    }
}

// MARK: - Width stop enum

/// Three coarse pen widths the bottom slider exposes. The point
/// sizes were picked by tracing on a 6.1" device — small reads as a
/// fine-line annotation, medium as a confident highlight, large as
/// a "fat marker" Instagram-style flourish.
private enum WidthStop: CaseIterable {
    case small
    case medium
    case large

    /// Stroke width handed to `PKInkingTool`. Values are PencilKit
    /// "points" — what shows on the canvas at 1× scale.
    var pointSize: CGFloat {
        switch self {
        case .small:  return 3
        case .medium: return 8
        case .large:  return 20
        }
    }

    /// Diameter of the visual dot shown on the width row. Coupled to
    /// `pointSize` but capped so the largest dot still fits the row
    /// height nicely.
    var visualDotSize: CGFloat {
        switch self {
        case .small:  return 6
        case .medium: return 12
        case .large:  return 20
        }
    }

    /// VoiceOver label key. The dot is the visual affordance; screen
    /// reader users get a localised stop name (`stories.draw.width.*`)
    /// so the control reads correctly in az/en/ru.
    var accessibilityKey: LocalizedStringKey {
        switch self {
        case .small:  return "stories.draw.width.small"
        case .medium: return "stories.draw.width.medium"
        case .large:  return "stories.draw.width.large"
        }
    }
}

// MARK: - PKCanvasView bridge (writable)

/// Live PencilKit canvas that accepts touches. Separate from the
/// read-only `PKCanvasRepresentable` in `StoryDrawingOverlay.swift`
/// because the writable canvas needs to react to `tool` updates
/// (colour/width/eraser changes from the bottom toolbar) without
/// rebuilding the underlying view — rebuilding would drop the
/// in-progress drawing on every tap.
private struct DrawCanvasRepresentable: UIViewRepresentable {
    let canvas: PKCanvasView
    let tool: PKTool

    func makeUIView(context: Context) -> PKCanvasView {
        canvas.tool = tool
        return canvas
    }

    func updateUIView(_ uiView: PKCanvasView, context: Context) {
        // Reapply the tool every time SwiftUI re-asks for the view —
        // changing the colour/width state on the parent triggers an
        // update here and we want the next stroke to use the new
        // tool. PencilKit applies the change immediately; in-flight
        // strokes are unaffected because they're already committed.
        uiView.tool = tool
    }
}

// MARK: - Colour comparison helper

/// SwiftUI `Color` does not implement equality on the RGB channel
/// values directly — it carries a `ColorProvider` that compares by
/// identity, so `Color(red: r, green: g, blue: b) == Color(red: r,
/// green: g, blue: b)` returns `false` for identical channel triples.
/// We need a "this swatch is currently selected" check, so collapse
/// both colours through `UIColor` and compare the resolved RGB.
private extension Color {
    /// Lossy equality on RGB. Good enough for the swatch-highlight
    /// check, which only needs to fire when the user tapped the
    /// exact same swatch they previously had selected.
    func isApproximatelyEqual(to other: Color) -> Bool {
        let a = UIColor(self).cgColor.components ?? []
        let b = UIColor(other).cgColor.components ?? []
        guard a.count >= 3, b.count >= 3 else { return false }
        let tolerance: CGFloat = 0.01
        return abs(a[0] - b[0]) < tolerance
            && abs(a[1] - b[1]) < tolerance
            && abs(a[2] - b[2]) < tolerance
    }
}
