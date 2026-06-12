import SwiftUI

/// Persisted state for a single text overlay placed on the story canvas.
///
/// The shape mirrors what Instagram's text tool persists: the typed glyphs
/// plus three style knobs (colour, size step, alignment) plus the four
/// transform fields from `StoryOverlayPayload`. The payload type is
/// frozen — sibling agents reference `StoryTextOverlay` by name (e.g. the
/// mention parser turns "@handle" tokens inside a text overlay into chips).
struct StoryTextOverlay: StoryOverlayPayload {
    let id: UUID
    var text: String
    var color: ColorOption
    var size: SizeOption
    var alignment: TextAlign
    var x: CGFloat
    var y: CGFloat
    var scale: CGFloat
    var rotation: Double

    init(
        id: UUID = UUID(),
        text: String = "",
        color: ColorOption = .white,
        size: SizeOption = .medium,
        alignment: TextAlign = .center,
        x: CGFloat = 0.5,
        y: CGFloat = 0.5,
        scale: CGFloat = 1.0,
        rotation: Double = 0
    ) {
        self.id = id
        self.text = text
        self.color = color
        self.size = size
        self.alignment = alignment
        self.x = x
        self.y = y
        self.scale = scale
        self.rotation = rotation
    }

    // MARK: - Style enums

    /// Six-swatch palette for the colour picker. Matches Instagram's
    /// "default" text-tool set — white/black for contrast on light/dark
    /// imagery plus four brand-ish accents. The lime maps to `DSColor.accent`
    /// so the brand colour shows up natively without a one-off swatch.
    enum ColorOption: String, Codable, Hashable, CaseIterable {
        case white
        case black
        case lime
        case red
        case blue
        case yellow

        /// The SwiftUI `Color` used for both the rendered glyph and the
        /// swatch dot in the picker.
        var swiftUIColor: Color {
            switch self {
            case .white:  return .white
            case .black:  return .black
            case .lime:   return DSColor.accent
            case .red:    return Color(red: 0.95, green: 0.30, blue: 0.30)
            case .blue:   return Color(red: 0.30, green: 0.60, blue: 0.95)
            case .yellow: return Color(red: 0.98, green: 0.85, blue: 0.30)
            }
        }
    }

    /// Three discrete font-size stops. We deliberately don't expose a
    /// continuous slider for size (that's what the magnification gesture
    /// on the canvas is for) — the stops give the user a coarse anchor
    /// inside the editor sheet without fighting the gesture.
    enum SizeOption: String, Codable, Hashable, CaseIterable {
        case small
        case medium
        case large

        /// Base point size used by `Text(...).font(.system(size:))`. The
        /// magnification gesture scales this further via `.scaleEffect`.
        var pointSize: CGFloat {
            switch self {
            case .small:  return 22
            case .medium: return 34
            case .large:  return 52
            }
        }
    }

    /// Multi-line alignment. Persisted as a small enum (not `Text-
    /// Alignment` directly) so we can `Codable` it cleanly when stories
    /// learn how to round-trip overlays through the API.
    enum TextAlign: String, Codable, Hashable, CaseIterable {
        case left
        case center
        case right

        var textAlignment: TextAlignment {
            switch self {
            case .left:   return .leading
            case .center: return .center
            case .right:  return .trailing
            }
        }

        /// SF Symbol used by the alignment toggle in the editor sheet.
        var symbolName: String {
            switch self {
            case .left:   return "text.alignleft"
            case .center: return "text.aligncenter"
            case .right:  return "text.alignright"
            }
        }
    }
}

// MARK: - Renderable view

/// Pure-presentation view for a single text overlay. Used inside the
/// editor canvas (with gestures attached at a higher layer) and also
/// inside the sheet's live preview, so the rendered text matches 1:1
/// across the two surfaces.
///
/// Style decisions:
///   * Black outline + slight shadow so light glyphs stay legible on
///     bright photos and dark glyphs stay legible on dark photos. The
///     outline is a stack of four `.offset` copies — cheap, and avoids
///     forcing a Canvas just for stroke text.
///   * `.fixedSize(horizontal: false, vertical: true)` so multi-line
///     text wraps to the screen rather than expanding into a tooltip-
///     wide rect.
struct StoryTextOverlayView: View {
    let overlay: StoryTextOverlay

    var body: some View {
        Text(overlay.text.isEmpty ? " " : overlay.text)
            .font(.system(size: overlay.size.pointSize, weight: .heavy))
            .multilineTextAlignment(overlay.alignment.textAlignment)
            .foregroundStyle(overlay.color.swiftUIColor)
            .shadow(color: .black.opacity(0.35), radius: 4, x: 0, y: 2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
    }
}
