import Foundation
import CoreGraphics

/// Overlay infrastructure for the story editor.
///
/// Locked types — Wave-12 sibling agents (W12-3 mentions, W12-5 stickers)
/// reference these by name. Do NOT rename `StoryOverlay`, the case names,
/// or the payload field set without updating the integration contract.
///
/// **Coordinate system.** Every payload stores `x` and `y` as a normalized
/// fraction in `[0, 1]` of the canvas size. The view multiplies by the
/// actual canvas frame at render time, so the same persisted overlay reads
/// correctly on any screen size (5.4" SE → 6.7" Pro Max) and survives a
/// future "edit shipped story" feature. Scale is unitless (1.0 = drawn at
/// the payload's intrinsic size), rotation is in radians.

// MARK: - Payload protocol

/// Shared shape every overlay payload conforms to. Each tool (text /
/// mention / sticker) layers its tool-specific fields on top.
///
/// Mutability is intentional: gesture handlers mutate `x`/`y`/`scale`/
/// `rotation` directly while a drag is in flight. The `id` is constant
/// for the lifetime of the overlay so SwiftUI's `ForEach` keeps the same
/// view identity across mutations and the rotation gesture doesn't reset
/// on every frame.
protocol StoryOverlayPayload: Hashable, Identifiable {
    var id: UUID { get }
    /// Normalized horizontal centre, fraction of canvas width. 0.5 = centre.
    var x: CGFloat { get set }
    /// Normalized vertical centre, fraction of canvas height. 0.5 = centre.
    var y: CGFloat { get set }
    /// Multiplicative scale factor applied to the rendered payload.
    var scale: CGFloat { get set }
    /// Rotation in radians, positive = clockwise (SwiftUI's convention).
    var rotation: Double { get set }
}

// MARK: - Type-erased overlay enum

/// Heterogeneous list element — the editor holds `[StoryOverlay]` so the
/// canvas can mix text, mentions, and stickers in any z-order.
///
/// Each case wraps the tool-specific payload. The enum is `Identifiable`
/// (forwarding to the payload's `id`) so SwiftUI's `ForEach` keys cleanly.
///
/// **Note on the W12-3/W12-5 split.** This file declares only the case
/// names + the wrapped payload types' names. Those payload types (`Story-
/// MentionOverlay`, `StoryStickerOverlay`) live in the sibling agents'
/// files. If either type is missing at build time, this file fails to
/// compile — that's the coordination dependency W12-6 (integration
/// verifier) catches. The text case is fully owned by this agent and
/// always compiles.
enum StoryOverlay: Identifiable, Hashable {
    case text(StoryTextOverlay)
    case mention(StoryMentionOverlay)
    case sticker(StoryStickerOverlay)
    /// Wave-13 — finger-drawing overlay (PencilKit). The payload's
    /// `drawingData` is the binary `PKDrawing.dataRepresentation()`;
    /// see `StoryDrawingOverlay.swift` for the contract and
    /// `Endpoint+Stories.swift` for the base64 wire encoding.
    case drawing(StoryDrawingOverlay)

    /// Forwards to the underlying payload's id so SwiftUI's diffing stays
    /// stable across mutations.
    var id: UUID {
        switch self {
        case .text(let payload):    return payload.id
        case .mention(let payload): return payload.id
        case .sticker(let payload): return payload.id
        case .drawing(let payload): return payload.id
        }
    }
}
